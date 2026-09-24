/**
 * Agent turn orchestrator (docs/architecture.md): wires the
 * four-layer context pyramid, the reading tools and the streaming seam into
 * one companion-chat turn.
 *
 * A turn = system prompt (L2 panorama + full TOC briefs, L1 viewport, L0
 * quote) + user turn (L1 excerpt + full history + question) + the 4-tool
 * toolbox, streamed through the (injectable) agent stream. Tool calls and
 * locate citations are surfaced as live events for the UI trace accordion
 * and returned with the final content for persistence.
 */
import type { Message } from '@/types/ai';
import type { AgentCitation, NodeKind, ToolCallTrace } from '@/types/readingAgent';
import type { AgentBookContext } from './agentContext';
import {
  assembleAgentSystemPrompt,
  buildCurrentChapterExcerpt,
} from './promptPyramid';
import { createReadingTools } from './readingTools';
import type { AgentStreamFn } from '@/services/ai/agentStreamClient';
import type { AISettings } from '@/types/ai';
import { buildSystemPrompt } from '@/services/chat/promptAssembly';
import { renderHistory } from '@/services/chat/messageLabels';
import { nodeKindLabel, resolveNodeKind, shapeOfNodes } from '@/services/bookNodes';
import type { NodeView, ReadingPosition } from '@/services/bookNodes/nodeView';

/** Truncation for persisted tool-result snippets (trace table + UI). */
export const TRACE_SNIPPET_MAX_CHARS = 200;

export type AgentTurnEvent =
  | { type: 'delta'; text: string }
  | { type: 'tool-call'; trace: ToolCallTrace }
  | { type: 'tool-result'; trace: ToolCallTrace }
  | { type: 'citation'; citation: AgentCitation };

export interface RunTurnInput {
  /**
   * The reader's physical position. This seam speaks **Reading Position** only:
   * a node ordinal is never accepted here, so a spine ordinal can no longer be
   * mistaken for one (CONTEXT.md "Node View", ADR 0011). The node, its parent,
   * its level and its text are resolved inside the turn.
   */
  position: ReadingPosition;
  /** Book title, from the library row (not derivable from the book text). */
  bookTitle: string;
  history: Message[];
  userMessage: string;
  /** L0: user's selected fragment, when present. */
  quoteText?: string;
  signal: AbortSignal;
  onEvent: (event: AgentTurnEvent) => void;
}

export interface RunTurnResult {
  content: string;
  toolCalls: ToolCallTrace[];
  citations: AgentCitation[];
}

export interface AgentOrchestratorDeps {
  stream: AgentStreamFn;
  getSettings: () => AISettings;
  /** Resolve the registered whole-book context (undefined → degraded mode). */
  getContext: (bookHash: string) => AgentBookContext | undefined;
  /**
   * Resolve the Node View at a Reading Position. Injected so a turn never reads
   * a global store itself; the app binds it to `resolveNodeViewAt`, and tests
   * pass plain values (CONTEXT.md "Node View").
   */
  resolveNodeView: (position: ReadingPosition) => NodeView;
}

/** User-turn prompt: L1 excerpt + FULL topic history + the question (L0 quote). */
export function buildAgentUserPrompt(input: {
  nodeText: string;
  /** Level of the viewport node, so the heading names 章 / 节 / 段. */
  nodeKind: NodeKind;
  history: Message[];
  userMessage: string;
  quoteText?: string;
  /** Resolved global-offset anchor of the quote (selection tracking). */
  quoteAnchor?: {
    nodeIndex: number;
    nodeTitle: string;
    charOffset: number;
    /** Level of the anchor node; resolved from the node title when omitted. */
    nodeKind?: NodeKind;
  };
}): string {
  const excerpt = buildCurrentChapterExcerpt(input.nodeText);
  const historyText = renderHistory(input.history);
  const anchorNote = input.quoteAnchor
    ? `\n（该片段位于${nodeKindLabel(
        input.quoteAnchor.nodeKind ?? resolveNodeKind(0, input.quoteAnchor.nodeTitle),
      )}《${input.quoteAnchor.nodeTitle}》约 ${input.quoteAnchor.charOffset} 字符处）`
    : '';
  const question = input.quoteText
    ? `> ${input.quoteText}${anchorNote}\n\n${input.userMessage}`
    : input.userMessage;
  return [
    `【当前${nodeKindLabel(input.nodeKind)}正文节选】\n${excerpt}`,
    `【对话历史】\n${historyText}`,
    `【本轮提问】\n${question}`,
  ].join('\n\n');
}

/**
 * Selection tracking (doc §3.3): resolve the user's quoted fragment to its
 * global character offset inside the unified coordinate space, so the agent
 * reasons with a precise anchor instead of raw text alone. The node model
 * supplies the level word (章 / 节 / 段) the anchor must be named with.
 * Returns null when the fragment cannot be located.
 */
export function locateQuoteInContext(
  context: AgentBookContext,
  quoteText: string,
): { nodeIndex: number; nodeTitle: string; charOffset: number; nodeKind: NodeKind } | null {
  const needle = quoteText.trim();
  if (!needle) return null;
  const match = context.searchText(needle.slice(0, Math.min(30, needle.length)), 1)[0];
  if (!match) return null;
  const node = context.getNode(match.nodeIndex);
  return {
    nodeIndex: match.nodeIndex,
    nodeTitle: match.nodeTitle,
    charOffset: match.charOffset,
    nodeKind: resolveNodeKind(node?.depth ?? 0, node?.title ?? match.nodeTitle),
  };
}

export function createAgentOrchestrator(deps: AgentOrchestratorDeps) {
  return {
    runTurn: async (input: RunTurnInput): Promise<RunTurnResult> => {
      const { position } = input;
      const context = deps.getContext(position.bookHash);
      // The Node View is the one answer to "which Book Node is the reader at",
      // and it is resolved from the Reading Position — never from a caller's
      // node ordinal (CONTEXT.md "Node View").
      const view = deps.resolveNodeView(position);
      const settings = deps.getSettings();
      const citations: AgentCitation[] = [];
      const toolCalls: ToolCallTrace[] = [];

      // L0 anchor: map the quoted fragment onto the global offset space.
      const quoteAnchor =
        context && input.quoteText ? locateQuoteInContext(context, input.quoteText) : null;

      // Degraded mode (book not indexed, e.g. demo fixtures): answer from
      // the current node only, without tools.
      const tree = context?.getNodeTree();
      const system = context
        ? assembleAgentSystemPrompt({
            bookTitle: input.bookTitle,
            currentNodeIndex: view.nodeIndex,
            currentNodeTitle: view.title,
            ...(view.parentTitle ? { parentNodeTitle: view.parentTitle } : {}),
            currentNodeKind: view.kind,
            shape: shapeOfNodes(context.nodes),
            panorama: context.getPanorama(),
            allNodeBriefs: context.nodes.map((node) => {
              const parent =
                node.parentNodeId && tree ? tree.byId.get(node.parentNodeId) : undefined;
              return {
                nodeIndex: node.nodeIndex,
                title: node.title,
                brief: node.brief,
                depth: node.depth,
                // Container 章 are structural groupings, never briefed; the
                // matrix says so rather than showing a pending placeholder.
                isContainer: tree?.childIdsByParent.has(node.nodeId) ?? false,
                ...(parent ? { parentTitle: parent.title } : {}),
              };
            }),
            quoteText: input.quoteText,
          })
        : buildSystemPrompt({
            bookTitle: input.bookTitle,
            nodeTitle: view.title,
            nodeKind: view.kind,
          });

      const prompt = buildAgentUserPrompt({
        nodeText: view.text,
        nodeKind: view.kind,
        history: input.history,
        userMessage: input.userMessage,
        quoteText: input.quoteText,
        quoteAnchor: quoteAnchor ?? undefined,
      });

      const tools = context
        ? createReadingTools(context, {
            onCitation: (citation) => {
              citations.push(citation);
              input.onEvent({ type: 'citation', citation });
            },
          })
        : {};

      // `await` first: the seam may be a plain async fn returning a generator.
      const events = await deps.stream(
        { system, prompt, tools, signal: input.signal },
        settings,
      );

      let content = '';
      for await (const event of events) {
        if (input.signal.aborted) break;
        if (event.type === 'text-delta' && event.text) {
          content += event.text;
          input.onEvent({ type: 'delta', text: event.text });
        } else if (event.type === 'tool-call' && event.toolName) {
          const trace: ToolCallTrace = {
            id: event.id ?? `${event.toolName}-${toolCalls.length}`,
            toolName: event.toolName,
            args: event.args ?? {},
            durationMs: 0,
          };
          toolCalls.push(trace);
          input.onEvent({ type: 'tool-call', trace });
        } else if (event.type === 'tool-result' && event.toolName) {
          const snippet =
            event.result === undefined
              ? undefined
              : JSON.stringify(event.result).slice(0, TRACE_SNIPPET_MAX_CHARS);
          const trace: ToolCallTrace = {
            id: event.id ?? `${event.toolName}-${toolCalls.length}`,
            toolName: event.toolName,
            args: {},
            ...(snippet !== undefined ? { resultSnippet: snippet } : {}),
            durationMs: event.durationMs ?? 0,
          };
          // Merge into the matching tool-call trace when present.
          const pending = toolCalls.find((entry) => entry.id === trace.id && !entry.resultSnippet);
          if (pending) {
            pending.resultSnippet = snippet;
            pending.durationMs = trace.durationMs;
            input.onEvent({ type: 'tool-result', trace: pending });
          } else {
            toolCalls.push(trace);
            input.onEvent({ type: 'tool-result', trace });
          }
        }
      }

      return { content, toolCalls, citations };
    },
  };
}

export type AgentOrchestrator = ReturnType<typeof createAgentOrchestrator>;

/**
 * Minimal-node micro-brief pipeline (reading-agent architecture doc §4.1
 * Phase 4 + §4.2): a priority-scheduled background queue generating 50~100
 * char node briefs (+ key entities) from "head 2,000 + tail 1,000" slices.
 *
 * **Only minimal nodes are briefed** (CONTEXT.md / ADR 0010): the 节 of a
 * 章/节 book, the 章 of a single-level book. Container 章 rows are structural
 * groupings and never consume a model call.
 *
 * Priority classes (re-evaluated before every node pickup so a reader jumping
 * nodes instantly boosts the new node to the front):
 *   0 — the node the reader is reading right now;
 *   1 — the first three nodes (they set the whole-book tone);
 *   2 — everything else, in order.
 *
 * The scheduler is resumable: nodes whose `indexStatus === 'ready'` with a
 * brief are skipped, and each finished node is persisted immediately, so an
 * interrupted run continues where it stopped on the next book open.
 */
import type { AISettings } from '@/types/ai';
import type { BookNode, BookNodeRecord } from '@/types/readingAgent';
import type { StreamTextFn } from '@/services/ai/streamClient';
import type { BookNodeRepository } from '@/services/db/repositories';

/** Extraction slices per doc §4.2: first 2,000 chars + last 1,000 chars. */
export const BRIEF_HEAD_CHARS = 2_000;
export const BRIEF_TAIL_CHARS = 1_000;
export const BRIEF_MAX_CHARS = 120;
/** Nodes processed concurrently against the model. */
export const BRIEF_CONCURRENCY = 2;

export const BRIEF_SYSTEM_PROMPT = [
  '你是一名极其精炼的读书助理。请根据节点标题与正文首尾切片，提炼本节点微摘要。',
  '输出格式（两行，不要任何多余文字）：',
  '第一行：不超过80字的单行客观陈述句，概括核心事件进展、剧情转折及新出场人物；',
  '第二行：以“【实体】”开头，列出本节点登场的关键人物或术语，用顿号分隔（无则输出“【实体】无”）。',
].join('\n');

/** Head+tail slice of a node body for token-frugal summarization. */
export function sliceHeadAndTail(text: string): string {
  if (text.length <= BRIEF_HEAD_CHARS + BRIEF_TAIL_CHARS) return text;
  return `${text.slice(0, BRIEF_HEAD_CHARS)}\n……（中略）……\n${text.slice(text.length - BRIEF_TAIL_CHARS)}`;
}

export function buildBriefPrompt(nodeTitle: string, nodeSlice: string): string {
  return [
    '【任务】用极其简练客观的语言（不超过80字），提炼本节点发生的核心事件进展、剧情转折及新出场人物。',
    '【要求】严禁寒暄与废话，直接输出单行陈述句。',
    `【本节点标题】${nodeTitle}`,
    '【正文切片】',
    nodeSlice,
  ].join('\n');
}

export interface BriefOutput {
  brief: string;
  keyEntities?: string[];
}

/** Parse the two-line model output (brief + 【实体】 line). */
export function parseBriefOutput(raw: string): BriefOutput {
  const lines = raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  let entities: string[] | undefined;
  const briefLines: string[] = [];
  for (const line of lines) {
    const entityMatch = line.match(/^【实体】[:：]?(.*)$/);
    if (entityMatch) {
      const names = entityMatch[1]!
        .split(/[、,，;；]/)
        .map((name) => name.trim())
        .filter((name) => name.length > 0 && name !== '无');
      if (names.length > 0) entities = names.slice(0, 10);
      continue;
    }
    // Ignore markdown noise; keep substantive lines only.
    if (line.startsWith('#') || line.startsWith('```')) continue;
    briefLines.push(line);
  }
  const brief = briefLines.join(' ').replace(/^["'“”]+|["'“”]+$/g, '').trim();
  return { brief: brief.slice(0, BRIEF_MAX_CHARS), keyEntities: entities };
}

export interface BriefProgress {
  done: number;
  total: number;
  /** The node record that just finished (ready or failed). */
  node: BookNodeRecord;
}

export interface BriefSchedulerDeps {
  stream: StreamTextFn;
  getSettings: () => AISettings;
  repository: BookNodeRepository;
  /** Full text of the book (global continuous character space). */
  getFullText: (bookHash: string) => string;
  now?: () => number;
}

export interface BriefRunOptions {
  signal: AbortSignal;
  /** Priority-0 node at run start. */
  currentSectionIndex: number;
  /** Live priority source; consulted before each node pickup. */
  getCurrentSectionIndex?: () => number;
  onProgress?: (progress: BriefProgress) => void;
}

export interface BriefScheduler {
  /**
   * Run the queue over the given nodes. Resolves when every node is done,
   * failed (model errors mark `failed` but never reject the run), or the
   * signal aborts.
   */
  run(bookHash: string, nodes: BookNode[], options: BriefRunOptions): Promise<void>;
}

const priorityOf = (nodeIndex: number, currentSectionIndex: number): number => {
  if (nodeIndex === currentSectionIndex) return 0;
  if (nodeIndex <= 2) return 1;
  return 2;
};

/** Pop the highest-priority node (ties broken by lowest ordinal). */
const pickNext = (queue: BookNode[], currentSectionIndex: number): BookNode | undefined => {
  if (queue.length === 0) return undefined;
  let bestIndex = 0;
  let bestKey = Number.POSITIVE_INFINITY;
  queue.forEach((node, index) => {
    const key = priorityOf(node.nodeIndex, currentSectionIndex) * 1_000 + node.nodeIndex;
    if (key < bestKey) {
      bestKey = key;
      bestIndex = index;
    }
  });
  const [picked] = queue.splice(bestIndex, 1);
  return picked;
};

export function createBriefScheduler(deps: BriefSchedulerDeps): BriefScheduler {
  const now = deps.now ?? Date.now;

  const generateOne = async (
    node: BookNode,
    fullText: string,
    signal: AbortSignal,
  ): Promise<BookNodeRecord> => {
    const body = fullText.slice(node.startOffset, node.endOffset);
    const prompt = buildBriefPrompt(node.title, sliceHeadAndTail(body));
    let raw = '';
    // `await` first: the seam may be a plain async fn returning a generator.
    const deltas = await deps.stream(
      { system: BRIEF_SYSTEM_PROMPT, prompt, signal },
      deps.getSettings(),
    );
    for await (const delta of deltas) raw += delta;
    const { brief, keyEntities } = parseBriefOutput(raw);
    return {
      ...node,
      brief: brief || '（本节点微摘要生成失败）',
      keyEntities,
      indexStatus: 'ready',
      updatedAt: now(),
    };
  };

  return {
    run: async (bookHash, nodes, options) => {
      const { signal, onProgress } = options;
      const fullText = deps.getFullText(bookHash);
      const pending = nodes.filter((node) => !(node.indexStatus === 'ready' && node.brief));

      const total = nodes.length;
      let done = total - pending.length;
      /** Nodes not yet picked up (abort → back to pending). */
      const queue = [...pending];
      /** Nodes currently in flight (abort → back to pending). */
      const inFlight = new Set<BookNode>();

      const record = async (node: BookNodeRecord): Promise<void> => {
        inFlight.delete(node);
        await deps.repository.put(node);
        done += 1;
        onProgress?.({ done, total, node });
      };

      const worker = async (): Promise<void> => {
        while (!signal.aborted) {
          const currentSectionIndex =
            options.getCurrentSectionIndex?.() ?? options.currentSectionIndex;
          const node = pickNext(queue, currentSectionIndex);
          if (!node) return;
          inFlight.add(node);
          try {
            await deps.repository.put({ ...node, indexStatus: 'indexing', updatedAt: now() });
            const finished = await generateOne(node, fullText, signal);
            if (signal.aborted) return;
            await record(finished);
          } catch (error) {
            if (signal.aborted) return;
            void error;
            await record({ ...node, indexStatus: 'failed', updatedAt: now() });
          }
        }
      };

      await Promise.all(
        Array.from({ length: Math.min(BRIEF_CONCURRENCY, Math.max(1, pending.length)) }, worker),
      );

      // On abort, normalize queued + in-flight nodes back to pending so the
      // next `ensureIndexed` resumes exactly where this run stopped.
      if (signal.aborted) {
        const stragglers = [...queue, ...inFlight].map((node) => ({
          ...node,
          indexStatus: 'pending' as const,
        }));
        for (const node of stragglers) {
          await deps.repository.put({ ...node, updatedAt: now() });
        }
      }
    },
  };
}

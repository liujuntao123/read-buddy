/**
 * Book panorama generator (reading-agent architecture doc §4.1 Phase 3).
 *
 * A single model call over the node outline + opening/closing slices produces
 * the whole-book portrait (genre / summary / world setting / main characters)
 * persisted to `book_panoramas`. The outline is rendered with the unified node
 * hierarchy (章 as first-level rows, 节 indented under them) so the model sees
 * the same structure the reader does. JSON is parsed leniently (code fences,
 * trailing prose) because real-world models rarely emit bare JSON.
 */
import type { AISettings } from '@/types/ai';
import type { BookNode, BookPanoramaRecord } from '@/types/readingAgent';
import type { StreamTextFn } from '@/services/ai/streamClient';
import type { BookPanoramaRepository } from '@/services/db/repositories';

/** Slices fed to the model: opening head + closing tail. */
export const PANORAMA_HEAD_CHARS = 3_000;
export const PANORAMA_TAIL_CHARS = 1_500;

export const PANORAMA_SYSTEM_PROMPT = [
  '你是一名专业的书籍档案管理员。请基于给出的节点目录与正文首尾切片，为全书建立全景画像。',
  '仅输出一个 JSON 对象，禁止输出任何其他文字或代码块标记。',
  '格式：{"genre":"题材类型","summary":"200~300字全书主旨概要","worldSetting":"世界观或时代背景","mainCharacters":["角色1","角色2"]}',
].join('\n');

export interface PanoramaInput {
  bookHash: string;
  bookTitle: string;
  /** The book's nodes in document order (章 first level, 节 nested). */
  nodes: readonly Pick<BookNode, 'title' | 'depth'>[];
  fullText: string;
}

export interface PanoramaGeneratorDeps {
  stream: StreamTextFn;
  settings: AISettings;
  repository: BookPanoramaRepository;
  now?: () => number;
}

/** Extract the first balanced JSON object from arbitrary model output. */
export function extractJsonObject(raw: string): Record<string, unknown> | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1]! : raw;
  const start = body.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < body.length; i++) {
    const ch = body[i]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') inString = !inString;
    if (inString) continue;
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          const parsed = JSON.parse(body.slice(start, i + 1)) as unknown;
          return typeof parsed === 'object' && parsed !== null
            ? (parsed as Record<string, unknown>)
            : null;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** Normalize parsed fields into the panorama record shape. */
function toPanorama(
  parsed: Record<string, unknown>,
  input: PanoramaInput,
  now: number,
): BookPanoramaRecord {
  const str = (value: unknown): string | undefined => {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  };
  const characters = Array.isArray(parsed.mainCharacters)
    ? parsed.mainCharacters
        .filter((name): name is string => typeof name === 'string' && name.trim().length > 0)
        .slice(0, 12)
    : undefined;
  return {
    bookHash: input.bookHash,
    genre: str(parsed.genre),
    summary: str(parsed.summary) ?? '（画像生成失败，暂无全景概要）',
    worldSetting: str(parsed.worldSetting),
    mainCharacters: characters && characters.length > 0 ? characters : undefined,
    totalNodes: input.nodes.length,
    isFullyIndexed: false,
    createdAt: now,
    updatedAt: now,
  };
}

export function buildPanoramaPrompt(input: PanoramaInput): string {
  const outline = input.nodes
    .map((node) => (node.depth > 0 ? `  └ ${node.title}` : node.title))
    .join('\n');
  const head = input.fullText.slice(0, PANORAMA_HEAD_CHARS);
  const tail = input.fullText.slice(Math.max(0, input.fullText.length - PANORAMA_TAIL_CHARS));
  return [
    `【书名】${input.bookTitle}`,
    `【全书节点目录（共 ${input.nodes.length} 个节点，缩进行为第二层节点）】\n${outline}`,
    `【正文开篇切片】\n${head}`,
    `【正文结尾切片】\n${tail}`,
    '请输出全景画像 JSON。',
  ].join('\n\n');
}

export interface PanoramaGenerator {
  /** Returns null when the model output is unparsable (caller may retry). */
  generate(input: PanoramaInput, signal?: AbortSignal): Promise<BookPanoramaRecord | null>;
}

export function createPanoramaGenerator(deps: PanoramaGeneratorDeps): PanoramaGenerator {
  const now = deps.now ?? Date.now;
  return {
    generate: async (input, signal) => {
      let raw = '';
      // `await` first: the seam may be a plain async fn returning a generator.
      const deltas = await deps.stream(
        { system: PANORAMA_SYSTEM_PROMPT, prompt: buildPanoramaPrompt(input), signal },
        deps.settings,
      );
      for await (const delta of deltas) raw += delta;
      const parsed = extractJsonObject(raw);
      if (!parsed) return null;
      const panorama = toPanorama(parsed, input, now());
      await deps.repository.put(panorama);
      return panorama;
    },
  };
}

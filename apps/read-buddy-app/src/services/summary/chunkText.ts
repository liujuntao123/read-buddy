/**
 * Map-phase chunking for over-length chapters (ticket 03, ADR 0005): split the chapter into ~6,000~8,000 char blocks whose neighbours
 * share a fixed 500-char overlap, tiling [0, length) with no lost characters.
 *
 * The summarizer only calls this for chapters longer than
 * SUMMARY_SINGLE_PASS_MAX_CHARS (12,000); shorter chapters take the
 * single-pass path and never enter the chunker.
 */
import { SEGMENT_CHUNK_MAX_CHARS, SEGMENT_CHUNK_MIN_CHARS } from '@/types/ai';

/** Default target block length, midway inside the 6,000~8,000 window. */
export const DEFAULT_SUMMARY_CHUNK_CHARS = 7_000;

/** Fixed overlap shared by neighbouring blocks (ADR 0005). */
export const SUMMARY_CHUNK_OVERLAP = 500;

const clampTarget = (targetChunkChars: number): number =>
  Math.min(SEGMENT_CHUNK_MAX_CHARS, Math.max(SEGMENT_CHUNK_MIN_CHARS, Math.round(targetChunkChars)));

/**
 * Split `text` into overlapping chunks:
 * - the requested target is clamped into [6,000, 8,000];
 * - a text at or below the target returns a single chunk;
 * - otherwise offsets advance by `chunkLength - overlap` and the final chunk
 *   takes the whole remainder, so the union covers [0, length) exactly while
 *   every neighbouring pair overlaps by exactly `overlap` characters;
 * - when the tail would collapse into a degenerate sliver the chunk length is
 *   grown (never past 8,000) so blocks stay balanced, e.g. 15,000 chars → two
 *   7,750-char blocks instead of 7,000 + 7,000 + 2,000.
 */
export function chunkNodeText(
  text: string,
  targetChunkChars: number = DEFAULT_SUMMARY_CHUNK_CHARS,
  overlap: number = SUMMARY_CHUNK_OVERLAP,
): string[] {
  const target = clampTarget(targetChunkChars);
  const length = text.length;
  if (length <= target) return [text];

  // Fewest blocks whose 8,000-char cuts cover the text; then spread the text
  // evenly across that many blocks, floor-bounded by the target.
  const blockCount = Math.max(2, Math.ceil((length - overlap) / (SEGMENT_CHUNK_MAX_CHARS - overlap)));
  const balanced = Math.ceil((length + (blockCount - 1) * overlap) / blockCount);
  const chunkLength = Math.min(SEGMENT_CHUNK_MAX_CHARS, Math.max(target, balanced));
  const step = Math.max(1, chunkLength - overlap);

  const chunks: string[] = [];
  let start = 0;
  for (;;) {
    const end = Math.min(start + chunkLength, length);
    chunks.push(text.slice(start, end));
    if (end >= length) break;
    start += step;
  }
  return chunks;
}

/**
 * Fixed-length fallback segmentation (ticket 02, design doc 4.2, ADR 0005).
 *
 * When the regex detector finds nothing (or the user declines), a
 * monolithic book is split into virtual sections of ~7,000 characters,
 * snapped to a paragraph boundary ('\n') when one lies within 800 chars
 * before the target cut, otherwise hard-cut. Sections tile [0, length)
 * with no gaps or overlaps, so slicing the original text at consecutive
 * offsets reproduces it exactly.
 */
import { SEGMENT_CHUNK_MAX_CHARS, SEGMENT_CHUNK_MIN_CHARS, type VirtualSection } from '@/types/ai';

/** Default target chunk length, midway inside the 6,000~8,000 window. */
export const DEFAULT_CHUNK_LENGTH = 7_000;

/** How far back from the ideal cut we search for a paragraph boundary. */
export const NEWLINE_SEARCH_WINDOW = 800;

const clampChunkLength = (chunkLength: number): number =>
  Math.min(SEGMENT_CHUNK_MAX_CHARS, Math.max(SEGMENT_CHUNK_MIN_CHARS, Math.round(chunkLength)));

/**
 * Build fixed-length virtual sections covering the whole text.
 * Titles follow the `第 N/M 部分` shape where M is the actual section
 * count produced by the real cut points.
 */
export function buildFixedLengthSections(
  fullText: string,
  chunkLength: number = DEFAULT_CHUNK_LENGTH,
): VirtualSection[] {
  const target = clampChunkLength(chunkLength);
  const total = fullText.length;

  const offsets: number[] = [0];
  let start = 0;
  while (total - start > target) {
    let end = start + target;
    const windowStart = Math.max(start + 1, end - NEWLINE_SEARCH_WINDOW);
    const newlineIndex = fullText.lastIndexOf('\n', end - 1);
    if (newlineIndex >= windowStart) {
      end = newlineIndex + 1; // keep the newline with the current chunk
    }
    offsets.push(end);
    start = end;
  }

  const count = offsets.length;
  return offsets.map((charOffset, index) => ({
    virtualIndex: index,
    title: `第 ${index + 1}/${count} 部分`,
    charOffset,
  }));
}

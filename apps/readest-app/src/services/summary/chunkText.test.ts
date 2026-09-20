import { describe, expect, it } from 'vitest';
import { chunkChapterText } from './chunkText';
import { SEGMENT_CHUNK_MAX_CHARS, SEGMENT_CHUNK_MIN_CHARS } from '@/types/ai';

/** Position-sensitive filler so loss/ordering bugs cannot cancel out. */
const textOf = (length: number): string =>
  Array.from({ length }, (_, i) => String.fromCharCode(65 + (i % 26))).join('');

describe('chunkChapterText', () => {
  it('returns a single chunk when the text fits the clamped target', () => {
    const short = textOf(6_000);
    expect(chunkChapterText(short)).toEqual([short]);
    // Chapters ≤ 12,000 chars take the single-pass path and never reach the
    // chunker; the ≤-target branch is what keeps that contract single-block.
    expect(chunkChapterText(textOf(5_000), 8_000)).toHaveLength(1);
  });

  it('splits a 12,100-char chapter into 2~3 lossless chunks with a 500-char overlap', () => {
    const length = 12_100;
    const text = textOf(length);
    const chunks = chunkChapterText(text);

    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks.length).toBeLessThanOrEqual(3);

    // Every non-final block stays inside the 6,000~8,000 window.
    chunks.slice(0, -1).forEach((chunk) => {
      expect(chunk.length).toBeGreaterThanOrEqual(SEGMENT_CHUNK_MIN_CHARS);
      expect(chunk.length).toBeLessThanOrEqual(SEGMENT_CHUNK_MAX_CHARS);
    });

    // Neighbouring blocks overlap by exactly 500 characters.
    for (let i = 0; i + 1 < chunks.length; i += 1) {
      expect(chunks[i].slice(-500)).toBe(chunks[i + 1].slice(0, 500));
    }

    // Lossless: blocks are exact slices at consecutive offsets and the final
    // block consumes the tail of [0, length).
    let offset = 0;
    chunks.forEach((chunk) => {
      expect(chunk).toBe(text.slice(offset, offset + chunk.length));
      offset += chunk.length - 500;
    });
    expect(offset + 500).toBe(length);
  });

  it('balances a 15,000-char chapter into two ~7,750-char blocks (no degenerate tail)', () => {
    const chunks = chunkChapterText(textOf(15_000));
    expect(chunks.map((chunk) => chunk.length)).toEqual([7_750, 7_750]);
    expect(chunks[0].slice(-500)).toBe(chunks[1].slice(0, 500));
  });

  it('covers a 20,000-char chapter with three full-size overlapping blocks', () => {
    const text = textOf(20_000);
    const chunks = chunkChapterText(text);
    expect(chunks).toHaveLength(3);
    chunks.forEach((chunk) => {
      expect(chunk.length).toBeGreaterThanOrEqual(SEGMENT_CHUNK_MIN_CHARS);
      expect(chunk.length).toBeLessThanOrEqual(SEGMENT_CHUNK_MAX_CHARS);
    });
    for (let i = 0; i + 1 < chunks.length; i += 1) {
      expect(chunks[i].slice(-500)).toBe(chunks[i + 1].slice(0, 500));
    }
    expect(chunks.join('')).not.toBe(text); // overlap exists
    const stripped = chunks.map((chunk, i) => (i === 0 ? chunk : chunk.slice(500))).join('');
    expect(stripped).toBe(text); // ...and dedup-joining reproduces the source
  });

  it('clamps the requested target into the 6,000~8,000 window', () => {
    const text = textOf(20_000);
    const tiny = chunkChapterText(text, 1_000);
    tiny.slice(0, -1).forEach((chunk) => expect(chunk.length).toBeGreaterThanOrEqual(SEGMENT_CHUNK_MIN_CHARS));

    const huge = chunkChapterText(text, 99_000);
    expect(huge).toHaveLength(3); // 20,000 chars still need 3 blocks at 8,000 max
    huge.slice(0, -1).forEach((chunk) => expect(chunk.length).toBeLessThanOrEqual(SEGMENT_CHUNK_MAX_CHARS));
  });

  it('never emits an empty chunk and always covers the text', () => {
    [12_100, 12_501, 14_000, 16_001, 40_000].forEach((length) => {
      const text = textOf(length);
      const chunks = chunkChapterText(text);
      expect(chunks.length).toBeGreaterThan(1);
      chunks.forEach((chunk) => expect(chunk.length).toBeGreaterThan(0));
      const stripped = chunks.map((chunk, i) => (i === 0 ? chunk : chunk.slice(500))).join('');
      expect(stripped).toBe(text);
    });
  });
});

import { describe, expect, it } from 'vitest';
import { SEGMENT_CHUNK_MAX_CHARS, SEGMENT_CHUNK_MIN_CHARS } from '@/types/ai';
import { buildFixedLengthSections, DEFAULT_CHUNK_LENGTH } from './chunker';

/** ~15,000 chars of paragraph text: 50-char lines joined by '\n'. */
const paragraphsOf = (totalChars: number, lineLength = 50): string => {
  const line = 'a'.repeat(lineLength - 1) + '\n';
  const full = line.repeat(Math.ceil(totalChars / lineLength));
  return full.slice(0, totalChars);
};

const sliceLengths = (text: string, sections: ReturnType<typeof buildFixedLengthSections>) => {
  const offsets = sections.map((s) => s.charOffset);
  return offsets.map((offset, i) =>
    i < offsets.length - 1 ? offsets[i + 1]! - offset : text.length - offset,
  );
};

describe('buildFixedLengthSections', () => {
  it('splits 15,000 chars into 2~3 tiling chunks within the 6,000~8,000 window', () => {
    const text = paragraphsOf(15_000);
    const sections = buildFixedLengthSections(text);

    expect(sections.length).toBeGreaterThanOrEqual(2);
    expect(sections.length).toBeLessThanOrEqual(3);

    const offsets = sections.map((s) => s.charOffset);
    expect(offsets[0]).toBe(0);
    const lengths = sliceLengths(text, sections);
    for (let i = 0; i < lengths.length - 1; i++) {
      expect(lengths[i]).toBeGreaterThanOrEqual(SEGMENT_CHUNK_MIN_CHARS);
      expect(lengths[i]).toBeLessThanOrEqual(SEGMENT_CHUNK_MAX_CHARS);
      expect(offsets[i + 1]).toBe(offsets[i]! + lengths[i]!);
    }
    expect(lengths[lengths.length - 1]).toBeGreaterThan(0);

    // Concatenating every chunk reproduces the original text exactly.
    const reassembled = sections
      .map((s, i) => text.slice(s.charOffset, i < sections.length - 1 ? sections[i + 1]!.charOffset : undefined))
      .join('');
    expect(reassembled).toBe(text);

    // Titles follow 第 N/M 部分 with M = actual count.
    expect(sections.map((s) => s.title)).toEqual(
      Array.from({ length: sections.length }, (_, i) => `第 ${i + 1}/${sections.length} 部分`),
    );
  });

  it('prefers a nearby paragraph boundary over a mid-word hard cut', () => {
    const text = 'x'.repeat(6_500) + '\n' + 'y'.repeat(8_499); // single newline at 6,500
    const sections = buildFixedLengthSections(text);

    expect(sections.length).toBe(3);
    expect(sections[0]!.charOffset).toBe(0);
    expect(sections[1]!.charOffset).toBe(6_501); // snapped right after the newline
    expect(text[sections[1]!.charOffset - 1]).toBe('\n');
    // No newline in the tail: the second cut is a hard cut at exactly the target.
    expect(sections[2]!.charOffset - sections[1]!.charOffset).toBe(DEFAULT_CHUNK_LENGTH);

    const reassembled = text
      .slice(0, sections[1]!.charOffset) + text.slice(sections[1]!.charOffset, sections[2]!.charOffset) +
      text.slice(sections[2]!.charOffset);
    expect(reassembled).toBe(text);
  });

  it('returns a single section for empty and short texts', () => {
    expect(buildFixedLengthSections('')).toEqual([
      { virtualIndex: 0, title: '第 1/1 部分', charOffset: 0 },
    ]);
    const short = '只有几百字的短文本。';
    expect(buildFixedLengthSections(short)).toEqual([
      { virtualIndex: 0, title: '第 1/1 部分', charOffset: 0 },
    ]);
  });

  it('hard-cuts newline-free text at exactly the chunk length', () => {
    const text = 'z'.repeat(20_000);
    const sections = buildFixedLengthSections(text);
    const offsets = sections.map((s) => s.charOffset);
    expect(offsets).toEqual([0, 7_000, 14_000]);
    const lengths = sliceLengths(text, sections);
    expect(lengths.slice(0, -1)).toEqual([7_000, 7_000]);
  });

  it('clamps a custom chunk length into the legal window', () => {
    const text = paragraphsOf(30_000);
    const tooSmall = buildFixedLengthSections(text, 100);
    const lengths = sliceLengths(text, tooSmall);
    for (let i = 0; i < lengths.length - 1; i++) {
      expect(lengths[i]).toBeGreaterThanOrEqual(SEGMENT_CHUNK_MIN_CHARS);
      expect(lengths[i]).toBeLessThanOrEqual(SEGMENT_CHUNK_MAX_CHARS);
    }

    const tooLarge = buildFixedLengthSections(text, 99_999);
    expect(sliceLengths(text, tooLarge).slice(0, -1)).toEqual(
      Array.from({ length: tooLarge.length - 1 }, () => SEGMENT_CHUNK_MAX_CHARS),
    );
  });
});

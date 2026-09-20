import { describe, expect, it } from 'vitest';
import { decodeTxt, parseTxt } from './txtParser';

const toBuffer = (text: string): ArrayBuffer =>
  new TextEncoder().encode(text).buffer as ArrayBuffer;

// GBK code points: 迷 = 0xC3 0xD4, 的 = 0xB5 0xC4.
const gbkBytes = (repeats: number): ArrayBuffer => {
  const pair = [0xc3, 0xd4, 0xb5, 0xc4];
  const bytes: number[] = [];
  for (let i = 0; i < repeats; i++) bytes.push(...pair);
  return new Uint8Array(bytes).buffer as ArrayBuffer;
};

describe('decodeTxt', () => {
  it('decodes utf-8 chinese text unchanged', () => {
    const text = '第一章 风起之地\n\n正文段落。';
    expect(decodeTxt(toBuffer(text))).toBe(text);
  });

  it('falls back to gbk when utf-8 decoding produces >2% replacement chars', () => {
    expect(decodeTxt(gbkBytes(20))).toBe('迷的'.repeat(20));
  });

  it('returns an empty string for empty input', () => {
    expect(decodeTxt(new ArrayBuffer(0))).toBe('');
  });
});

describe('parseTxt', () => {
  it('exposes one section titled after the file, plus the monolithic text', () => {
    const text = '第一章 风起之地\n\n灯火在雾中摇曳。';
    const book = parseTxt(toBuffer(text), 'hash-txt-1', '风起之地');

    expect(book.title).toBe('风起之地');
    expect(book.sectionCount).toBe(1);
    expect(book.getSectionTitle(0)).toBe('风起之地');
    expect(book.getSectionText(0)).toBe(text);
    expect(book.getMonolithicText()).toBe(text);
  });

  it('wraps each non-empty line into an escaped <p>', () => {
    const text = '第一行\n\n<script>alert(1)</script>\n第三行';
    const book = parseTxt(toBuffer(text), 'hash-txt-2', '测试书');

    const html = book.getSectionHtml(0);
    expect(html).toContain('<p>第一行</p>');
    expect(html).toContain('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
    expect(html).toContain('<p>第三行</p>');
    expect(html).not.toContain('<script>');
  });

  it('decodes gbk content into readable chinese', () => {
    const book = parseTxt(gbkBytes(10), 'hash-txt-3', 'GBK 书');
    expect(book.getMonolithicText()).toBe('迷的'.repeat(10));
    expect(book.getSectionHtml(0)).toContain('<p>迷的迷的迷的迷的迷的迷的迷的迷的迷的迷的</p>');
  });
});

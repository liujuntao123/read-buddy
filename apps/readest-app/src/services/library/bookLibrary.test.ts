import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { ReadestPlusDatabase } from '@/services/db/database';
import { clearOpenedBook, getOpenedBook } from './contentRegistry';
import {
  computeBookHash,
  detectFormat,
  importBookFile,
  openBook,
  readLibrary,
  removeBook,
  saveProgress,
} from './bookLibrary';

/** Minimal in-memory EPUB: 3 spine chapters, nav covering the first two. */
async function buildEpubBytes(variant = ''): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip');
  zip.file(
    'META-INF/container.xml',
    '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">' +
      '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
  );
  zip.file(
    'OEBPS/content.opf',
    '<?xml version="1.0" encoding="utf-8"?>' +
      '<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0">' +
      '<metadata><dc:title>迷雾之城</dc:title><dc:creator>林晚</dc:creator></metadata>' +
      '<manifest>' +
      '<item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>' +
      '<item id="ch2" href="ch2.xhtml" media-type="application/xhtml+xml"/>' +
      '<item id="ch3" href="ch3.xhtml" media-type="application/xhtml+xml"/>' +
      '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>' +
      '</manifest>' +
      '<spine><itemref idref="ch1"/><itemref idref="ch2"/><itemref idref="ch3"/></spine>' +
      '</package>',
  );
  const page = (title: string, body: string): string =>
    `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body><h2>${title}</h2><p>${body}</p></body></html>`;
  zip.file('OEBPS/ch1.xhtml', page('第一章 迷雾之城', `灯火在雾中摇曳。${variant}`));
  zip.file('OEBPS/ch2.xhtml', page('第二章 图书馆的密语', '星图亮了起来。'));
  zip.file('OEBPS/ch3.xhtml', page('第三章 长夜漫漫', '长夜第一节。'));
  zip.file(
    'OEBPS/nav.xhtml',
    '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body>' +
      '<nav epub:type="toc"><ol><li><a href="ch1.xhtml">第一章 迷雾之城</a></li>' +
      '<li><a href="ch2.xhtml">第二章 图书馆的密语</a></li></ol></nav></body></html>',
  );
  return zip.generateAsync({ type: 'arraybuffer' });
}

let db: ReadestPlusDatabase;

beforeAll(() => {
  db = new ReadestPlusDatabase(`book-library-test-${Math.random().toString(36).slice(2)}`);
});

afterAll(async () => {
  await db.delete();
});

describe('detectFormat', () => {
  it('maps extensions to formats (case-insensitive)', () => {
    expect(detectFormat('迷雾之城.EPUB')).toBe('epub');
    expect(detectFormat('风起之地.txt')).toBe('txt');
    expect(detectFormat('book.mobi')).toBe('unsupported');
    expect(detectFormat('no-extension')).toBe('unsupported');
  });
});

describe('computeBookHash', () => {
  it('produces a stable 16-hex-char content identity', async () => {
    const bytes = new TextEncoder().encode('hello').buffer as ArrayBuffer;
    const first = await computeBookHash(bytes);
    expect(first).toHaveLength(16);
    expect(first).toBe(await computeBookHash(bytes));
    expect(await computeBookHash(new TextEncoder().encode('world').buffer as ArrayBuffer)).not.toBe(
      first,
    );
    // SHA-256 of the empty input, truncated.
    expect(await computeBookHash(new ArrayBuffer(0))).toBe('e3b0c44298fc1c14');
  });
});

describe('importBookFile', () => {
  it('imports an epub, stores its raw bytes and reads them back', async () => {
    const bytes = await buildEpubBytes();
    const result = await importBookFile(new File([bytes], '随便叫什么.epub'), { db });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.book.title).toBe('迷雾之城'); // dc:title beats the file name
    expect(result.book.author).toBe('林晚');
    expect(result.book.format).toBe('epub');
    expect(result.book.size).toBe(bytes.byteLength);

    const stored = await db.books.get(result.book.hash);
    expect(stored?.data.byteLength).toBe(bytes.byteLength);
  });

  it('rejects a second import of identical content as a duplicate', async () => {
    const bytes = await buildEpubBytes();
    const result = await importBookFile(new File([bytes], '迷雾之城-副本.epub'), { db });
    expect(result.status).toBe('duplicate');
    if (result.status === 'duplicate') {
      expect(result.message).toContain('迷雾之城');
    }
  });

  it('answers unsupported formats with the friendly copy', async () => {
    const result = await importBookFile(new File([new Uint8Array([1])], 'novel.mobi'), { db });
    expect(result.status).toBe('unsupported');
    if (result.status === 'unsupported') {
      expect(result.message).toContain('暂不支持该格式（待 Foliate 引擎接入）');
    }
    expect(await db.books.count()).toBe(1); // only the epub from before
  });
});

describe('openBook / readLibrary / removeBook / saveProgress', () => {
  it('registers epub content in the opened-book registry', async () => {
    const bytes = await buildEpubBytes('（第二版）');
    const epubFile = new File([bytes], '迷雾之城.epub');
    const imported = await importBookFile(epubFile, { db });
    if (imported.status !== 'ok') throw new Error('epub import failed');

    const opened = await openBook(imported.book, { db });
    expect(opened.sectionCount).toBe(3);
    expect(opened.getSectionTitle(0)).toBe('第一章 迷雾之城');
    expect(getOpenedBook(imported.book.hash)?.sectionCount).toBe(3);
  });

  it('registers txt content with its monolithic text', async () => {
    const text = '第一章 风起之地\n\n正文内容第一段。';
    const imported = await importBookFile(new File([new TextEncoder().encode(text)], '风起之地.txt'), {
      db,
    });
    if (imported.status !== 'ok') throw new Error('txt import failed');

    const opened = await openBook(imported.book, { db });
    expect(opened.sectionCount).toBe(1);
    expect(opened.getMonolithicText?.()).toBe(text);
    expect(getOpenedBook(imported.book.hash)?.getSectionText(0)).toContain('正文内容第一段');
  });

  it('lists shelf metadata without raw bytes, persists progress and deletes cleanly', async () => {
    const list = await readLibrary({ db });
    expect(list.length).toBeGreaterThanOrEqual(2);
    expect(list.every((meta) => !('data' in meta))).toBe(true);

    const target = list[0]!;
    await saveProgress(target.hash, 1, { db });
    expect((await db.books.get(target.hash))?.lastSectionIndex).toBe(1);

    await removeBook(target.hash, { db });
    expect(await db.books.get(target.hash)).toBeUndefined();
    expect(getOpenedBook(target.hash)).toBeUndefined();
    clearOpenedBook(target.hash); // idempotent
  });
});

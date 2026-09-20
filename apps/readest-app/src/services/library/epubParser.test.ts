import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { parseEpub } from './epubParser';

/**
 * In-memory minimal EPUB builder: 3 spine chapters (ch3 nested in text/),
 * metadata, and either an EPUB3 nav document and/or an EPUB2 NCX.
 */
async function buildEpub(
  options: { opfPath?: string; nav?: boolean; ncx?: boolean } = {},
): Promise<ArrayBuffer> {
  const zip = new JSZip();
  const opfPath = options.opfPath ?? 'OEBPS/content.opf';
  const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/')) : '';
  const at = (name: string): string => (opfDir ? `${opfDir}/${name}` : name);

  zip.file('mimetype', 'application/epub+zip');
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="${opfPath}" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
  );

  const manifest = [
    '<item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>',
    '<item id="ch2" href="ch2.xhtml" media-type="application/xhtml+xml"/>',
    '<item id="ch3" href="text/ch3.xhtml" media-type="application/xhtml+xml"/>',
  ];
  if (options.nav !== false) {
    manifest.push('<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>');
  }
  if (options.ncx) {
    manifest.push('<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>');
  }
  const spineOpen = options.ncx ? '<spine toc="ncx">' : '<spine>';

  zip.file(
    opfPath,
    `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0" unique-identifier="uid">
  <metadata>
    <dc:title>迷雾之城</dc:title>
    <dc:creator>林晚</dc:creator>
  </metadata>
  <manifest>${manifest.join('')}</manifest>
  ${spineOpen}<itemref idref="ch1"/><itemref idref="ch2"/><itemref idref="ch3"/></spine>
</package>`,
  );

  const page = (title: string, body: string): string => `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>${title}</title></head>
<body>
<h2>${title}</h2>
${body}
<script>alert('xss')</script>
</body>
</html>`;

  zip.file(at('ch1.xhtml'), page('第一章 迷雾之城', '<p>灯火在雾中摇曳。</p>'));
  zip.file(at('ch2.xhtml'), page('第二章 图书馆的密语', '<p>穹顶上的星图亮了起来。</p>'));
  zip.file(at('text/ch3.xhtml'), page('第三章 长夜漫漫', '<p>长夜第一节。</p>'));

  if (options.nav !== false) {
    zip.file(
      at('nav.xhtml'),
      `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>目录</title></head>
<body>
<nav epub:type="toc">
  <ol>
    <li><a href="ch1.xhtml">第一章 迷雾之城</a></li>
    <li><a href="ch2.xhtml">第二章 图书馆的密语</a></li>
  </ol>
</nav>
</body>
</html>`,
    );
  }
  if (options.ncx) {
    zip.file(
      at('toc.ncx'),
      `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head/>
  <docTitle><text>迷雾之城</text></docTitle>
  <navMap>
    <navPoint id="n1"><navLabel><text>第一章 迷雾之城</text></navLabel><content src="ch1.xhtml"/></navPoint>
    <navPoint id="n2"><navLabel><text>第二章 图书馆的密语</text></navLabel><content src="ch2.xhtml"/></navPoint>
  </navMap>
</ncx>`,
    );
  }
  return zip.generateAsync({ type: 'arraybuffer' });
}

describe('parseEpub', () => {
  it('reads Dublin Core metadata, spine order and EPUB3 nav titles', async () => {
    const book = await parseEpub(await buildEpub(), 'hash-1');

    expect(book.title).toBe('迷雾之城');
    expect(book.author).toBe('林晚');
    expect(book.sectionCount).toBe(3);
    expect(book.getSectionTitle(0)).toBe('第一章 迷雾之城');
    expect(book.getSectionTitle(1)).toBe('第二章 图书馆的密语');
    // ch3 is not referenced by the nav → generic fallback title.
    expect(book.getSectionTitle(2)).toBe('第 3 节');
    expect(book.getSectionTitle(99)).toBe('第 100 节');
  });

  it('sanitizes section html and extracts tag-free plain text', async () => {
    const book = await parseEpub(await buildEpub(), 'hash-2');

    const html = book.getSectionHtml(0);
    expect(html).toContain('灯火在雾中摇曳');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('alert');

    const text = book.getSectionText(0);
    expect(text).toContain('第一章 迷雾之城');
    expect(text).toContain('灯火在雾中摇曳');
    expect(text).not.toContain('<');
  });

  it('resolves hrefs when the OPF sits at the archive root', async () => {
    const book = await parseEpub(await buildEpub({ opfPath: 'content.opf' }), 'hash-3');

    expect(book.sectionCount).toBe(3);
    expect(book.getSectionTitle(0)).toBe('第一章 迷雾之城');
    expect(book.getSectionHtml(2)).toContain('长夜第一节');
  });

  it('falls back to the EPUB2 NCX toc when no nav document exists', async () => {
    const book = await parseEpub(await buildEpub({ nav: false, ncx: true }), 'hash-4');

    expect(book.getSectionTitle(0)).toBe('第一章 迷雾之城');
    expect(book.getSectionTitle(1)).toBe('第二章 图书馆的密语');
    expect(book.getSectionTitle(2)).toBe('第 3 节');
  });

  it('falls back to generic section titles without any toc', async () => {
    const book = await parseEpub(await buildEpub({ nav: false }), 'hash-5');

    expect(book.getSectionTitle(0)).toBe('第 1 节');
    expect(book.getSectionTitle(1)).toBe('第 2 节');
    expect(book.getSectionTitle(2)).toBe('第 3 节');
  });

  it('rejects archives without container.xml', async () => {
    const zip = new JSZip();
    zip.file('hello.txt', 'not an epub');
    await expect(parseEpub(await zip.generateAsync({ type: 'arraybuffer' }), 'hash-6')).rejects.toThrow(
      'container.xml',
    );
  });
});

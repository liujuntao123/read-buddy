import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { parseEpub } from './epubParser';

/**
 * In-memory minimal EPUB builder: 3 spine chapters (ch3 nested in text/),
 * metadata, and either an EPUB3 nav document and/or an EPUB2 NCX.
 * `ncxNested` adds a second-level NCX entry anchored *inside* ch2
 * (`#sigil_toc_id_2` on the `<h2>`), mirroring 《何为良好生活》.
 */
async function buildEpub(
  options: { opfPath?: string; nav?: boolean; ncx?: boolean; ncxNested?: boolean } = {},
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

  const page = (title: string, body: string, extra = ''): string => `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>${title}</title></head>
<body>
<h2>${title}</h2>
${body}
${extra}
<script>alert('xss')</script>
</body>
</html>`;

  zip.file(at('ch1.xhtml'), page('第一章 迷雾之城', '<p>灯火在雾中摇曳。</p>'));
  zip.file(
    at('ch2.xhtml'),
    page(
      '第二章 图书馆的密语',
      '<p>穹顶上的星图亮了起来。</p>',
      options.ncxNested ? '<h2 id="sigil_toc_id_2">第二节 星图的秘密</h2><p>秘密藏在星图里。</p>' : '',
    ),
  );
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
    <navPoint id="n2"><navLabel><text>第二章 图书馆的密语</text></navLabel><content src="ch2.xhtml"/>${
      options.ncxNested
        ? `
      <navPoint id="n2-1"><navLabel><text>第二节 星图的秘密</text></navLabel><content src="ch2.xhtml#sigil_toc_id_2"/></navPoint>`
        : ''
    }
    </navPoint>
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
    expect(book.spineCount).toBe(3);
    expect(book.getSpineTitle(0)).toBe('第一章 迷雾之城');
    expect(book.getSpineTitle(1)).toBe('第二章 图书馆的密语');
    // ch3 is not referenced by the nav → generic fallback title.
    expect(book.getSpineTitle(2)).toBe('第 3 节');
    expect(book.getSpineTitle(99)).toBe('第 100 节');
  });

  it('sanitizes section html and extracts tag-free plain text', async () => {
    const book = await parseEpub(await buildEpub(), 'hash-2');

    const html = book.getSpineHtml(0);
    expect(html).toContain('灯火在雾中摇曳');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('alert');

    const text = book.getSpineText(0);
    expect(text).toContain('第一章 迷雾之城');
    expect(text).toContain('灯火在雾中摇曳');
    expect(text).not.toContain('<');
  });

  it('resolves hrefs when the OPF sits at the archive root', async () => {
    const book = await parseEpub(await buildEpub({ opfPath: 'content.opf' }), 'hash-3');

    expect(book.spineCount).toBe(3);
    expect(book.getSpineTitle(0)).toBe('第一章 迷雾之城');
    expect(book.getSpineHtml(2)).toContain('长夜第一节');
  });

  it('falls back to the EPUB2 NCX toc when no nav document exists', async () => {
    const book = await parseEpub(await buildEpub({ nav: false, ncx: true }), 'hash-4');

    expect(book.getSpineTitle(0)).toBe('第一章 迷雾之城');
    expect(book.getSpineTitle(1)).toBe('第二章 图书馆的密语');
    expect(book.getSpineTitle(2)).toBe('第 3 节');
  });

  it('exposes the directory tree with its depth, href and spine resolution', async () => {
    const book = await parseEpub(
      await buildEpub({ nav: false, ncx: true, ncxNested: true }),
      'hash-toc-1',
    );

    expect(book.getTocEntries()).toEqual([
      { label: '第一章 迷雾之城', depth: 0, spineIndex: 0, anchor: undefined, href: 'ch1.xhtml' },
      { label: '第二章 图书馆的密语', depth: 0, spineIndex: 1, anchor: undefined, href: 'ch2.xhtml' },
      {
        label: '第二节 星图的秘密',
        depth: 1,
        spineIndex: 1,
        anchor: 'sigil_toc_id_2',
        href: 'ch2.xhtml#sigil_toc_id_2',
      },
    ]);
    // unresolved entries surface as -1 rather than disappearing
    const navOnly = await parseEpub(await buildEpub(), 'hash-toc-nav');
    expect(navOnly.getTocEntries().map((entry) => [entry.label, entry.depth, entry.spineIndex])).toEqual([
      ['第一章 迷雾之城', 0, 0],
      ['第二章 图书馆的密语', 0, 1],
    ]);
  });

  it('finds a directory anchor inside a spine section at its line start', async () => {
    const book = await parseEpub(
      await buildEpub({ nav: false, ncx: true, ncxNested: true }),
      'hash-toc-2',
    );

    // Sanitizing drops `id`, so the anchor could only be found in the
    // pristine markup — the two are extracted together.
    expect(book.getSpineHtml(1)).toContain('第二节 星图的秘密');
    expect(book.getSpineHtml(1)).not.toContain('sigil_toc_id_2');

    const anchors = book.getSpineAnchors(1);
    expect(anchors.map((anchor) => anchor.id)).toEqual(['sigil_toc_id_2']);
    expect(anchors[0]!.offset).toBeGreaterThan(0);

    const text = book.getSpineText(1);
    expect(text.slice(anchors[0]!.offset).split('\n')[0]).toBe('第二节 星图的秘密');
    // sections the directory places nothing inside report an empty list
    expect(book.getSpineAnchors(0)).toEqual([]);
    expect(book.getSpineAnchors(99)).toEqual([]);
  });

  it('falls back to generic section titles without any toc', async () => {
    const book = await parseEpub(await buildEpub({ nav: false }), 'hash-5');

    expect(book.getSpineTitle(0)).toBe('第 1 节');
    expect(book.getSpineTitle(1)).toBe('第 2 节');
    expect(book.getSpineTitle(2)).toBe('第 3 节');
  });

  it('extracts cover image when cover item exists in manifest', async () => {
    const zip = new JSZip();
    const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>封面测试书</dc:title>
  </metadata>
  <manifest>
    <item id="cover-img" href="cover.jpg" media-type="image/jpeg" properties="cover-image"/>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="ch1"/></spine>
</package>`;

    zip.file('mimetype', 'application/epub+zip');
    zip.file(
      'META-INF/container.xml',
      `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`,
    );
    zip.file('content.opf', opf);
    zip.file('cover.jpg', new Uint8Array([0xff, 0xd8, 0xff, 0xe0]));
    zip.file(
      'ch1.xhtml',
      `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>第一章</title></head><body><p>正文</p></body></html>`,
    );

    const book = await parseEpub(await zip.generateAsync({ type: 'arraybuffer' }), 'hash-cover');
    expect(book.cover).toBeDefined();
    expect(book.cover).toContain('data:image/jpeg;base64,');
  });

  it('rejects archives without container.xml', async () => {
    const zip = new JSZip();
    zip.file('hello.txt', 'not an epub');
    await expect(parseEpub(await zip.generateAsync({ type: 'arraybuffer' }), 'hash-6')).rejects.toThrow(
      'container.xml',
    );
  });
});

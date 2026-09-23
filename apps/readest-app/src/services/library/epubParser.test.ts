import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { readEpubMetadata } from './epubParser';

/**
 * EPUB metadata reader (候选 9). These tests cover the **cheap** half of
 * ingestion: Dublin Core, cover, and the spine-length guard. The full spine
 * pipeline that used to be exercised here (per-section inflate + sanitize + text
 * extraction, directory href resolution, anchor offsets) is gone — no production
 * path ever consumed it, and the reader resolves the directory itself inside the
 * Foliate engine.
 */

/** Minimal EPUB: metadata, a manifest and a spine. */
async function buildEpub(
  options: { opfPath?: string; omitSection?: boolean; emptySpine?: boolean } = {},
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

  const spine = options.emptySpine
    ? '<spine></spine>'
    : '<spine><itemref idref="ch1"/><itemref idref="ch2"/><itemref idref="ch3"/></spine>';

  zip.file(
    opfPath,
    `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0" unique-identifier="uid">
  <metadata>
    <dc:title>迷雾之城</dc:title>
    <dc:creator>林晚</dc:creator>
  </metadata>
  <manifest>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="ch2.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch3" href="text/ch3.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  ${spine}
</package>`,
  );

  if (!options.omitSection) {
    const page = (title: string): string => `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title></head>
<body><h2>${title}</h2><p>灯火在雾中摇曳。</p></body></html>`;
    zip.file(at('ch1.xhtml'), page('第一章 迷雾之城'));
    zip.file(at('ch2.xhtml'), page('第二章 图书馆的密语'));
    zip.file(at('text/ch3.xhtml'), page('第三章 长夜漫漫'));
  }

  return zip.generateAsync({ type: 'arraybuffer' });
}

describe('readEpubMetadata', () => {
  it('reads Dublin Core metadata and the spine length', async () => {
    const meta = await readEpubMetadata(await buildEpub(), 'hash-1');

    expect(meta.title).toBe('迷雾之城');
    expect(meta.author).toBe('林晚');
    expect(meta.spineCount).toBe(3);
  });

  it('resolves the OPF when it sits at the archive root', async () => {
    const meta = await readEpubMetadata(await buildEpub({ opfPath: 'content.opf' }), 'hash-2');

    expect(meta.title).toBe('迷雾之城');
    expect(meta.spineCount).toBe(3);
  });

  it('does not depend on the spine sections being readable', async () => {
    // Import no longer inflates the book: a declared section that is missing from
    // the archive cannot fail the import (候选 9 — O(metadata), not O(book)).
    const meta = await readEpubMetadata(await buildEpub({ omitSection: true }), 'hash-3');

    expect(meta.title).toBe('迷雾之城');
    expect(meta.spineCount).toBe(3);
  });

  it('extracts a cover declared with EPUB3 properties="cover-image"', async () => {
    const zip = new JSZip();
    zip.file('mimetype', 'application/epub+zip');
    zip.file(
      'META-INF/container.xml',
      `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`,
    );
    zip.file(
      'content.opf',
      `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>封面测试书</dc:title></metadata>
  <manifest>
    <item id="cover-img" href="cover.jpg" media-type="image/jpeg" properties="cover-image"/>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="ch1"/></spine>
</package>`,
    );
    zip.file('cover.jpg', new Uint8Array([0xff, 0xd8, 0xff, 0xe0]));

    const meta = await readEpubMetadata(await zip.generateAsync({ type: 'arraybuffer' }), 'hash-cover');
    expect(meta.cover).toBeDefined();
    expect(meta.cover).toContain('data:image/jpeg;base64,');
  });

  it('extracts a cover declared through the EPUB2 meta[name="cover"] pointer', async () => {
    const zip = new JSZip();
    zip.file(
      'META-INF/container.xml',
      `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`,
    );
    zip.file(
      'content.opf',
      `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>旧格式书</dc:title>
    <meta name="cover" content="the-cover"/>
  </metadata>
  <manifest>
    <item id="the-cover" href="images/front.png" media-type="image/png"/>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="ch1"/></spine>
</package>`,
    );
    zip.file('images/front.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47]));

    const meta = await readEpubMetadata(await zip.generateAsync({ type: 'arraybuffer' }), 'hash-cover-2');
    expect(meta.cover).toContain('data:image/png;base64,');
  });

  it('rejects an archive without container.xml', async () => {
    const zip = new JSZip();
    zip.file('hello.txt', 'not an epub');
    await expect(
      readEpubMetadata(await zip.generateAsync({ type: 'arraybuffer' }), 'hash-4'),
    ).rejects.toThrow('container.xml');
  });

  it('rejects an EPUB that declares no spine', async () => {
    // The guard is preserved even though nothing is inflated to enforce it: the
    // OPF is already in memory, so counting itemrefs is free.
    await expect(
      readEpubMetadata(await buildEpub({ emptySpine: true }), 'hash-5'),
    ).rejects.toThrow('spine 为空');
  });
});
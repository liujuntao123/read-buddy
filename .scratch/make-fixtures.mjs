// Generates test fixtures: a cover-bearing EPUB and a long TXT.
// Run from repo root: node .scratch/make-fixtures.mjs
import JSZip from 'jszip';
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const zip = new JSZip();
zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
zip.file(
  'META-INF/container.xml',
  `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
);

// 1x1 would be too trivial for cover rendering checks; make a 120x160 PNG with a red pixel field.
// Minimal valid PNG built by hand: 8-bit RGB, no interlace.
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function makePng(w, h, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit, truecolor RGB
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = rgb[0]; raw[o + 1] = rgb[1]; raw[o + 2] = rgb[2];
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
const coverPng = makePng(120, 160, [180, 60, 60]);
zip.file('OEBPS/cover.png', coverPng);

const page = (title, paragraphs) =>
  `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>${title}</title></head>
<body><h2>${title}</h2>${paragraphs.map((p) => `<p>${p}</p>`).join('\n')}</body>
</html>`;

const fill = (n, seed) =>
  Array.from({ length: n }, (_, i) => `这是第${seed}章的第${i + 1}段内容，雾气在街道上缓缓流动，灯火忽明忽暗。`).join('');

zip.file('OEBPS/ch1.xhtml', page('第一章 迷雾之城', [fill(30, 1)]));
zip.file('OEBPS/ch2.xhtml', page('第二章 图书馆的密语', [fill(30, 2)]));
zip.file('OEBPS/ch3.xhtml', page('第三章 长夜漫漫', [fill(30, 3)]));
zip.file(
  'OEBPS/nav.xhtml',
  `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>目录</title></head>
<body><nav epub:type="toc"><ol>
<li><a href="ch1.xhtml">第一章 迷雾之城</a></li>
<li><a href="ch2.xhtml">第二章 图书馆的密语</a></li>
<li><a href="ch3.xhtml">第三章 长夜漫漫</a></li>
</ol></nav></body>
</html>`,
);
zip.file(
  'OEBPS/content.opf',
  `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0" unique-identifier="uid">
  <metadata>
    <dc:title>迷雾之城</dc:title>
    <dc:creator>林晚</dc:creator>
    <meta name="cover" content="cover-img"/>
  </metadata>
  <manifest>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="ch2.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch3" href="ch3.xhtml" media-type="application/xhtml+xml"/>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="cover-img" href="cover.png" media-type="image/png" properties="cover-image"/>
  </manifest>
  <spine><itemref idref="ch1"/><itemref idref="ch2"/><itemref idref="ch3"/></spine>
</package>`,
);

const epubBuf = await zip.generateAsync({ type: 'nodebuffer' });
writeFileSync('.scratch/fixtures/mist-city.epub', epubBuf);

const txtChapters = Array.from(
  { length: 12 },
  (_, i) =>
    `第${i + 1}章 试炼\n\n` +
    Array.from({ length: 20 }, (_, j) => ` TXT正文第${i + 1}章第${j + 1}段：山风掠过谷底，带来远方的消息。`).join('\n'),
);
writeFileSync('.scratch/fixtures/long-story.txt', txtChapters.join('\n\n'), 'utf-8');
console.log('fixtures written:', '.scratch/fixtures/mist-city.epub', '.scratch/fixtures/long-story.txt');

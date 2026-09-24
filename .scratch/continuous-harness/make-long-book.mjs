// Generates the tall multi-chapter EPUB fixture for the continuous-scroll harness:
// `chapters` linear chapters (each `paragraphs` long, every paragraph prefixed
// `CHnPm` so assertions can name the text under the viewport, chapter head and
// middle paragraph anchored) plus one `linear="no"` auxiliary section at the end
// (spine index === chapters), which the reading flow must never mount.
//
// Usage: node make-long-book.mjs <out.epub> [chapters] [paragraphsPerChapter]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** jszip lives in the app workspace, not here; resolve it either way. */
const loadJSZip = async () => {
  try {
    return (await import('jszip')).default;
  } catch {
    const pnpm = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../node_modules/.pnpm',
    );
    const dir = fs.readdirSync(pnpm).find((name) => name.startsWith('jszip@'));
    if (!dir) throw new Error('jszip not found; run from the repo or `pnpm add -D jszip`');
    const entry = path.join(pnpm, dir, 'node_modules/jszip/lib/index.js');
    return (await import(pathToFileURL(entry).href)).default;
  }
};
const JSZip = await loadJSZip();

const out = process.argv[2] ?? 'long-book.epub';
const chapterCount = Number(process.argv[3] ?? 10);
const paragraphs = Number(process.argv[4] ?? 60);

const zip = new JSZip();

const item = (id, href, extra = '') =>
  `<item id="${id}" href="${href}" media-type="application/xhtml+xml"${extra ? ` properties="${extra}"` : ''}/>`;

const chapter = (n) => `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>第${n}章 长卷</title></head>
<body><h2 id="head">第${n}章 长卷</h2>
${Array.from({ length: paragraphs }, (_, i) => {
  const id = i === 29 ? ' id="mid"' : '';
  return `<p${id}>CH${n}P${i + 1} 雾气在街道上缓缓流动，灯火忽明忽暗，钟楼敲响了第${i + 1}声，夜色漫过城墙。</p>`;
}).join('\n')}
</body>
</html>`;

const aux = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>AUX 附录</title></head>
<body><h2>AUX 附录</h2><p>AUXPARA 本页是 linear="no" 的辅助内容，阅读流必须跳过它。</p></body>
</html>`;

zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
zip.file('META-INF/container.xml', `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`);
zip.file('OEBPS/content.opf', `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0" unique-identifier="uid">
  <metadata>
    <dc:title>长卷测试书</dc:title>
    <dc:creator>harness</dc:creator>
    <dc:identifier id="uid">harness-long-book</dc:identifier>
  </metadata>
  <manifest>
${Array.from({ length: chapterCount }, (_, i) => `    ${item(`ch${i + 1}`, `ch${i + 1}.xhtml`)}`).join('\n')}
    ${item('aux', 'aux.xhtml')}
    ${item('nav', 'nav.xhtml', 'nav')}
  </manifest>
  <spine>
${Array.from({ length: chapterCount }, (_, i) => `    <itemref idref="ch${i + 1}"/>`).join('\n')}
    <itemref idref="aux" linear="no"/>
  </spine>
</package>`);
zip.file('OEBPS/nav.xhtml', `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>目录</title></head>
<body><nav epub:type="toc"><ol>
<li><a href="ch1.xhtml">第1章 长卷</a></li>
<li><a href="ch5.xhtml#mid">第五章中段</a></li>
<li><a href="ch10.xhtml">第10章 长卷</a></li>
</ol></nav></body>
</html>`);
for (let i = 1; i <= chapterCount; i += 1) zip.file(`OEBPS/ch${i}.xhtml`, chapter(i));
zip.file('OEBPS/aux.xhtml', aux);

const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
fs.writeFileSync(out, buffer);
console.log(
  `wrote ${out} (${buffer.length} bytes, ${chapterCount} linear chapters x ${paragraphs} paragraphs + 1 non-linear)`,
);

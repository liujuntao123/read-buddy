/**
 * Visual/behavioural verification fixture (throwaway, lives in .scratch).
 *
 * Reproduces the three shapes this change set is about, in one book:
 *
 * 1. 《说理》's directory shape — 章 row and its first 节 row name the SAME file,
 *    the 节 with an anchor (`第1章 → ch1.xhtml`, `§1.1 → ch1.xhtml#s1`), which is
 *    what made 「上一节」 re-render the page the reader was already on;
 * 2. front matter that must NOT offer a 总结按钮 — a 版权信息 page and a 目录 page;
 * 3. a very long `dc:title`, so the shelf's 「继续阅读《…》」 button has to truncate.
 *
 * Run from the repo root: node .scratch/make-visual-fixture.mjs
 */
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';

const require = createRequire(
  'file:///C:/Users/admin/myspace/readest-plus/apps/readest-app/package.json',
);
const JSZip = require('jszip');

const zip = new JSZip();
zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
zip.file(
  'META-INF/container.xml',
  `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
);

const LONG_TITLE =
  '迷雾之城【一部关于灯塔、星图与守望的悬疑长篇，守夜人追寻灯塔熄灭之谜，跨越双塔的守望约定】';

const page = (body) => `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>${LONG_TITLE}</title></head>
<body>${body}</body>
</html>`;

const fill = (n, seed) =>
  Array.from(
    { length: n },
    (_, i) =>
      `<p>第${seed}段之${i + 1}：雾气在街道上缓缓流动，灯火忽明忽暗，守夜人沿着石阶向上，听见远处传来潮水拍打礁石的声音。他把信纸折好放进衣袋，继续往上走。</p>`,
  ).join('\n');

// 版权信息: a real CIP-shaped page — plenty of characters, nothing to summarize.
zip.file(
  'OEBPS/front0.xhtml',
  page(`<h1>版权信息</h1>
<p>图书在版编目（CIP）数据</p>
<p>迷雾之城 / 林晚著. — 北京：华夏出版社，2011.1</p>
<p>ISBN 978-7-5080-6234-5</p>
<p>中国版本图书馆CIP数据核字（2010）第234567号</p>
<p>责任编辑：李某某</p>
<p>封面设计：某某某</p>
<p>出版发行：华夏出版社</p>
<p>经销：新华书店</p>
<p>印刷：北京某某印刷有限公司</p>
<p>开本：880×1230 1/32</p>
<p>印张：12.5</p>
<p>字数：300千字</p>
<p>版次：2011年1月第1版</p>
<p>印次：2011年1月第1次印刷</p>
<p>定价：38.00元</p>
<p>版权所有·侵权必究</p>`),
);

// 目录: a printed contents page.
zip.file(
  'OEBPS/front1.xhtml',
  page(`<h1>目录</h1>
<p>第1章 迷雾之城 …… 1</p>
<p>§1.1 起雾 …… 1</p>
<p>§1.2 图书馆的密语 …… 12</p>
<p>第2章 长夜漫漫 …… 55</p>
<p>§2.1 星图 …… 55</p>
<p>§2.2 密语 …… 61</p>`),
);

// 第1章 and its first 节 live in ONE file (the 说理 shape).
zip.file(
  'OEBPS/ch1.xhtml',
  page(`<h1>第1章 迷雾之城</h1>
<h2 id="s1">§1.1 起雾</h2>
${fill(12, 1)}`),
);
zip.file('OEBPS/ch2.xhtml', page(`<h2>§1.2 图书馆的密语</h2>\n${fill(12, 2)}`));
zip.file(
  'OEBPS/ch3.xhtml',
  page(`<h1>第2章 长夜漫漫</h1>
<h2 id="s1">§2.1 星图</h2>
${fill(12, 3)}`),
);
zip.file('OEBPS/ch4.xhtml', page(`<h2>§2.2 密语</h2>\n${fill(12, 4)}`));

zip.file(
  'OEBPS/nav.xhtml',
  `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>目录</title></head>
<body><nav epub:type="toc"><ol>
<li><a href="front0.xhtml">版权信息</a></li>
<li><a href="front1.xhtml">目录</a></li>
<li><a href="ch1.xhtml">第1章 迷雾之城</a>
  <ol>
    <li><a href="ch1.xhtml#s1">§1.1 起雾</a></li>
    <li><a href="ch2.xhtml">§1.2 图书馆的密语</a></li>
  </ol>
</li>
<li><a href="ch3.xhtml">第2章 长夜漫漫</a>
  <ol>
    <li><a href="ch3.xhtml#s1">§2.1 星图</a></li>
    <li><a href="ch4.xhtml">§2.2 密语</a></li>
  </ol>
</li>
</ol></nav></body>
</html>`,
);

zip.file(
  'OEBPS/content.opf',
  `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0" unique-identifier="uid">
  <metadata>
    <dc:title>${LONG_TITLE}</dc:title>
    <dc:creator>林晚</dc:creator>
    <dc:language>zh-CN</dc:language>
  </metadata>
  <manifest>
    <item id="front0" href="front0.xhtml" media-type="application/xhtml+xml"/>
    <item id="front1" href="front1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="ch2.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch3" href="ch3.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch4" href="ch4.xhtml" media-type="application/xhtml+xml"/>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
  </manifest>
  <spine>
    <itemref idref="front0"/>
    <itemref idref="front1"/>
    <itemref idref="ch1"/>
    <itemref idref="ch2"/>
    <itemref idref="ch3"/>
    <itemref idref="ch4"/>
  </spine>
</package>`,
);

const buffer = await zip.generateAsync({ type: 'nodebuffer' });
const out = '.scratch/fixtures/shuoli-shape.epub';
writeFileSync(out, buffer);
console.log('fixture written:', out, buffer.length, 'bytes');
console.log('title length:', LONG_TITLE.length);

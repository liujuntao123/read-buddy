// Synthesize a reproduction EPUB structurally identical to the user's book:
// recovered OPF/NCX/container/TOC-page + recovered chapters where available +
// synthesized chapters (same anchor ids) for the missing ones.
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync } from 'node:fs';
import { execSync } from 'node:child_process';

const root = 'C:/Users/admin/myspace/readest-plus/.scratch/debug';
const build = `${root}/synth`;
rmSync(build, { recursive: true, force: true });
mkdirSync(`${build}/META-INF`, { recursive: true });
mkdirSync(`${build}/OEBPS`, { recursive: true });

writeFileSync(`${build}/mimetype`, 'application/epub+zip');
cpSync(`${root}/stream_109.xml`, `${build}/META-INF/container.xml`);
cpSync(`${root}/stream_333.xml`, `${build}/OEBPS/content.opf`);
cpSync(`${root}/heliang-extract/OEBPS/toc.ncx`, `${build}/OEBPS/toc.ncx`);
cpSync(`${root}/heliang-extract/OEBPS/text00000.html`, `${build}/OEBPS/text00000.html`);
for (const f of ['flow0001.css', 'flow0002.css', 'text00004.html', 'text00006.html', 'text00008.html', 'text00009.html']) {
  cpSync(`${root}/heliang-extract/OEBPS/${f}`, `${build}/OEBPS/${f}`);
}

// Chapter meta from the recovered toc.ncx: file -> [title, anchor ids]
const chapters = {
  text00001: { title: '版权页', ids: [] },
  text00002: { title: '序言', ids: [] },
  text00003: { title: '第一章　伦理与伦理学', ids: ['sigil_toc_id_1','sigil_toc_id_2','sigil_toc_id_3','sigil_toc_id_4','sigil_toc_id_5','sigil_toc_id_6','sigil_toc_id_7','sigil_toc_id_8'] },
  text00005: { title: '第三章　事实与价值', ids: ['sigil_toc_id_17','sigil_toc_id_18','sigil_toc_id_19','sigil_toc_id_20','sigil_toc_id_21','sigil_toc_id_22','sigil_toc_id_23','sigil_toc_id_24','sigil_toc_id_25'] },
  text00007: { title: '第五章　知行关系', ids: ['sigil_toc_id_36','sigil_toc_id_37','sigil_toc_id_38','sigil_toc_id_39','sigil_toc_id_40','sigil_toc_id_41','sigil_toc_id_42','sigil_toc_id_43'] },
  text00010: { title: '第八章　个殊者与普遍性', ids: ['sigil_toc_id_63','sigil_toc_id_64','sigil_toc_id_65','sigil_toc_id_66','sigil_toc_id_67','sigil_toc_id_68','sigil_toc_id_69','sigil_toc_id_70'] },
};

const filler = (i) => `这是一段用于复现问题的合成正文内容，第${i}段。伦理学之为伦理领域的穷理，说理与劝求贯穿其中。良好生活既包含行之于途，也包含应于心。`.repeat(3);

for (const [file, ch] of Object.entries(chapters)) {
  const parts = [];
  parts.push('<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org/1999/xhtml"><html xmlns="http://www.w3.org/1999/xhtml">');
  parts.push('<head><title></title><link href="flow0002.css" rel="stylesheet" type="text/css" /></head><body>');
  if (file === 'text00010') parts.push('<div><a id="noteBack_1" href="text00010.html#note_1">[1]</a></div>');
  parts.push(`<h1 class="kindle-cn-heading-1">${ch.title}</h1>`);
  if (ch.ids.length === 0) {
    for (let i = 0; i < 40; i++) parts.push(`<p>${filler(i)}</p>`);
  } else {
    let n = 1;
    for (const id of ch.ids) {
      parts.push(`<h2 class="kindle-cn-heading2" id="${id}">第${n}节　合成小节标题</h2>`);
      for (let i = 0; i < 15; i++) parts.push(`<p>${filler(n * 100 + i)}</p>`);
      n++;
    }
  }
  parts.push('</body></html>');
  writeFileSync(`${build}/OEBPS/${file}.html`, parts.join('\n'), 'utf8');
}

// placeholder images (manifest references them)
for (const img of ['Image00000.jpg', 'Image00001.jpg', 'Image00002.jpg', 'Image00003.jpg']) {
  // 1x1 gray JPEG
  const b64 = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwcJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPDs0NDT/wAALCAABAAEBAREA/8QAFAABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AmAA//9k=';
  writeFileSync(`${build}/OEBPS/${img}`, Buffer.from(b64, 'base64'));
}

// zip it (store mimetype first, deflate rest) via PowerShell Compress-Archive is unreliable
// for mimetype ordering — use Node with the same zip writer as rebuild-epub.mjs
const files = ['mimetype', 'META-INF/container.xml', 'OEBPS/content.opf', 'OEBPS/toc.ncx',
  ...Array.from({length: 11}, (_, i) => `OEBPS/text${String(i).padStart(5,'0')}.html`),
  'OEBPS/flow0001.css', 'OEBPS/flow0002.css',
  'OEBPS/Image00000.jpg', 'OEBPS/Image00001.jpg', 'OEBPS/Image00002.jpg', 'OEBPS/Image00003.jpg'];
const { deflateRawSync } = await import('node:zlib');
const chunks = [], central = [];
let offset = 0;
const crcTable = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
const crc32 = buf => { let c = 0xffffffff; for (const b of buf) c = (c >>> 8) ^ crcTable[(c ^ b) & 0xff]; return (c ^ 0xffffffff) >>> 0; };
for (const f of files) {
  const data = readFileSync(`${build}/${f}`);
  const nameBuf = Buffer.from(f, 'utf8');
  const store = f === 'mimetype' || f.endsWith('.jpg');
  const payload = store ? data : deflateRawSync(data);
  const method = store ? 0 : 8;
  const lh = Buffer.alloc(30);
  lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6);
  lh.writeUInt16LE(method, 8); lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0, 12);
  lh.writeUInt32LE(crc32(data), 14); lh.writeUInt32LE(payload.length, 18); lh.writeUInt32LE(data.length, 22);
  lh.writeUInt16LE(nameBuf.length, 26); lh.writeUInt16LE(0, 28);
  chunks.push(lh, nameBuf, payload);
  central.push({ nameBuf, crc: crc32(data), compSize: payload.length, size: data.length, method, offset });
  offset += 30 + nameBuf.length + payload.length;
}
let cdSize = 0;
for (const c of central) {
  const ch = Buffer.alloc(46);
  ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6);
  ch.writeUInt16LE(0, 8); ch.writeUInt16LE(c.method, 10);
  ch.writeUInt32LE(c.crc, 16); ch.writeUInt32LE(c.compSize, 20); ch.writeUInt32LE(c.size, 24);
  ch.writeUInt16LE(c.nameBuf.length, 28); ch.writeUInt32LE(c.offset, 42);
  chunks.push(ch, c.nameBuf);
  cdSize += 46 + c.nameBuf.length;
}
const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(central.length, 8); eocd.writeUInt16LE(central.length, 10);
eocd.writeUInt32LE(cdSize, 12); eocd.writeUInt32LE(offset, 16);
chunks.push(eocd);
writeFileSync(`${root}/heliang-fixture.epub`, Buffer.concat(chunks));
console.log('wrote heliang-fixture.epub,', files.length, 'files');

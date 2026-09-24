import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire('file:///C:/Users/admin/myspace/read-buddy/apps/read-buddy-app/package.json');
const JSZip = require('jszip');

const zip = await JSZip.loadAsync(readFileSync(process.argv[2]));
const opfPath = process.argv[3];
const opf = await zip.file(opfPath).async('string');
const dir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/')) : '';

const manifest = new Map();
for (const m of opf.matchAll(/<item\b([^>]*?)\/?>/g)) {
  const get = (n) => new RegExp(`\\b${n}\\s*=\\s*"([^"]*)"`).exec(m[1])?.[1];
  if (get('id')) manifest.set(get('id'), get('href'));
}
const spine = [...opf.matchAll(/<itemref\b([^>]*?)\/?>/g)].map(
  (m) => /\bidref\s*=\s*"([^"]*)"/.exec(m[1])?.[1],
);
const paths = spine.map((id) => (dir ? dir + '/' : '') + manifest.get(id));

const ncxName = [...manifest.entries()].find(([k]) => k === 'ncx')?.[1] ?? 'toc.ncx';
const ncx = await zip.file(dir ? `${dir}/${ncxName}` : ncxName).async('string');
const tocTargets = new Set(
  [...ncx.matchAll(/<content[^>]*src="([^"]+)"/g)].map((m) => m[1].split('#')[0].split('/').pop()),
);
const bare = (p) => p.split('/').pop();

console.log('ncx file used:', dir ? `${dir}/${ncxName}` : ncxName);
console.log('first 5 toc targets:', [...tocTargets].slice(0, 5).join(' | '));
console.log('first 5 spine paths:', paths.slice(0, 5).join(' | '));
console.log('spine count:', paths.length, '| toc targets:', tocTargets.size);
const covered = paths.filter((p) => tocTargets.has(bare(p)));
console.log('spine files WITH a TOC entry :', covered.length);
console.log('spine files WITHOUT           :', paths.length - covered.length);
console.log('\nfirst 24 spine files (mark = has TOC entry):');
paths.slice(0, 24).forEach((p, i) => {
  const base = p.split('/').pop();
  console.log(`  ${tocTargets.has(base) ? 'TOC' : '   '} ${String(i).padStart(3)} ${base}`);
});

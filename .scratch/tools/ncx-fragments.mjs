import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire('file:///C:/Users/admin/myspace/read-buddy/apps/read-buddy-app/package.json');
const JSZip = require('jszip');

const file = process.argv[2];
const entry = process.argv[3];
const zip = await JSZip.loadAsync(readFileSync(file));
const raw = await zip.file(entry).async('string');
const srcs = [...raw.matchAll(/<content[^>]*src="([^"]+)"/g)].map((m) => m[1]);
console.log('total <content src>:', srcs.length);
console.log('with #fragment     :', srcs.filter((s) => s.includes('#')).length);
console.log('sample:');
srcs.slice(0, 16).forEach((s) => console.log('   ', s));

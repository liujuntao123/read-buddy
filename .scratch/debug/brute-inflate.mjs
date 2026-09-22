// Brute-force recover deflate streams in a byte region damaged by holes.
import { readFileSync, writeFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

const buf = readFileSync(process.argv[2]);
const from = parseInt(process.argv[3], 10);
const to = parseInt(process.argv[4], 10);

const found = [];
for (let s = from; s < to; s++) {
  for (let e = to; e > s + 40; e--) {
    let out;
    try { out = inflateRawSync(buf.subarray(s, e)); } catch { continue; }
    const text = out.toString('utf8');
    if (text.includes('<') && /[a-zA-Z]{3}/.test(text)) {
      found.push({ s, e, len: out.length, text });
      console.log(`HIT start=${s} end=${e} len=${out.length}`);
      writeFileSync(`C:/Users/admin/myspace/readest-plus/.scratch/debug/recovered_${s}.xml`, out);
      // skip past this stream
      s = e;
      break;
    }
  }
}
console.log(`done, ${found.length} streams`);

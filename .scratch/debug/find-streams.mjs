// Sequentially recover deflate streams: find minimal end for each start.
import { readFileSync, writeFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

const buf = readFileSync(process.argv[2]);
const from = parseInt(process.argv[3], 10);
const to = parseInt(process.argv[4], 10);

let s = from;
let count = 0;
while (s < to && count < 20) {
  let hit = null;
  // find the first start >= s that begins a valid stream
  outer:
  for (let st = s; st < to - 40; st++) {
    // ascending end to find minimal valid end quickly
    for (let e = st + 40; e <= to; e++) {
      let out;
      try { out = inflateRawSync(buf.subarray(st, e)); } catch { continue; }
      const text = out.toString('utf8');
      if (text.includes('<')) {
        hit = { st, e, out, text };
        break outer;
      }
      break; // stream ended but content not xml — skip this start
    }
  }
  if (!hit) break;
  // minimize e: find smallest end that still inflates
  let minE = hit.e;
  for (let e = hit.st + 40; e < hit.e; e++) {
    try { inflateRawSync(buf.subarray(hit.st, e)); minE = e; break; } catch {}
  }
  console.log(`stream start=${hit.st} end=${minE} len=${hit.out.length}`);
  writeFileSync(`C:/Users/admin/myspace/read-buddy/.scratch/debug/stream_${hit.st}.xml`, hit.out);
  s = minE + 1;
  count++;
}
console.log('done');

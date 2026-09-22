// Parse local file headers from a (possibly truncated) ZIP prefix.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

const path = process.argv[2];
const buf = readFileSync(path);
let off = 0;
let i = 0;
mkdirSync('C:/Users/admin/myspace/readest-plus/.scratch/debug/entries', { recursive: true });
while (off + 30 <= buf.length && buf.readUInt32LE(off) === 0x04034b50) {
  const ver = buf.readUInt16LE(off + 4);
  const flags = buf.readUInt16LE(off + 6);
  const method = buf.readUInt16LE(off + 8);
  const crc = buf.readUInt32LE(off + 14);
  const compSize = buf.readUInt32LE(off + 18);
  const uncompSize = buf.readUInt32LE(off + 22);
  const nameLen = buf.readUInt16LE(off + 26);
  const extraLen = buf.readUInt16LE(off + 28);
  const name = buf.subarray(off + 30, off + 30 + nameLen).toString('utf8');
  const dataStart = off + 30 + nameLen + extraLen;
  const hasDataDesc = (flags & 8) !== 0;
  let out = null;
  let actualComp = hasDataDesc ? null : compSize;
  if (!hasDataDesc && compSize > 0 && dataStart + compSize <= buf.length) {
    try {
      const raw = buf.subarray(dataStart, dataStart + compSize);
      out = method === 8 ? inflateRawSync(raw) : raw;
    } catch (e) {
      out = `INFLATE_ERROR: ${e.message}`;
    }
  }
  console.log(
    `#${i} ${name} method=${method} flags=0x${flags.toString(16)} crc=0x${crc.toString(16)} comp=${compSize} uncomp=${uncompSize} dataDesc=${hasDataDesc} dataStart=${dataStart}${out instanceof Buffer ? ' OK' : ''}`,
  );
  if (out instanceof Buffer) {
    const safe = name.replace(/[\\/]/g, '_');
    writeFileSync(`C:/Users/admin/myspace/readest-plus/.scratch/debug/entries/${i}_${safe}`, out);
  }
  if (hasDataDesc) {
    // scan for data descriptor signature 0x08074b50
    let p = dataStart;
    let found = -1;
    while (p + 4 <= buf.length) {
      if (buf.readUInt32LE(p) === 0x08074b50) { found = p; break; }
      p++;
    }
    console.log(`   (data descriptor search: ${found >= 0 ? `found at ${found}` : 'NOT FOUND'})`);
    if (found < 0) break;
    off = found + 16; // sig + crc + comp + uncomp (assume 4+4+4+4)
  } else {
    off = dataStart + compSize;
  }
  i++;
}
console.log(`total consumed: ${off} of ${buf.length}`);

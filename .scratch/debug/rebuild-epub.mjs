// Rebuild a valid EPUB from the truncated prefix: walk local headers, inflate
// each data region (bounded by next header), rewrite a fresh zip.
import { readFileSync, writeFileSync } from 'node:fs';
import { inflateRawSync, inflateSync } from 'node:zlib';

const src = readFileSync(process.argv[2]);
const out = process.argv[3];

const offs = [];
for (let i = 0; i + 4 <= src.length; i++) {
  if (src[i] === 0x50 && src[i + 1] === 0x4b && src[i + 2] === 0x03 && src[i + 3] === 0x04) offs.push(i);
}

const entries = [];
for (let k = 0; k < offs.length; k++) {
  const off = offs[k];
  const next = k + 1 < offs.length ? offs[k + 1] : src.length;
  const version = src.readUInt16LE(off + 4);
  const method = src.readUInt16LE(off + 8);
  const comp = src.readUInt32LE(off + 18);
  const nameLen = src.readUInt16LE(off + 26);
  const extraLen = src.readUInt16LE(off + 28);
  if (nameLen === 0 || nameLen > 100) continue;
  const name = src.subarray(off + 30, off + 30 + nameLen).toString('utf8');
  if (!/^[\w.\-\/]+$/.test(name)) continue;
  const dataStart = off + 30 + nameLen + extraLen;
  let data = null;
  let how = '';
  // Try 1: exact comp size if it fits before next header
  if (comp > 0 && comp <= next - dataStart && method === 8) {
    try { data = inflateRawSync(src.subarray(dataStart, dataStart + comp)); how = `deflate ${comp}`; } catch {}
  }
  // Try 2: bounded region, tolerant of trailing junk — scan lengths
  if (!data && method === 8) {
    const max = next - dataStart;
    for (let end = Math.min(comp > 0 && comp <= max ? comp : max, max); end > 0; end -= 1) {
      try { data = inflateRawSync(src.subarray(dataStart, dataStart + end)); how = `scan ${end}`; break; } catch {}
    }
  }
  if (!data && method === 0 && comp > 0 && comp <= next - dataStart) {
    data = src.subarray(dataStart, dataStart + comp); how = `stored ${comp}`;
  }
  if (!data && method === 0) {
    // stored but size bogus: take until next header minus possible descriptor
    const region = src.subarray(dataStart, next);
    const dd = region.indexOf(Buffer.from([0x50, 0x4b, 0x07, 0x08]));
    data = dd >= 0 ? region.subarray(0, dd) : region;
    how = `stored-region ${data.length}`;
  }
  console.log(`${name}: ${how}${data ? ` -> ${data.length}` : ' FAILED'}`);
  if (data) entries.push({ name, data });
}

// Write a fresh zip (stored) with proper EOCD
const { deflateRawSync } = await import('node:zlib');
const chunks = [];
const central = [];
let offset = 0;
for (const e of entries) {
  const nameBuf = Buffer.from(e.name, 'utf8');
  const crc = crc32(e.data);
  const comp = deflateRawSync(e.data);
  const useDeflate = comp.length < e.data.length;
  const payload = useDeflate ? comp : e.data;
  const lh = Buffer.alloc(30);
  lh.writeUInt32LE(0x04034b50, 0);
  lh.writeUInt16LE(20, 4);
  lh.writeUInt16LE(0, 6);
  lh.writeUInt16LE(useDeflate ? 8 : 0, 8);
  lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0, 12);
  lh.writeUInt32LE(crc, 14);
  lh.writeUInt32LE(payload.length, 18);
  lh.writeUInt32LE(e.data.length, 22);
  lh.writeUInt16LE(nameBuf.length, 26);
  lh.writeUInt16LE(0, 28);
  chunks.push(lh, nameBuf, payload);
  central.push({ nameBuf, crc, compSize: payload.length, size: e.data.length, method: useDeflate ? 8 : 0, offset });
  offset += 30 + nameBuf.length + payload.length;
}
let cdSize = 0;
for (const c of central) {
  const ch = Buffer.alloc(46);
  ch.writeUInt32LE(0x02014b50, 0);
  ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6);
  ch.writeUInt16LE(0, 8); ch.writeUInt16LE(c.method, 10);
  ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0, 14);
  ch.writeUInt32LE(c.crc, 16);
  ch.writeUInt32LE(c.compSize, 20);
  ch.writeUInt32LE(c.size, 24);
  ch.writeUInt16LE(c.nameBuf.length, 28);
  ch.writeUInt32LE(c.offset, 42);
  chunks.push(ch, c.nameBuf);
  cdSize += 46 + c.nameBuf.length;
}
const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(0x06054b50, 0);
eocd.writeUInt16LE(central.length, 8);
eocd.writeUInt16LE(central.length, 10);
eocd.writeUInt32LE(cdSize, 12);
eocd.writeUInt32LE(offset, 16);
chunks.push(eocd);
writeFileSync(out, Buffer.concat(chunks));
console.log(`wrote ${out}: ${entries.length} entries`);

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

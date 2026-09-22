// Inspect each PK0304 occurrence: try to parse as local header, print fields + name.
import { readFileSync } from 'node:fs';
const buf = readFileSync(process.argv[2]);
const offs = [];
for (let i = 0; i + 4 <= buf.length; i++) {
  if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x03 && buf[i + 3] === 0x04) offs.push(i);
}
for (const off of offs) {
  const h = buf.subarray(off, off + 64);
  const version = h.readUInt16LE(4);
  const flags = h.readUInt16LE(6);
  const method = h.readUInt16LE(8);
  const crc = h.readUInt32LE(14);
  const comp = h.readUInt32LE(18);
  const uncomp = h.readUInt32LE(22);
  const nameLen = h.readUInt16LE(26);
  const extraLen = h.readUInt16LE(28);
  let name = '';
  let ok = nameLen > 0 && nameLen < 200;
  if (ok) name = h.subarray(30, 30 + nameLen).toString('utf8');
  const printable = /^[\w.\-\/ :()\u4e00-\u9fff]+$/.test(name);
  console.log(
    `@${off} ver=${version} flags=0x${flags.toString(16)} method=${method} crc=0x${crc.toString(16)} comp=${comp} uncomp=${uncomp} nameLen=${nameLen} extraLen=${extraLen} name="${printable ? name : 'UNREADABLE'}"`,
  );
}

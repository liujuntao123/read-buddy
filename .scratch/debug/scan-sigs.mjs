// Scan every PK signature occurrence with offsets and context.
import { readFileSync } from 'node:fs';
const buf = readFileSync(process.argv[2]);
const sigs = { '0304': [], '0102': [], '0506': [], '08074b50': [] };
for (let i = 0; i + 4 <= buf.length; i++) {
  if (buf[i] !== 0x50 || buf[i + 1] !== 0x4b) continue;
  const b2 = buf[i + 2], b3 = buf[i + 3];
  if (b2 === 0x03 && b3 === 0x04) sigs['0304'].push(i);
  else if (b2 === 0x01 && b3 === 0x02) sigs['0102'].push(i);
  else if (b2 === 0x05 && b3 === 0x06) sigs['0506'].push(i);
}
// data descriptor 50 4b 07 08
const dd = [];
for (let i = 0; i + 4 <= buf.length; i++) {
  if (buf.readUInt32LE(i) === 0x08074b50) dd.push(i);
}
console.log('PK0304 count', sigs['0304'].length, sigs['0304'].slice(0, 30).join(','));
console.log('PK0102 count', sigs['0102'].length, sigs['0102'].slice(0, 30).join(','));
console.log('PK0506 count', sigs['0506'].length, sigs['0506'].join(','));
console.log('data-descriptors', dd.length, dd.slice(0, 30).join(','));
// hex context at first 0304
const first = sigs['0304'][0];
console.log('first 0304 context:', buf.subarray(first, first + 48).toString('hex'));

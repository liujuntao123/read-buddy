// Extract the book row (V8-serialized IndexedDB value) from a Chromium blob file.
import { readFileSync, writeFileSync } from 'node:fs';
import { deserialize } from 'node:v8';

const [,, blobPath, outPath] = process.argv;
const buf = readFileSync(blobPath);
// Chromium blob file: small prefix, then the V8 value starting at 0xFF <version>.
const start = buf.indexOf(Buffer.from([0xff]));
console.log('file size', buf.length, 'serial start', start);
const value = deserialize(buf.subarray(start));
console.log('keys:', Object.keys(value));
for (const k of Object.keys(value)) {
  if (k === 'data') {
    console.log(' data byteLength:', value.data?.byteLength);
  } else {
    console.log(` ${k}:`, value[k]);
  }
}
if (value.data) {
  const bytes = Buffer.from(value.data);
  writeFileSync(outPath, bytes);
  console.log('wrote', outPath, bytes.length, 'bytes; magic:', bytes.subarray(0, 4).toString('hex'));
}

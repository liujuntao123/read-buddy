// Minimal static server for the vendored foliate-js + repro harness.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const root = normalize('C:/Users/admin/myspace/read-buddy/apps/read-buddy-app/vendor/foliate-js');
const types = { '.js': 'text/javascript', '.html': 'text/html', '.epub': 'application/epub+zip' };

createServer(async (req, res) => {
  try {
    let url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (url === '/') url = '/__repro__/index.html';
    const file = normalize(join(root, url));
    if (!file.startsWith(root)) throw new Error('forbidden');
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404); res.end('not found');
  }
}).listen(3877, () => console.log('repro server on http://localhost:3877'));

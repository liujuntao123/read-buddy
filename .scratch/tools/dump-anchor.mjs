import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire("file:///C:/Users/admin/myspace/readest-plus/apps/readest-app/package.json");
const JSZip = require("jszip");
const zip = await JSZip.loadAsync(readFileSync(process.argv[2]));
const html = await zip.file(process.argv[3]).async("string");
const idx = [];
for (const m of html.matchAll(/id="(sigil_toc_id_\d+)"/g)) idx.push([m.index, m[1]]);
console.log("anchor count:", idx.length, "| html len:", html.length);
for (const [pos, id] of idx.slice(0, 4)) {
  console.log("\n=== " + id + " @" + pos + " ===");
  console.log(JSON.stringify(html.slice(Math.max(0, pos - 220), pos + 260)));
}

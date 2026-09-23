/**
 * Throwaway: does the CURRENT implementation's TOC shape rule fire on the real
 * 目录 pages? (It requires >=50% of lines to match its TOC_LINE pattern.)
 */
import { readFileSync, readdirSync } from 'node:fs';

const TOC_LINE =
  /^(第\s*[0-9一二三四五六七八九十百千零两]+\s*[章回节卷部集幕]|[§＄]|Chapter\s|Part\s|\d+([.、．)）]|\s)|contents?$|目\s*次)/i;

const nonEmptyLines = (t) => t.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
const median = (v) => {
  if (!v.length) return 0;
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? Math.round((s[m - 1] + s[m]) / 2) : s[m];
};

const files = readdirSync('.scratch/out').filter((f) => f.startsWith('nodes-') && f.endsWith('.json'));
const all = [];
for (const f of files) all.push(...JSON.parse(readFileSync(`.scratch/out/${f}`, 'utf8')));

console.log('title-rule-independent check: real 目录 pages vs the implementation TOC shape rule');
console.log('book | label | chars | lines | tocLines | ratio | median | TOC rule');
for (const n of all) {
  const label = (n.label ?? n.title ?? '').trim();
  if (!/^(目\s*录|目\s*次)$/.test(label)) continue;
  const lines = nonEmptyLines(n.text);
  const tocLines = lines.filter((l) => TOC_LINE.test(l)).length;
  const ratio = +(tocLines / Math.max(1, lines.length)).toFixed(2);
  const med = median(lines.map((l) => l.length));
  const fires = lines.length >= 6 && ratio >= 0.5 && med <= 32;
  console.log(
    `${n.book.replace('.epub', '').slice(0, 14).padEnd(14)} | ${label.padEnd(4)} | ${String(n.charCount).padStart(6)} | ${String(lines.length).padStart(4)} | ${String(tocLines).padStart(4)} | ${String(ratio).padStart(4)} | ${String(med).padStart(3)} | ${fires ? 'FIRES' : 'MISS'}`,
  );
  if (!fires) console.log(`      first lines: ${JSON.stringify(lines.slice(0, 6))}`);
}

console.log('\nreal 版权-ish pages vs the implementation copyright rule (>=3 distinct markers)');
for (const n of all) {
  const label = (n.label ?? n.title ?? '').trim();
  if (!/^(版权|版权信息|版权页|书名页|扉页|封面|封底)$/.test(label)) continue;
  const lines = nonEmptyLines(n.text);
  const med = median(lines.map((l) => l.length));
  console.log(
    `${n.book.replace('.epub', '').slice(0, 14).padEnd(14)} | ${label.padEnd(6)} | chars=${String(n.charCount).padStart(5)} lines=${String(lines.length).padStart(3)} med=${String(med).padStart(3)} | ${JSON.stringify(Object.keys(n.markers))}`,
  );
}

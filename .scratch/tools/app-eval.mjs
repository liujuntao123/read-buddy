/**
 * Throwaway: audit the classifier verdicts produced by the REAL app pipeline
 * (.scratch/out/app-nodes.json, written by .scratch/classifier-real-books.test.ts).
 */
import { readFileSync } from 'node:fs';

const nodes = JSON.parse(readFileSync('.scratch/out/app-nodes.json', 'utf8'));

const PLACEHOLDER = /^第\s*\d+\s*[章节段]$/;
const FM_RE =
  /(版权|目录|目次|扉页|封面|封底|书名页|出版说明|凡例|献词|题记|内容简介|内容提要|索引|参考|附录|后记|译后记|跋|序|前言|引言|导论|绪论|结语|尾声|致谢|自序|重印|编后)/;

const fired = nodes.filter((n) => n.reasons.length);
console.log(`### app-pipeline nodes: ${nodes.length}; skipped by classifier: ${fired.length}\n`);

console.log('### every node the classifier skips');
console.log('book | nodeIdx | title | chars | lines | medLen | maxLen | endPunct | headMarkers | reasons');
for (const n of fired) {
  console.log(
    [
      n.book.replace('.epub', '').slice(0, 12).padEnd(12),
      String(n.nodeIndex).padStart(4),
      (n.title || '(空)').slice(0, 26).padEnd(26),
      String(n.charCount).padStart(6),
      String(n.shape.lineCount).padStart(4),
      String(n.shape.medianLineLen).padStart(3),
      String(n.shape.maxLineLen).padStart(4),
      String(n.shape.sentenceEndFraction).padStart(5),
      String(n.headMarkerKinds).padStart(2),
      n.reasons.join('+'),
    ].join(' | '),
  );
}

console.log('\n### placeholder-titled nodes (第 N 节/章/段) — the app’s fallback naming');
for (const n of nodes.filter((n) => PLACEHOLDER.test(n.title))) {
  console.log(
    `  ${n.book.replace('.epub', '').slice(0, 14).padEnd(14)} | ${n.title.padEnd(8)} | chars=${String(n.charCount).padStart(6)} lines=${String(n.shape.lineCount).padStart(4)} med=${String(n.shape.medianLineLen).padStart(3)} max=${String(n.shape.maxLineLen).padStart(4)} headMarkers=${n.headMarkerKinds} | ${n.reasons.join('+') || '(kept)'}`,
  );
}

console.log('\n### kept nodes with a front/back-matter title (must NOT be skipped — false negatives by design)');
for (const n of nodes) {
  if (n.reasons.length) continue;
  if (!FM_RE.test(n.title)) continue;
  console.log(
    `  ${n.book.replace('.epub', '').slice(0, 14).padEnd(14)} | ${(n.title || '(空)').slice(0, 30).padEnd(30)} | chars=${String(n.charCount).padStart(6)} lines=${String(n.shape.lineCount).padStart(4)} med=${String(n.shape.medianLineLen).padStart(3)} max=${String(n.shape.maxLineLen).padStart(4)} endP=${n.shape.sentenceEndFraction}`,
  );
}

console.log('\n### skipped nodes whose title is neither FM-ish nor a placeholder (possible false positives)');
let fp = 0;
for (const n of fired) {
  if (FM_RE.test(n.title) || PLACEHOLDER.test(n.title)) continue;
  fp += 1;
  console.log(`  ${n.book.replace('.epub', '').slice(0, 14)} | ${n.title.slice(0, 30)} | chars=${n.charCount} | ${n.reasons.join('+')}`);
}
console.log(`  → ${fp} possible false positive(s)`);

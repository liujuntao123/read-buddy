/**
 * Throwaway: read .scratch/out/nodes-*.json and report
 *  (a) all nodes whose TITLE looks like front/back matter,
 *  (b) the top marker-scoring nodes overall (false-positive hunting),
 *  (c) metrics for candidate TOC-shape rules.
 */
import { readFileSync, readdirSync } from 'node:fs';

const TITLE_HINT =
  /(版权|目录|目次|扉页|封面|书名页|出版说明|凡例|献词|题记|内容简介|内容提要|编者的话|插页|附页|封底|封里|书脊|版次|印次|印刷|声明|致谢|索引|参考|附录|译后记|后记|跋|序|前言|引言|导论|绪论|结语|尾声|编后|出版)/;

const files = readdirSync('.scratch/out').filter((f) => f.startsWith('nodes-') && f.endsWith('.json'));
const all = [];
for (const f of files) {
  const nodes = JSON.parse(readFileSync(`.scratch/out/${f}`, 'utf8'));
  all.push(...nodes);
}
console.log(`total nodes: ${all.length} (from ${files.length} books)\n`);

console.log('### (a) nodes whose TITLE matches front/back-matter hints');
console.log(
  ['book', 'label', 'chars', 'lines', 'medLen', 'headF', 'tailNumF', 'markerKinds', 'markers'].join(' | '),
);
for (const n of all) {
  if (!TITLE_HINT.test(n.label || '')) continue;
  console.log(
    [
      n.book.slice(0, 12),
      (n.label || '(空)').slice(0, 24),
      n.charCount,
      n.shape.lineCount,
      n.shape.medianLineLen,
      n.shape.headFraction,
      n.shape.tailNumFraction,
      n.markerKinds,
      Object.entries(n.markers).map(([k, v]) => `${k}x${v}`).join(','),
    ].join(' | '),
  );
}

console.log('\n### (b) top 40 marker-scoring nodes overall');
const sorted = [...all].sort((a, b) => b.markerKinds - a.markerKinds);
for (const n of sorted.slice(0, 40)) {
  console.log(
    [
      String(n.markerKinds).padStart(2),
      n.book.slice(0, 12),
      `chars=${String(n.charCount).padStart(6)}`,
      `lines=${String(n.shape.lineCount).padStart(4)}`,
      `medLen=${String(n.shape.medianLineLen).padStart(3)}`,
      `headF=${n.shape.headFraction}`,
      `| ${(n.label || '(空)').slice(0, 30)}`,
      `| ${Object.entries(n.markers).map(([k, v]) => `${k}x${v}`).join(',')}`,
    ].join(' '),
  );
}

console.log('\n### (c) nodes with empty label');
for (const n of all.filter((n) => !n.label || !n.label.trim())) {
  console.log(
    `  ${n.book} | chars=${n.charCount} lines=${n.shape.lineCount} medLen=${n.shape.medianLineLen} markers=${n.markerKinds} ${JSON.stringify(n.markers)}`,
  );
}

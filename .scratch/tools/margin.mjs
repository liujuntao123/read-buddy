import { readFileSync, readdirSync } from 'node:fs';
const files = readdirSync('.scratch/out').filter((f) => f.startsWith('nodes-') && f.endsWith('.json'));
const all = [];
for (const f of files) all.push(...JSON.parse(readFileSync(`.scratch/out/${f}`, 'utf8')));
const FM = /^(版权|目录|目次|扉页|封面|封底|书名页|出版说明|凡例|献词|题记|内容简介|内容提要)/;

console.log('### all nodes passing lines>=8 & med<=25 & max<=120, sorted by sentenceEndFraction');
const rows = all
  .filter((n) => n.shape.lineCount >= 8 && n.shape.medianLineLen <= 25 && n.shape.maxLineLen <= 120 && n.charCount > 0)
  .sort((a, b) => a.shape.endPunctFraction - b.shape.endPunctFraction);
for (const n of rows) {
  const fm = FM.test((n.label || '').replace(/\s/g, ''));
  console.log(
    `  ${fm ? 'FM ' : '   '} endP=${String(n.shape.endPunctFraction).padStart(5)} lines=${String(n.shape.lineCount).padStart(4)} med=${String(n.shape.medianLineLen).padStart(3)} max=${String(n.shape.maxLineLen).padStart(3)} chars=${String(n.charCount).padStart(5)} | ${n.book.replace('.epub', '').slice(0, 12).padEnd(12)} | ${n.label}`,
  );
}

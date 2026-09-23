/**
 * Throwaway: report-ready table of every front/back-matter node found in the
 * 14 EPUBs (EPUB-direct extraction), under the FINAL rule set.
 */
import { readFileSync, readdirSync } from 'node:fs';

const files = readdirSync('.scratch/out').filter((f) => f.startsWith('nodes-') && f.endsWith('.json'));
const all = [];
for (const f of files) all.push(...JSON.parse(readFileSync(`.scratch/out/${f}`, 'utf8')));

const SKIP_TITLES = new Set([
  '版权', '版权信息', '版权页', '版权声明', '目录', '目次', '扉页', '封面', '封底',
  '书名页', '内容简介', '内容提要', '出版信息', '图书在版编目',
]);
const norm = (t) => (t ?? '').replace(/[\s\u3000]/g, '').replace(/^[《【［（(\[]+/, '').replace(/[》】］）)\]:：、.。·\-—]+$/, '');
const STRONG = ['图书在版编目', 'CIP数据', '版权所有', '出版发行', '责任编辑', '封面设计', '装帧设计', '开本', '印张', '印次', '版次', '经销', '书号', '定价', 'ISBN'];
const headKinds = (t) => STRONG.filter((m) => t.slice(0, 500).includes(m)).length;

const FM_TITLE = /^(版权|目录|目次|扉页|封面|封底|书名页|出版说明|凡例|献词|题记|内容简介|内容提要|编后|重印|版权声明)/;

const rows = [];
for (const n of all) {
  const title = norm(n.label);
  const t = SKIP_TITLES.has(title);
  const hk = headKinds(n.text);
  const c = hk >= 2 && n.charCount <= 1000;
  const s = n.shape.lineCount >= 12 && n.shape.medianLineLen <= 25 && n.shape.maxLineLen <= 120 && n.shape.endPunctFraction <= 0.2;
  if (!t && !c && !s) continue;
  rows.push({ n, t, c, s, hk });
}

console.log('book | title | chars | lines | medLen | maxLen | endP | headMarkers | T | C | S');
for (const { n, t, c, s, hk } of rows) {
  console.log(
    [
      n.book.replace('.epub', '').slice(0, 14).padEnd(14),
      (n.label || '(空)').slice(0, 20).padEnd(20),
      String(n.charCount).padStart(6),
      String(n.shape.lineCount).padStart(4),
      String(n.shape.medianLineLen).padStart(3),
      String(n.shape.maxLineLen).padStart(4),
      String(n.shape.endPunctFraction).padStart(5),
      String(hk).padStart(3),
      t ? 'T' : '-',
      c ? 'C' : '-',
      s ? 'S' : '-',
    ].join(' | '),
  );
}
console.log(`\ntotal ${rows.length} of ${all.length} nodes; T=${rows.filter((r) => r.t).length} C=${rows.filter((r) => r.c).length} S=${rows.filter((r) => r.s).length}`);

console.log('\n### FIRE AUDIT: fired nodes whose title is NOT in the front-matter list');
for (const { n, t, c, s } of rows) {
  if (t || FM_TITLE.test(norm(n.label))) continue;
  console.log(`  ${n.book.replace('.epub', '').slice(0, 14)} | ${n.label} | chars=${n.charCount} | ${[c && 'content', s && 'shape'].filter(Boolean).join('+')}`);
}

console.log('\n### FALSE NEGATIVES: front-matter-titled nodes that do NOT fire');
for (const n of all) {
  if (!FM_TITLE.test(norm(n.label))) continue;
  const hk = headKinds(n.text);
  const c = hk >= 2 && n.charCount <= 1000;
  const s = n.shape.lineCount >= 12 && n.shape.medianLineLen <= 25 && n.shape.maxLineLen <= 120 && n.shape.endPunctFraction <= 0.2;
  if (SKIP_TITLES.has(norm(n.label)) || c || s) continue;
  console.log(`  ${n.book.replace('.epub', '').slice(0, 14)} | ${n.label} | chars=${n.charCount} lines=${n.shape.lineCount} max=${n.shape.maxLineLen}`);
}

/**
 * Throwaway: rule evaluation over every node of every book.
 *  - prints raw text samples for named nodes
 *  - evaluates candidate rules, listing every node they fire on
 *  - marker-position / density analysis (to kill the "last node swallows the
 *    colophon" false positive)
 *
 * Usage: node .scratch/tools/rule-eval.mjs samples|rules|shape|density [bookFilter]
 */
import { readFileSync, readdirSync } from 'node:fs';

const files = readdirSync('.scratch/out').filter((f) => f.startsWith('nodes-') && f.endsWith('.json'));
const all = [];
for (const f of files) all.push(...JSON.parse(readFileSync(`.scratch/out/${f}`, 'utf8')));

const mode = process.argv[2] ?? 'samples';
const filter = process.argv[3] ?? '';

const STRONG = [
  '图书在版编目', 'CIP数据', '版权所有', '出版发行', '责任编辑', '封面设计',
  '开本', '印张', '印次', '版次', '经销', '书号', '定价', 'ISBN',
];
const WEAK = ['字数', '印刷', '出版', 'CIP', '著作权', '统一书号'];

const hitList = (text, markers) => markers.filter((m) => text.includes(m));
const countOf = (text, markers) => markers.reduce((n, m) => n + (text.includes(m) ? 1 : 0), 0);

if (mode === 'samples') {
  const wanted = /(版权|目录|目次|扉页|封面|书名页|出版说明|文前)/;
  for (const n of all) {
    if (filter && !n.book.includes(filter)) continue;
    if (!wanted.test(n.label || '')) continue;
    if (n.charCount === 0) continue;
    console.log(`\n${'='.repeat(90)}`);
    console.log(`BOOK=${n.book} | LABEL=${n.label} | chars=${n.charCount} | lines=${n.shape.lineCount} | medLen=${n.shape.medianLineLen} | headF=${n.shape.headFraction}`);
    console.log(`MARKERS=${JSON.stringify(n.markers)}`);
    console.log('-'.repeat(90));
    console.log(n.text.slice(0, 600).replace(/\n/g, '⏎\n'));
  }
}

if (mode === 'rules') {
  const titleRule = (label) => /(版权|目录|目次)/.test(label || '');
  console.log('### R1  title contains 版权|目录|目次');
  for (const n of all) if (titleRule(n.label)) console.log(`  ${n.book} | ${n.label} | chars=${n.charCount} lines=${n.shape.lineCount}`);
  console.log('\n### R2  content: >=2 STRONG markers');
  for (const n of all) {
    const hits = hitList(n.text, STRONG);
    if (hits.length >= 2) console.log(`  ${n.book} | ${(n.label || '(空)').slice(0, 30)} | chars=${n.charCount} lines=${n.shape.lineCount} | ${hits.join(',')}`);
  }
  console.log('\n### R3  content: >=1 STRONG and >=2 total (STRONG+WEAK)');
  for (const n of all) {
    const s = hitList(n.text, STRONG);
    const w = hitList(n.text, WEAK);
    if (s.length >= 1 && s.length + w.length >= 2) console.log(`  ${n.book} | ${(n.label || '(空)').slice(0, 30)} | chars=${n.charCount} | S=${s.join(',')} W=${w.join(',')}`);
  }
  console.log('\n### R4  WEAK-only nodes containing 出版/印刷/字数/CIP');
  for (const n of all) {
    const s = hitList(n.text, STRONG);
    const w = hitList(n.text, WEAK);
    if (s.length === 0 && w.length > 0) console.log(`  ${n.book} | ${(n.label || '(空)').slice(0, 34)} | chars=${n.charCount} lines=${n.shape.lineCount} medLen=${n.shape.medianLineLen} | ${w.join(',')}`);
  }
}

if (mode === 'shape') {
  const lineThresh = Number(process.argv[3] ?? 15);
  const medThresh = Number(process.argv[4] ?? 25);
  console.log(`### S  lineCount >= ${lineThresh} && medianLineLen <= ${medThresh}`);
  let fired = 0;
  for (const n of all) {
    if (n.shape.lineCount >= lineThresh && n.shape.medianLineLen <= medThresh && n.charCount > 0) {
      fired += 1;
      console.log(`  ${n.book} | ${(n.label || '(空)').slice(0, 34)} | chars=${n.charCount} lines=${n.shape.lineCount} medLen=${n.shape.medianLineLen} maxLen=${n.shape.maxLineLen}`);
    }
  }
  console.log(`  → fired on ${fired}/${all.length} nodes`);

  console.log('\n### sorted by medianLineLen ascending, lineCount>=12 (to find the boundary)');
  const rows = all
    .filter((n) => n.charCount > 0 && n.shape.lineCount >= 12)
    .sort((a, b) => a.shape.medianLineLen - b.shape.medianLineLen);
  for (const n of rows.slice(0, 60)) {
    console.log(`  medLen=${String(n.shape.medianLineLen).padStart(3)} lines=${String(n.shape.lineCount).padStart(4)} chars=${String(n.charCount).padStart(6)} maxLen=${String(n.shape.maxLineLen).padStart(4)} | ${n.book.slice(0, 10)} | ${(n.label || '(空)').slice(0, 30)}`);
  }
}

if (mode === 'density') {
  console.log('### marker position + density for every node with >=1 STRONG marker');
  for (const n of all) {
    const hits = hitList(n.text, STRONG);
    if (!hits.length) continue;
    const first = Math.min(...hits.map((m) => n.text.indexOf(m)));
    const per1000 = +((hits.length * 1000) / Math.max(1, n.charCount)).toFixed(2);
    const firstStrong = STRONG.filter((m) => n.text.includes(m))[0];
    console.log(
      `  ${n.book.slice(0, 12).padEnd(12)} | ${(n.label || '(空)').slice(0, 22).padEnd(22)} | chars=${String(n.charCount).padStart(6)} | kinds=${hits.length} | first@${String(first).padStart(6)} (${((first / Math.max(1, n.charCount)) * 100).toFixed(1)}%) | /1k=${String(per1000).padStart(6)} | ${hits.join(',')}`,
    );
  }
}

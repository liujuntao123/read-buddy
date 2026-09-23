/**
 * Throwaway: evaluate the RECOMMENDED rule set against all 1295 real nodes.
 * Prints every firing node (to audit false positives) and every known
 * front/back-matter node that fails to fire (false negatives).
 */
import { readFileSync, readdirSync } from 'node:fs';

const files = readdirSync('.scratch/out').filter((f) => f.startsWith('nodes-') && f.endsWith('.json'));
const all = [];
for (const f of files) all.push(...JSON.parse(readFileSync(`.scratch/out/${f}`, 'utf8')));

// ------------------------------------------------------------------ rules ---

/** R1 title rule — EXACT match on a normalized title. */
const SKIP_TITLES = [
  '版权', '版权信息', '版权页', '版权声明', '目录', '目次', '扉页', '封面', '封底',
  '书名页', '内容简介', '内容提要', '出版信息', '图书在版编目',
];
const normalizeTitle = (t) =>
  (t ?? '')
    .replace(/[\s\u3000]/g, '')
    .replace(/^[《【［（(\[]+|[》】］）)\]:：、.。·\-—]+$/g, '');
const titleHit = (t) => SKIP_TITLES.includes(normalizeTitle(t));

/** R2 content rule — copyright/colophon markers concentrated in the head. */
const STRONG = [
  '图书在版编目', 'CIP数据', '版权所有', '出版发行', '责任编辑', '封面设计',
  '装帧设计', '开本', '印张', '印次', '版次', '经销', '书号', '定价', 'ISBN',
];
const headKinds = (text, n = 500) => STRONG.filter((m) => text.slice(0, n).includes(m)).length;
const contentHit = (text) => headKinds(text, 500) >= 2;

/** R3 shape rule — a listing/TOC page: many short lines, no paragraph line. */
const shapeHit = (s) =>
  s.lineCount >= 12 && s.medianLineLen <= 25 && s.maxLineLen <= 120 && s.endPunctFraction <= 0.2;

/** R4 very short. */
const SHORT_CHARS = 50;

const classify = (n) => {
  const reasons = [];
  if (n.charCount < SHORT_CHARS) reasons.push('short');
  if (titleHit(n.label)) reasons.push('title');
  if (contentHit(n.text)) reasons.push('content');
  if (shapeHit(n.shape)) reasons.push('shape');
  return reasons;
};

// ------------------------------------------------------------------ audit ---

const rows = all.map((n) => ({ n, reasons: classify(n) }));
const fired = rows.filter((r) => r.reasons.length);

console.log(`### nodes SKIPPED by the rule set: ${fired.length} / ${all.length}\n`);
console.log('book | label | chars | lines | medLen | maxLen | endPunct | headKinds | reasons');
for (const { n, reasons } of fired.sort((a, b) => a.n.book.localeCompare(b.n.book))) {
  console.log(
    [
      n.book.slice(0, 12).padEnd(12),
      (n.label || '(空)').slice(0, 30).padEnd(30),
      String(n.charCount).padStart(6),
      String(n.shape.lineCount).padStart(4),
      String(n.shape.medianLineLen).padStart(3),
      String(n.shape.maxLineLen).padStart(4),
      String(n.shape.endPunctFraction).padStart(5),
      String(headKinds(n.text)).padStart(3),
      reasons.join('+'),
    ].join(' | '),
  );
}

console.log('\n### hits by reason');
for (const reason of ['title', 'content', 'shape', 'short']) {
  const list = rows.filter((r) => r.reasons.includes(reason));
  console.log(`  ${reason}: ${list.length}`);
}

console.log('\n### AUDIT: nodes with a front/back-matter-ish title that are NOT skipped (false negatives)');
const FM_RE = /(版权|目录|目次|扉页|封面|封底|书名页|出版说明|凡例|献词|题记|内容简介|内容提要|索引|参考|附录|后记|译后记|跋|序|前言|引言|导论|绪论|结语|尾声|致谢)/;
for (const { n, reasons } of rows) {
  if (reasons.length) continue;
  if (!FM_RE.test(n.label || '')) continue;
  console.log(
    `  ${n.book.slice(0, 12)} | ${(n.label || '(空)').slice(0, 30)} | chars=${n.charCount} lines=${n.shape.lineCount} medLen=${n.shape.medianLineLen} maxLen=${n.shape.maxLineLen} endPunct=${n.shape.endPunctFraction} headKinds=${headKinds(n.text)}`,
  );
}

console.log('\n### AUDIT: skipped nodes whose title is NOT front/back matter (possible false positives)');
for (const { n, reasons } of fired) {
  if (FM_RE.test(n.label || '')) continue;
  console.log(
    `  ${n.book.slice(0, 12)} | ${(n.label || '(空)').slice(0, 30)} | chars=${n.charCount} lines=${n.shape.lineCount} medLen=${n.shape.medianLineLen} maxLen=${n.shape.maxLineLen} | ${reasons.join('+')}`,
  );
}

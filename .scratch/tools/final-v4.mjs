/**
 * Throwaway: FINAL rule-set evaluation on the real-pipeline node dump
 * (.scratch/out/app-nodes.json) with the length-capped content rule, plus the
 * raw samples quoted in the report.
 */
import { readFileSync } from 'node:fs';

const app = JSON.parse(readFileSync('.scratch/out/app-nodes.json', 'utf8'));

const STRONG = [
  '图书在版编目', 'CIP数据', '版权所有', '出版发行', '责任编辑', '封面设计',
  '装帧设计', '开本', '印张', '印次', '版次', '经销', '书号', '定价', 'ISBN',
];

// ---- final rule (v4): content rule gains a length cap -----------------------
const CONTENT_MAX_CHARS = 1000;
const content = (n) =>
  n.headMarkerKinds >= 2 && n.charCount <= CONTENT_MAX_CHARS;

const fired = app.map((n) => ({ n, content: content(n) })).filter((r) => r.content);
console.log(`### content rule (>=2 strong markers in first 500 chars AND <=${CONTENT_MAX_CHARS} chars)`);
for (const { n } of fired) {
  console.log(
    `  ${n.book.replace('.epub', '').slice(0, 14).padEnd(14)} | ${(n.title || '(空)').padEnd(8)} | chars=${String(n.charCount).padStart(5)} headMarkers=${n.headMarkerKinds} | reasons=${n.reasons.join('+')}`,
  );
}
console.log(`  → ${fired.length} firings`);

const justOver = app.filter((n) => n.headMarkerKinds >= 2 && n.charCount > CONTENT_MAX_CHARS);
console.log('\n### nodes REJECTED only by the length cap (would have been false positives)');
for (const n of justOver) {
  console.log(
    `  ${n.book.replace('.epub', '').slice(0, 14)} | ${n.title} | chars=${n.charCount} headMarkers=${n.headMarkerKinds}`,
  );
}

// ---- shape-rule margin table ------------------------------------------------
console.log('\n### shape-rule margin: nodes with lines>=12, median<=25, max<=120');
console.log('  (rule also needs sentenceEndFraction <= 0.2 — the gap between 0.167 and 0.5 is the margin)');
const margin = app
  .filter((n) => n.shape.lineCount >= 12 && n.shape.medianLineLen <= 25 && n.shape.maxLineLen <= 120)
  .sort((a, b) => a.shape.sentenceEndFraction - b.shape.sentenceEndFraction);
for (const n of margin) {
  const verdict = n.shape.sentenceEndFraction <= 0.2 ? 'SKIP' : 'keep';
  console.log(
    `  ${verdict.padEnd(4)} endP=${String(n.shape.sentenceEndFraction).padStart(5)} lines=${String(n.shape.lineCount).padStart(4)} med=${String(n.shape.medianLineLen).padStart(3)} max=${String(n.shape.maxLineLen).padStart(3)} chars=${String(n.charCount).padStart(5)} | ${n.book.replace('.epub', '').slice(0, 12)} | ${n.title}`,
  );
}

// ---- samples ---------------------------------------------------------------
const epubNodes = JSON.parse(readFileSync('.scratch/out/nodes-说理-陈嘉映.json', 'utf8'));
const byLabel = (label, bookFilter = '') =>
  epubNodes.filter((n) => n.label === label && (!bookFilter || n.book.includes(bookFilter)));

console.log('\n### SAMPLE 说理 / 版权信息 (EPUB-direct extraction)');
const s1 = byLabel('版权信息')[0];
console.log(`chars=${s1.charCount} markers=${JSON.stringify(s1.markers)}\n${s1.text.slice(0, 400)}`);

console.log('\n### SAMPLE 走出唯一真理观 / 版权信息 (app node title = 版权信息)');
const other = JSON.parse(readFileSync('.scratch/out/nodes-走出唯一真理观-陈嘉映.json', 'utf8'));
const s2 = other.find((n) => n.label === '版权信息');
console.log(`chars=${s2.charCount} markers=${JSON.stringify(s2.markers)}\n${s2.text.slice(0, 400)}`);

console.log('\n### SAMPLE 说理 / 目录 (first 600 chars)');
const s3 = byLabel('目录')[0];
console.log(`chars=${s3.charCount} lines=${s3.shape.lineCount} medLen=${s3.shape.medianLineLen} maxLen=${s3.shape.maxLineLen}\n${s3.text.slice(0, 600)}`);

console.log('\n### SAMPLE 北平无战事 / 目录 (49 lines, the pathological short-line TOC)');
const bps = JSON.parse(readFileSync('.scratch/out/nodes-北平无战事(上下册)-刘和平.json', 'utf8'));
const s4 = bps.find((n) => n.label === '目录');
console.log(`chars=${s4.charCount} lines=${s4.shape.lineCount} medLen=${s4.shape.medianLineLen} maxLen=${s4.shape.maxLineLen}\n${s4.text.slice(0, 400)}`);

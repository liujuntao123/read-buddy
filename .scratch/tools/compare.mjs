/**
 * Throwaway: side-by-side comparison of
 *   (A) the CURRENT implementation in src/services/bookNodes/nodeContent.ts
 *   (B) the rule set proposed from this investigation
 * over every real front/back-matter node found in the 14 EPUBs, plus the known
 * false-positive traps.
 *
 * Prints the sha256 of nodeContent.ts so the finding is tied to a revision.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

const src = readFileSync('apps/read-buddy-app/src/services/bookNodes/nodeContent.ts', 'utf8');
console.log(`nodeContent.ts sha256=${createHash('sha256').update(src).digest('hex').slice(0, 12)} bytes=${src.length}`);

// ---- (A) current implementation -------------------------------------------------
const A_TITLES = [
  { pattern: /^(封面|书封|封底|护封|扉页|书名页|插页|彩插|插图页?)$/, kind: 'cover' },
  { pattern: /^(版权(信息|页|声明)?|出版信息|图书在版编目(\(CIP\))?数据?|CIP数据|版次|印次)$/i, kind: 'copyright' },
  { pattern: /^(目\s*录|目\s*次|contents?|table of contents)$/i, kind: 'toc' },
];
const A_MARKERS = ['图书在版编目', 'CIP', '版权所有', '侵权必究', 'ISBN', '出版发行', '出版社', '印刷', '印张', '开本', '定价', '书号', '责任编辑', '封面设计', '经销', '版次', '印次'];
const A_TOC_LINE = /^(第\s*[0-9一二三四五六七八九十百千零两]+\s*[章回节卷部篇集幕]|[§＄]|Chapter\s|Part\s|\d+([.、．)）]|\s)|contents?$|目\s*次)/i;
const lines = (t) => t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
const median = (v) => { if (!v.length) return 0; const s = [...v].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };
const markerLines = (ls) => ls.filter((l) => A_MARKERS.some((m) => l.includes(m))).length;
function assessA(title, text) {
  const t = (title ?? '').trim();
  const ls = lines(text.trim());
  const st = A_TITLES.find((x) => x.pattern.test(t));
  if (st) return st.kind;
  const hits = A_MARKERS.filter((m) => text.includes(m)).length;
  if (hits >= 3 && ls.length > 0 && markerLines(ls) / ls.length >= 0.5) return 'copyright';
  if (ls.length >= 6) {
    const tl = ls.filter((l) => A_TOC_LINE.test(l)).length;
    if (tl / ls.length >= 0.5 && median(ls.map((l) => l.length)) <= 32) return 'toc';
  }
  return 'prose';
}

// ---- (B) proposed --------------------------------------------------------------
const B_TITLES = new Set(['版权', '版权信息', '版权页', '版权声明', '目录', '目次', '扉页', '封面', '封底', '书名页', '内容简介', '内容提要', '出版信息', '图书在版编目']);
const B_STRONG = ['图书在版编目', 'CIP数据', '版权所有', '出版发行', '责任编辑', '封面设计', '装帧设计', '开本', '印张', '印次', '版次', '经销', '书号', '定价', 'ISBN'];
const norm = (t) => (t ?? '').replace(/[\s\u3000]/g, '').replace(/^[《【［（(\[]+/, '').replace(/[》】］）)\]:：、.。·\-—]+$/, '');
function assessB(title, text) {
  if (B_TITLES.has(norm(title))) return 'title';
  const hk = B_STRONG.filter((m) => text.slice(0, 500).includes(m)).length;
  if (hk >= 2 && text.length <= 1000) return 'copyright';
  const ls = lines(text);
  const endP = ls.length ? ls.filter((l) => /[。！？…”」』：；!?]$/.test(l)).length / ls.length : 1;
  const maxLen = ls.length ? Math.max(...ls.map((l) => l.length)) : 0;
  if (ls.length >= 8 && median(ls.map((l) => l.length)) <= 25 && maxLen <= 120 && endP <= 0.3) return 'toc-list';
  return 'prose';
}

// ---- corpus -------------------------------------------------------------------
const files = readdirSync('.scratch/out').filter((f) => f.startsWith('nodes-') && f.endsWith('.json'));
const all = [];
for (const f of files) all.push(...JSON.parse(readFileSync(`.scratch/out/${f}`, 'utf8')));
const app = JSON.parse(readFileSync('.scratch/out/app-nodes.json', 'utf8'));

const show = (label, n, title, text) => {
  const ls = lines(text);
  const hits = A_MARKERS.filter((m) => text.includes(m));
  const a = assessA(title, text);
  const b = assessB(title, text);
  console.log(
    `${label.padEnd(4)} ${n.book.replace('.epub', '').slice(0, 12).padEnd(12)} | ${(title || '(空)').slice(0, 24).padEnd(24)} | chars=${String(text.length).padStart(6)} lines=${String(ls.length).padStart(4)} med=${String(median(ls.map((l) => l.length))).padStart(3)} | A_markers=${hits.length} A_markerLines=${markerLines(ls)}/${ls.length}(${(markerLines(ls) / Math.max(1, ls.length)).toFixed(2)}) | A=${a.padEnd(9)} B=${b}`,
  );
};

console.log('\n### (1) app-pipeline nodes — the motivating real cases');
for (const n of app) {
  if (n.nodeIndex > 3 && !/版权|目录|序言|封面|扉页|书名/.test(n.title)) continue;
  if (!/版权|目录|序言|封面|扉页|书名|^第 [123] 节$/.test(n.title)) continue;
  show('app', n, n.title, n.text);
}

console.log('\n### (2) EPUB-direct: every front/back-matter page of the 14 books');
for (const n of all) {
  const title = n.label ?? '';
  if (!/^(版权|版权信息|版权页|书名页|扉页|封面|封底|目\s*录|目\s*次)$/.test(title.trim())) continue;
  show('epub', n, title, n.text);
}

console.log('\n### (3) false-positive traps (real prose that a naive rule would hide)');
for (const n of all) {
  const title = (n.label ?? '').trim();
  if (!/^(序言|前言|后记|译后记|跋|附录|致谢|结语|尾声|导论|绪论|引言|自序|人名索引|参考文献|走出唯一真理观)$/.test(title)) continue;
  show('trap', n, title, n.text);
}

console.log('\n### corpus totals');
for (const [name, set, titleOf, textOf] of [
  ['app-pipeline (818)', app, (n) => n.title, (n) => n.text],
  ['EPUB-direct (1295)', all, (n) => n.label ?? '', (n) => n.text],
]) {
  let a = 0; let b = 0;
  for (const n of set) {
    if (assessA(titleOf(n), textOf(n)) !== 'prose') a += 1;
    if (assessB(titleOf(n), textOf(n)) !== 'prose') b += 1;
  }
  console.log(`  ${name}: current(A) blocks ${a}, proposed(B) blocks ${b}`);
}

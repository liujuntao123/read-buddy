/**
 * Throwaway: final verification of the RECOMMENDED rule set (v5) across both
 * real corpora, with the hardened marker list (no 定价/印刷/出版社, which are
 * ordinary economics/legal vocabulary in Chinese prose).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

const sha = createHash('sha256')
  .update(readFileSync('apps/readest-app/src/services/bookNodes/nodeContent.ts'))
  .digest('hex')
  .slice(0, 12);
console.log(`(compared against nodeContent.ts sha256=${sha})\n`);

const TITLE_TABLE = new Set([
  '版权', '版权信息', '版权页', '版权声明', '目录', '目次', '扉页', '封面', '封底',
  '书名页', '出版信息', '图书在版编目', '内容简介', '内容提要',
]);
const norm = (t) => (t ?? '').replace(/[\s\u3000]/g, '').replace(/^[《【［（(\[]+/, '').replace(/[》】］）)\]:：、.。·\-—]+$/, '');

/** Hardened: only markers that essentially never appear in ordinary prose. */
const STRONG = [
  '图书在版编目', 'CIP数据', '版权所有', '侵权必究', 'ISBN', '出版发行',
  '责任编辑', '封面设计', '装帧设计', '开本', '印张', '印次', '版次', '经销', '书号',
];
const HEAD_CHARS = 500;
const MAX_COPYRIGHT_CHARS = 1000;

const lines = (t) => t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
const median = (v) => { if (!v.length) return 0; const s = [...v].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };

function classify(title, text) {
  if (TITLE_TABLE.has(norm(title))) return 'title';
  const head = text.slice(0, HEAD_CHARS);
  const headKinds = STRONG.filter((m) => head.includes(m));
  if (headKinds.length >= 2 && text.length <= MAX_COPYRIGHT_CHARS) return `copyright(${headKinds.length})`;
  const ls = lines(text);
  const endP = ls.length ? ls.filter((l) => /[。！？…”」』：；!?]$/.test(l)).length / ls.length : 1;
  const maxLen = ls.length ? Math.max(...ls.map((l) => l.length)) : 0;
  if (ls.length >= 8 && median(ls.map((l) => l.length)) <= 25 && maxLen <= 120 && endP <= 0.3) return 'toc-list';
  return 'prose';
}

const files = readdirSync('.scratch/out').filter((f) => f.startsWith('nodes-') && f.endsWith('.json'));
const all = [];
for (const f of files) all.push(...JSON.parse(readFileSync(`.scratch/out/${f}`, 'utf8')));
const app = JSON.parse(readFileSync('.scratch/out/app-nodes.json', 'utf8'));

const FM_TITLE = /(版权|目录|目次|扉页|封面|封底|书名页|出版说明|凡例|献词|题记|内容简介|内容提要|索引|参考|附录|后记|译后记|跋|序|前言|引言|导论|绪论|结语|尾声|致谢|自序|重印|编后)/;

for (const [name, set, tOf, xOf] of [
  ['app-pipeline (real extractor+segmenter, 818)', app, (n) => n.title, (n) => n.text],
  ['EPUB-direct (14 books, 1295)', all, (n) => n.label ?? '', (n) => n.text],
]) {
  console.log(`### ${name}`);
  let blocked = 0;
  for (const n of set) {
    const title = tOf(n);
    const text = xOf(n);
    const kind = classify(title, text);
    if (kind === 'prose') continue;
    blocked += 1;
    const suspicious = !FM_TITLE.test((title ?? '').replace(/\s/g, '')) && !/^第\s*\d+\s*[章节段]$/.test((title ?? '').trim());
    console.log(
      `  ${kind.padEnd(14)} ${(title || '(空)').slice(0, 24).padEnd(24)} chars=${String(text.length).padStart(6)}${suspicious ? '   <-- title not front/back matter (inspect)' : ''}`,
    );
  }
  console.log(`  → blocked ${blocked}/${set.length}\n`);
}

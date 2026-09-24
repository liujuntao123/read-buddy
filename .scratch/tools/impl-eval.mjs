/**
 * Throwaway: run the CURRENT IMPLEMENTATION's rule set
 * (apps/read-buddy-app/src/services/bookNodes/nodeContent.ts) over both real-book
 * node datasets, to see exactly which nodes it hides.
 *
 * `COPYRIGHT_MAX_LINE` is referenced by that file but NOT defined anywhere, so it
 * is simulated at several values.
 */
import { readFileSync, readdirSync } from 'node:fs';

const STRUCTURAL_TITLES = [
  { pattern: /^(封面|书封|封底|护封|扉页|书名页|插页|彩插|插图页?)$/, kind: 'cover' },
  {
    pattern: /^(版权(信息|页|声明)?|出版信息|图书在版编目(\(CIP\))?数据?|CIP数据|版次|印次)$/i,
    kind: 'copyright',
  },
  { pattern: /^(目\s*录|目\s*次|contents?|table of contents)$/i, kind: 'toc' },
];
const COPYRIGHT_MARKERS = [
  '图书在版编目', 'CIP', '版权所有', '侵权必究', 'ISBN', '出版发行', '出版社', '印刷',
  '印张', '开本', '定价', '书号', '责任编辑', '封面设计', '经销', '版次', '印次',
];
const COPYRIGHT_MARKER_MIN = 3;
const TOC_LINE =
  /^(第\s*[0-9一二三四五六七八九十百千零两]+\s*[章回节卷部篇集幕]|[§＄]|Chapter\s|Part\s|\d+([.、．)）]|\s)|contents?$|目\s*次)/i;
const TOC_MIN_LINES = 6;
const TOC_MIN_RATIO = 0.5;
const TOC_MAX_MEDIAN_LINE = 32;

const nonEmptyLines = (t) =>
  t.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
const median = (v) => {
  if (!v.length) return 0;
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? Math.round((s[m - 1] + s[m]) / 2) : s[m];
};

function assess(title, text, COPYRIGHT_MAX_LINE) {
  title = (title ?? '').trim();
  const lines = nonEmptyLines(text.trim());
  const structural = STRUCTURAL_TITLES.find(({ pattern }) => pattern.test(title));
  if (structural) return { kind: structural.kind, reason: 'title' };
  const hits = COPYRIGHT_MARKERS.filter((m) => text.includes(m));
  if (hits.length >= COPYRIGHT_MARKER_MIN && lines.length > 0) {
    const markerLines = lines.filter((l) => COPYRIGHT_MARKERS.some((m) => l.includes(m))).length;
    if (markerLines / lines.length >= 0.5) {
      return { kind: 'copyright', reason: `markers=${hits.length} markerLines=${markerLines}/${lines.length}` };
    }
    return { kind: 'prose', reason: `below-density markers=${hits.length} markerLines=${markerLines}/${lines.length}` };
  }
  if (lines.length >= TOC_MIN_LINES) {
    const tocLines = lines.filter((l) => TOC_LINE.test(l)).length;
    if (tocLines / lines.length >= TOC_MIN_RATIO && median(lines.map((l) => l.length)) <= TOC_MAX_MEDIAN_LINE) {
      return { kind: 'toc', reason: `toc=${tocLines}/${lines.length} med=${median(lines.map((l) => l.length))}` };
    }
  }
  return { kind: 'prose', reason: '' };
}

const FM_TITLE =
  /(版权|目录|目次|扉页|封面|封底|书名页|出版说明|凡例|献词|题记|内容简介|内容提要|索引|参考|附录|后记|译后记|跋|序|前言|引言|导论|绪论|结语|尾声|致谢|自序|重印|编后)/;
const PLACEHOLDER = /^第\s*\d+\s*[章节段]$/;

function report(name, nodes, cap) {
  console.log(`\n${'='.repeat(100)}\n### ${name} — COPYRIGHT_MAX_LINE=${cap}`);
  const blocked = [];
  for (const n of nodes) {
    const r = assess(n.title, n.text ?? n.__text ?? '', cap);
    if (r.kind !== 'prose') blocked.push({ n, r });
    n.__verdict = r;
  }
  console.log(`blocked: ${blocked.length} / ${nodes.length}`);
  let suspicious = 0;
  for (const { n, r } of blocked) {
    const title = (n.label ?? n.title ?? '').trim();
    // "real content" = plainly prose-shaped (long paragraph line) or a known prose title
    const isProseTitle = /^(序|前言|后记|译后记|跋|附录|致谢|结语|尾声|导论|绪论|引言|自序|新版前言|内容简介)/.test(title);
    const flag = isProseTitle ? '  <-- REAL CONTENT HIDDEN' : '';
    if (isProseTitle) suspicious += 1;
    console.log(
      `  ${String(r.kind).padEnd(9)} ${title.slice(0, 26).padEnd(26)} chars=${String(n.charCount).padStart(6)} lines=${String(n.shape?.lineCount ?? nonEmptyLines(n.text).length).padStart(4)} med=${String(median(nonEmptyLines(n.text).map((l) => l.length))).padStart(3)} max=${String(n.shape?.maxLineLen ?? Math.max(0, ...nonEmptyLines(n.text).map((l) => l.length))).padStart(4)} | ${r.reason}${flag}`,
    );
  }
  console.log(`  → suspicious (prose-title): ${suspicious}`);
}

// (b) app-pipeline nodes (authoritative: real extractor + real segmenter)
const app = JSON.parse(readFileSync('.scratch/out/app-nodes.json', 'utf8'));
for (const n of app) n.title = n.title ?? '';
report('app-pipeline nodes (real extractor)', app, 0);

// (a) EPUB-direct nodes (all 14 books)
const files = readdirSync('.scratch/out').filter((f) => f.startsWith('nodes-') && f.endsWith('.json'));
const all = [];
for (const f of files) all.push(...JSON.parse(readFileSync(`.scratch/out/${f}`, 'utf8')));
for (const n of all) n.title = n.label ?? '';
report('EPUB-direct nodes (14 books)', all, 0);

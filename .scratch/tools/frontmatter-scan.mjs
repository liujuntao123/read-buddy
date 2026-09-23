/**
 * Throwaway (read-only) front/back-matter scanner.
 *
 * For every EPUB argument it resolves OPF → manifest → spine → NCX/nav, strips
 * tags out of every spine file, and prints one row per spine file:
 *   index | NCX labels pointing at it | charCount | marker hits | TOC-shape metrics
 *
 * Usage: node .scratch/tools/frontmatter-scan.mjs "E:\书籍\*.epub" ...
 * Env:   SCAN_ALL=1 prints every spine file (default: only front/back matter +
 *        any file firing a content marker).
 */
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(
  'file:///C:/Users/admin/myspace/readest-plus/apps/readest-app/package.json',
);
const JSZip = require('jszip');

const decode = (buf) => new TextDecoder('utf-8').decode(buf);
const stripRef = (ref) => ref.split('#')[0].split('?')[0];
const fragmentOf = (ref) => (ref.includes('#') ? ref.split('#')[1] : '');

function resolveRelative(baseDir, href) {
  const out = [];
  for (const seg of [...baseDir.split('/'), ...href.split('/')]) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  return out.join('/');
}
const dirOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');

const ENTITIES = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", ldquo: '“', rdquo: '”',
  mdash: '—', ndash: '–', hellip: '…', middot: '·',
};
function decodeEntities(s) {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (all, body) => {
    if (body[0] === '#') {
      const hex = body[1] === 'x' || body[1] === 'X';
      const code = parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : all;
    }
    return ENTITIES[body.toLowerCase()] ?? all;
  });
}

/** HTML → newline-preserving plain text. */
function htmlToText(html) {
  const bodyStart = html.search(/<body\b/i);
  let s = bodyStart >= 0 ? html.slice(bodyStart) : html;
  s = s.replace(/<(script|style|head)\b[\s\S]*?<\/\1>/gi, '');
  s = s.replace(/<br\b[^>]*>/gi, '\n');
  s = s.replace(/<\/(p|div|h[1-6]|li|tr|section|article|blockquote|figcaption)\s*>/gi, '\n');
  s = s.replace(/<[^>]*>/g, '');
  s = decodeEntities(s);
  s = s.replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n');
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

/** Raw text of the element carrying id/name=fragment, to the end of file. */
function textAfterFragment(html, fragment) {
  if (!fragment) return null;
  const esc = fragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?:id|name)\\s*=\\s*["']${esc}["']`, 'i');
  const m = re.exec(html);
  if (!m) return null;
  return html.slice(m.index);
}

function analyzeNcx(xml) {
  const rows = [];
  let depth = 0;
  let current = null;
  const re =
    /<(\/?)navPoint\b([^>]*)|<text\b[^>]*>([\s\S]*?)<\/text>|<content\b[^>]*\bsrc\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    if (m[0].startsWith('</navPoint')) {
      if (current) rows.push(current);
      current = null;
      depth = Math.max(0, depth - 1);
    } else if (m[0].startsWith('<navPoint')) {
      if (current) rows.push(current);
      depth += 1;
      current = { depth, label: '', href: '' };
    } else if (m[0].startsWith('<text')) {
      if (current) current.label = decodeEntities((m[3] ?? '').replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
    } else if (m[0].startsWith('<content')) {
      if (current) current.href = m[5] ?? m[6] ?? '';
    }
  }
  if (current) rows.push(current);
  return rows;
}

function analyzeNav(html) {
  const rows = [];
  let olDepth = 0;
  let pendingHref = null;
  let pendingText = '';
  const tagRe = /<(\/?)([a-zA-Z0-9:]+)([^>]*)>/g;
  let last = 0;
  let m;
  while ((m = tagRe.exec(html)) !== null) {
    if (pendingHref !== null) pendingText += html.slice(last, m.index);
    last = tagRe.lastIndex;
    const [full, slash, rawName, attrs] = m;
    const name = rawName.toLowerCase();
    if (name === 'ol') {
      if (slash === '/') olDepth = Math.max(0, olDepth - 1);
      else if (!full.endsWith('/>')) olDepth += 1;
      continue;
    }
    if (name === 'a') {
      if (slash === '/') {
        rows.push({
          depth: olDepth,
          label: decodeEntities(pendingText.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim(),
          href: pendingHref,
        });
        pendingHref = null;
        pendingText = '';
      } else {
        const href = /\bhref\s*=\s*("([^"]*)"|'([^']*)')/.exec(attrs);
        pendingHref = href ? (href[2] ?? href[3] ?? '') : '';
        pendingText = '';
      }
    }
  }
  return rows;
}

// ---------------------------------------------------------------- signals ---

const COPYRIGHT_MARKERS = [
  'ISBN', '图书在版编目', 'CIP', '版权所有', '出版发行', '印刷', '开本', '印张',
  '字数', '定价', '书号', '责任编辑', '封面设计', '经销', '版次', '印次',
];

const TITLE_KEYWORDS = [
  '版权', '目录', '目次', '扉页', '封面', '书名页', '出版说明', '凡例', '献词',
  '题记', '内容简介', '内容提要', '编者的话', '出版说明', '印次', '版次',
];

const HEAD_LINE_RE =
  /^(第\s*[0-9一二三四五六七八九十百千零两]+\s*[章回节卷部篇集幕]|§|Chapter\s|Part\s|Contents?$)/i;

function markersIn(text) {
  const hits = [];
  for (const marker of COPYRIGHT_MARKERS) {
    const count = text.split(marker).length - 1;
    if (count > 0) hits.push({ marker, count });
  }
  return hits;
}

function tocShape(text) {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const lens = lines.map((l) => l.length).sort((a, b) => a - b);
  const median = lens.length ? lens[Math.floor(lens.length / 2)] : 0;
  const headLines = lines.filter((l) => HEAD_LINE_RE.test(l)).length;
  const digitTail = lines.filter((l) => /[.…·\s]\s*\d{1,4}\s*$/.test(l)).length;
  const pageNumOnly = lines.filter((l) => /^\d{1,4}$/.test(l)).length;
  return {
    lineCount: lines.length,
    medianLineLen: median,
    maxLineLen: lens.length ? lens[lens.length - 1] : 0,
    headLineFraction: lines.length ? +(headLines / lines.length).toFixed(3) : 0,
    headLines,
    digitTailFraction: lines.length ? +(digitTail / lines.length).toFixed(3) : 0,
    pageNumOnlyFraction: lines.length ? +(pageNumOnly / lines.length).toFixed(3) : 0,
  };
}

const FRONT_MATTER_TITLE_RE = new RegExp(
  `^(${['版权', '目录', '目次', '扉页', '封面', '书名页', '出版说明', '凡例', '献词', '题记', '内容简介', '内容提要'].join('|')})`,
);

async function inspect(file) {
  const zip = await JSZip.loadAsync(readFileSync(file));
  const container = decode(await zip.file('META-INF/container.xml').async('uint8array'));
  const opfPath = /full-path\s*=\s*"([^"]+)"/.exec(container)?.[1];
  const opfDir = dirOf(opfPath);
  const opf = decode(await zip.file(opfPath).async('uint8array'));

  const manifest = new Map();
  for (const m of opf.matchAll(/<item\b([^>]*)\/?>/g)) {
    const attrs = m[1];
    const get = (n) => new RegExp(`\\b${n}\\s*=\\s*"([^"]*)"`).exec(attrs)?.[1];
    const id = get('id');
    if (id) manifest.set(id, { id, href: get('href'), mediaType: get('media-type'), properties: get('properties') });
  }
  const spine = [...opf.matchAll(/<itemref\b([^>]*)\/?>/g)]
    .map((m) => /\bidref\s*=\s*"([^"]*)"/.exec(m[1])?.[1])
    .filter(Boolean);
  const spineItems = spine.map((id) => manifest.get(id)).filter(Boolean);

  // TOC entries (NCX preferred, nav fallback) → per-file labels
  const navItem = [...manifest.values()].find((i) => (i.properties ?? '').split(/\s+/).includes('nav'));
  const ncxItem =
    manifest.get(/<spine\b[^>]*\btoc\s*=\s*"([^"]*)"/.exec(opf)?.[1]) ??
    [...manifest.values()].find((i) => i.mediaType === 'application/x-dtbncx+xml');

  let entries = [];
  let tocSource = '';
  if (ncxItem) {
    const p = resolveRelative(opfDir, stripRef(ncxItem.href));
    const f = zip.file(p) ?? zip.file(decodeURIComponent(p));
    if (f) {
      tocSource = 'ncx';
      const ncxDir = dirOf(p);
      entries = analyzeNcx(decode(await f.async('uint8array'))).map((r) => ({
        label: r.label,
        depth: r.depth,
        href: r.href,
        file: resolveRelative(ncxDir, stripRef(r.href)),
        fragment: fragmentOf(r.href),
      }));
    }
  }
  if (!entries.length && navItem) {
    const p = resolveRelative(opfDir, stripRef(navItem.href));
    const f = zip.file(p) ?? zip.file(decodeURIComponent(p));
    if (f) {
      tocSource = 'nav';
      const navDir = dirOf(p);
      entries = analyzeNav(decode(await f.async('uint8array'))).map((r) => ({
        label: r.label,
        depth: r.depth,
        href: r.href,
        file: resolveRelative(navDir, stripRef(r.href)),
        fragment: fragmentOf(r.href),
      }));
    }
  }

  const byFile = new Map();
  for (const e of entries) {
    const key = e.file.replace(/^\.\//, '');
    if (!byFile.has(key)) byFile.set(key, []);
    byFile.get(key).push(e);
  }

  const files = [];
  for (let i = 0; i < spineItems.length; i += 1) {
    const item = spineItems[i];
    const p = resolveRelative(opfDir, stripRef(item.href));
    const f = zip.file(p) ?? zip.file(decodeURIComponent(p));
    if (!f) continue;
    const html = decode(await f.async('uint8array'));
    const text = htmlToText(html);
    const labels = (byFile.get(p) ?? []).map((e) => ({ label: e.label, depth: e.depth, fragment: e.fragment }));
    files.push({
      spineIndex: i,
      path: p,
      labels,
      charCount: text.length,
      text,
      markers: markersIn(text),
      shape: tocShape(text),
    });
  }

  const slug = path.basename(file, '.epub').replace(/[^\w\u4e00-\u9fa5-]+/g, '_');
  mkdirSync('.scratch/out', { recursive: true });
  writeFileSync(
    `.scratch/out/${slug}.json`,
    JSON.stringify(
      {
        book: path.basename(file),
        opfPath,
        tocSource,
        spineSections: files.length,
        entries: entries.length,
        files,
      },
      null,
      1,
    ),
  );

  const showAll = process.env.SCAN_ALL === '1';
  console.log('='.repeat(100));
  console.log(`${path.basename(file)}  spine=${files.length} toc=${entries.length}(${tocSource})`);
  for (const f of files) {
    const titles = f.labels.map((l) => l.label || '(空标题)').join(' | ');
    const isFm = FRONT_MATTER_TITLE_RE.test(titles) || f.labels.some((l) => TITLE_KEYWORDS.some((k) => l.label.includes(k)));
    const interesting = isFm || f.markers.length >= 3;
    if (!showAll && !interesting) continue;
    const ms = f.markers.map((m) => `${m.marker}x${m.count}`).join(',');
    console.log(
      `  #${String(f.spineIndex).padStart(3)} chars=${String(f.charCount).padStart(6)} ` +
        `lines=${String(f.shape.lineCount).padStart(4)} medLen=${String(f.shape.medianLineLen).padStart(3)} ` +
        `headF=${f.shape.headLineFraction} digitF=${f.shape.digitTailFraction} ` +
        `| ${titles.slice(0, 60)} | ${ms}`,
    );
  }
}

for (const file of process.argv.slice(2)) {
  try {
    await inspect(file);
  } catch (err) {
    console.error(`FAILED ${file}: ${err.message}`);
  }
}

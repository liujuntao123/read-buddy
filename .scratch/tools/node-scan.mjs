/**
 * Throwaway (read-only) NODE-level scanner — mirrors `buildTocNodes` closely
 * enough for evidence: every TOC entry becomes a node whose text runs from its
 * anchor (or file start) to the next entry's anchor in the same file.
 *
 * Writes .scratch/out/nodes-<slug>.json and prints a compact table.
 * Usage: node .scratch/tools/node-scan.mjs "E:\书籍\*.epub" ...
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
function fragmentOffset(html, fragment) {
  if (!fragment) return 0;
  const esc = fragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?:id|name)\\s*=\\s*["']${esc}["']`, 'i');
  const m = re.exec(html);
  return m ? m.index : -1;
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
      if (current)
        current.label = decodeEntities((m[3] ?? '').replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
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

// ------------------------------------------------------------- candidate rules

export const COPYRIGHT_MARKERS = [
  'ISBN', '图书在版编目', 'CIP', '版权所有', '出版发行', '印刷', '开本', '印张',
  '定价', '书号', '责任编辑', '封面设计', '经销', '版次', '印次',
];

/** Weighted marker groups (draft rule v2). */
export const STRONG_MARKERS = [
  '图书在版编目', 'CIP数据', '版权所有', '出版发行', '责任编辑', '封面设计',
  '开本', '印张', '印次', '版次', '经销', '书号', '定价',
];
export const WEAK_MARKERS = ['ISBN', '字数', '印刷', '出版', 'CIP'];

const HEAD_LINE_RE =
  /^(第\s*[0-9一二三四五六七八九十百千零两]+\s*[章回节卷部篇集幕]|§|Chapter\s|Part\s|Contents?$)/i;

function shape(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  const lens = lines.map((l) => l.length).sort((a, b) => a - b);
  const headLines = lines.filter((l) => HEAD_LINE_RE.test(l)).length;
  const tailNum = lines.filter((l) => /\d{1,4}\s*$/.test(l)).length;
  const endPunct = lines.filter((l) => /[。！？…”」』：；!?]$/.test(l)).length;
  const longLines = lines.filter((l) => l.length >= 120).length;
  const median = lens.length ? lens[Math.floor(lens.length / 2)] : 0;
  return {
    lineCount: lines.length,
    medianLineLen: median,
    maxLineLen: lens.length ? lens[lens.length - 1] : 0,
    headLines,
    headFraction: lines.length ? +(headLines / lines.length).toFixed(3) : 0,
    tailNumFraction: lines.length ? +(tailNum / lines.length).toFixed(3) : 0,
    endPunctFraction: lines.length ? +(endPunct / lines.length).toFixed(3) : 0,
    longLines,
    // a "listing" shape: many short lines, no long paragraph line
    isListing: lines.length >= 12 && median <= 25 && longLines === 0,
    lines,
  };
}

function markerHits(text) {
  const hits = {};
  for (const mk of COPYRIGHT_MARKERS) {
    const n = text.split(mk).length - 1;
    if (n > 0) hits[mk] = n;
  }
  return hits;
}
const markerScore = (hits) => Object.keys(hits).length;

async function inspect(epubPath) {
  const file = epubPath;
  const bookName = path.basename(epubPath, '.epub');
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
  const spinePaths = spine.map((id) => {
    const item = manifest.get(id);
    return item ? resolveRelative(opfDir, stripRef(item.href)) : null;
  });

  const navItem = [...manifest.values()].find((i) => (i.properties ?? '').split(/\s+/).includes('nav'));
  const ncxItem =
    manifest.get(/<spine\b[^>]*\btoc\s*=\s*"([^"]*)"/.exec(opf)?.[1]) ??
    [...manifest.values()].find((i) => i.mediaType === 'application/x-dtbncx+xml');
  let entries = [];
  if (ncxItem) {
    const p = resolveRelative(opfDir, stripRef(ncxItem.href));
    const f = zip.file(p) ?? zip.file(decodeURIComponent(p));
    if (f) {
      const d = dirOf(p);
      entries = analyzeNcx(decode(await f.async('uint8array'))).map((r) => ({
        label: r.label, depth: r.depth, file: resolveRelative(d, stripRef(r.href)), fragment: fragmentOf(r.href),
      }));
    }
  }
  if (!entries.length && navItem) {
    const p = resolveRelative(opfDir, stripRef(navItem.href));
    const f = zip.file(p) ?? zip.file(decodeURIComponent(p));
    if (f) {
      const d = dirOf(p);
      entries = analyzeNav(decode(await f.async('uint8array'))).map((r) => ({
        label: r.label, depth: r.depth, file: resolveRelative(d, stripRef(r.href)), fragment: fragmentOf(r.href),
      }));
    }
  }

  // resolve anchor offsets inside raw HTML per file
  const htmlCache = new Map();
  const getHtml = async (p) => {
    if (!htmlCache.has(p)) {
      const f = zip.file(p) ?? zip.file(decodeURIComponent(p));
      htmlCache.set(p, f ? decode(await f.async('uint8array')) : null);
    }
    return htmlCache.get(p);
  };

  const byFile = new Map();
  for (const e of entries) {
    if (!byFile.has(e.file)) byFile.set(e.file, []);
    byFile.get(e.file).push(e);
  }

  const nodes = [];
  for (const [zipFile, list] of byFile) {
    const html = await getHtml(zipFile);
    if (!html) continue;
    const withOffsets = [];
    for (const e of list) {
      const off = fragmentOffset(html, e.fragment);
      if (off < 0) continue; // anchor unresolvable → buildTocNodes drops it
      // start after the tag that carries the id, so no attribute text leaks in
      const gt = html.indexOf('>', off);
      const start = gt >= 0 && gt - off < 400 ? gt + 1 : off;
      withOffsets.push({ ...e, off, start });
    }
    withOffsets.sort((a, b) => a.off - b.off);
    const seen = new Set();
    withOffsets.forEach((e, i) => {
      // de-dup identical (off,depth) like the app does; keep key for reporting
      const key = `${e.off}:${e.depth}`;
      if (seen.has(key)) return;
      seen.add(key);
      const next = withOffsets.slice(i + 1).find((n) => n.off > e.off);
      // end at the '<' that opens the next anchor's tag
      const end = next ? Math.max(next.start - 1, html.lastIndexOf('<', next.off)) : html.length;
      const text = htmlToText(html.slice(e.start, end));
      const hits = markerHits(text);
      nodes.push({
        book: bookName,
        file: zipFile,
        label: e.label,
        depth: e.depth,
        charCount: text.length,
        markers: hits,
        markerKinds: markerScore(hits),
        shape: shape(text),
        text,
      });
    });
  }

  mkdirSync('.scratch/out', { recursive: true });
  const slug = bookName.replace(/[^\w\u4e00-\u9fa5-]+/g, '_');
  writeFileSync(`.scratch/out/nodes-${slug}.json`, JSON.stringify(nodes, null, 1));
  console.log(
    `${path.basename(file)}: ${nodes.length} nodes, spine=${spinePaths.filter(Boolean).length}, entries=${entries.length}`,
  );
}

for (const file of process.argv.slice(2)) {
  try {
    await inspect(file);
  } catch (err) {
    console.error(`FAILED ${file}: ${err.message}`);
  }
}

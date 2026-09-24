/**
 * Read-only EPUB TOC inspector.
 *
 * Answers one question per book: does the EPUB itself carry a nested
 * chapter/section hierarchy (nav.xhtml <ol> nesting / NCX navPoint nesting),
 * or is the published TOC genuinely a flat list?
 *
 * Usage: node .scratch/tools/inspect-toc.mjs "E:\\书籍\\xxx.epub"
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(
  'file:///C:/Users/admin/myspace/read-buddy/apps/read-buddy-app/package.json',
);
const JSZip = require('jszip');

const decode = (buf) => new TextDecoder('utf-8').decode(buf);

/** Strip a #fragment / ?query from a reference. */
const stripRef = (ref) => ref.split('#')[0].split('?')[0];
const fileNameOf = (p) => (p.split('/').pop() ?? '').toLowerCase();

/** Resolve an OPF-relative href against a base directory. */
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

/**
 * Walk nav.xhtml tags, tracking <ol> depth, and report every <a> with the
 * depth it sits at. Depth 1 = top-level list.
 */
function analyzeNav(html) {
  const rows = [];
  let olDepth = 0;
  let pendingHref = null;
  let pendingText = '';
  const tagRe = /<(\/?)([a-zA-Z0-9:]+)([^>]*)>/g;
  let last = 0;
  let m;
  while ((m = tagRe.exec(html)) !== null) {
    // text between the previous tag and this one
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
          label: pendingText.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim(),
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

/** Walk NCX navPoints and report playOrder/label/depth. */
function analyzeNcx(xml) {
  const rows = [];
  let depth = 0;
  let current = null;
  const re = /<(\/?)navPoint\b([^>]*)|<text\b[^>]*>([\s\S]*?)<\/text>|<content\b[^>]*\bsrc\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    if (m[0].startsWith('</navPoint')) {
      if (current) rows.push(current);
      current = null;
      depth = Math.max(0, depth - 1);
    } else if (m[0].startsWith('<navPoint')) {
      if (current) rows.push(current);
      depth += 1;
      const po = /\bplayOrder\s*=\s*"(\d+)"/.exec(m[2] ?? '');
      current = { depth, playOrder: po ? Number(po[1]) : null, label: '', href: '' };
    } else if (m[0].startsWith('<text')) {
      if (current) current.label = (m[3] ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    } else if (m[0].startsWith('<content')) {
      if (current) current.href = m[5] ?? m[6] ?? '';
    }
  }
  if (current) rows.push(current);
  return rows;
}

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
  const spinePaths = spine.map((id) => {
    const item = manifest.get(id);
    return item ? resolveRelative(opfDir, stripRef(item.href)) : `?${id}`;
  });

  console.log('='.repeat(78));
  console.log(`BOOK : ${path.basename(file)}`);
  console.log(`OPF  : ${opfPath}`);
  console.log(`SPINE: ${spinePaths.length} sections`);
  console.log(`TITLE: ${/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/.exec(opf)?.[1]?.trim()}`);

  const navItem = [...manifest.values()].find((i) => (i.properties ?? '').split(/\s+/).includes('nav'));
  const ncxItem =
    manifest.get(/<spine\b[^>]*\btoc\s*=\s*"([^"]*)"/.exec(opf)?.[1]) ??
    [...manifest.values()].find((i) => i.mediaType === 'application/x-dtbncx+xml');

  console.log(`NAV item: ${navItem ? resolveRelative(opfDir, stripRef(navItem.href)) : '(none)'}`);
  console.log(`NCX item: ${ncxItem ? resolveRelative(opfDir, stripRef(ncxItem.href)) : '(none)'}`);

  for (const [kind, item, analyze] of [
    ['NAV', navItem, analyzeNav],
    ['NCX', ncxItem, analyzeNcx],
  ]) {
    if (!item) continue;
    const p = resolveRelative(opfDir, stripRef(item.href));
    const entry = zip.file(p) ?? zip.file(decodeURIComponent(p));
    if (!entry) {
      console.log(`\n[${kind}] MISSING: ${p}`);
      continue;
    }
    const raw = decode(await entry.async('uint8array'));
    const rows = analyze(raw);
    const hist = {};
    for (const r of rows) hist[r.depth] = (hist[r.depth] ?? 0) + 1;
    console.log(`\n[${kind}] ${p}  (${raw.length} bytes, ${rows.length} entries)`);
    console.log(`  depth histogram: ${JSON.stringify(hist)}`);
    for (const r of rows) {
      const probe = kind === 'NCX' ? fileNameOf(stripRef(r.href)) : stripRef(r.href);
      console.log(`  ${'  '.repeat(Math.max(0, r.depth - 1))}d${r.depth} | ${r.label}  ->  ${probe}`);
    }
  }

  // Coverage: how many spine sections the nav actually points at
  if (navItem) {
    const p = resolveRelative(opfDir, stripRef(navItem.href));
    const entry = zip.file(p);
    if (entry) {
      const rows = analyzeNav(decode(await entry.async('uint8array')));
      const navFiles = new Set(rows.map((r) => fileNameOf(stripRef(r.href))));
      const spineFiles = new Set(spinePaths.map(fileNameOf));
      const uncovered = [...spineFiles].filter((f) => !navFiles.has(f));
      console.log(`\nCOVERAGE: nav files=${navFiles.size}, spine files=${spineFiles.size}, uncovered=${uncovered.length}`);
      if (uncovered.length) console.log(`  first uncovered: ${uncovered.slice(0, 10).join(', ')}`);
    }
  }
}

for (const file of process.argv.slice(2)) {
  try {
    await inspect(file);
  } catch (err) {
    console.error(`FAILED ${file}: ${err.message}`);
  }
}

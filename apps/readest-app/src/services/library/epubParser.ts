/**
 * Minimal EPUB parser (ticket 06, design doc "EPUB 解析").
 *
 * Pipeline: JSZip → META-INF/container.xml → OPF → Dublin Core metadata +
 * manifest + spine order. Section titles prefer the EPUB3 nav document
 * (nav[epub:type=toc] or the first nav), falling back to the EPUB2 NCX
 * toc.ncx, and finally to "第 N 节" for spine items the TOC does not cover.
 *
 * `parseEpub` decompresses and sanitizes every spine section once; the sync
 * getters then serve from cache (OpenedBookContent has synchronous accessors,
 * and re-rendering must not re-inflate the archive).
 */
import JSZip from 'jszip';
import { extractChapterText } from '@/services/reader/extractor';
import { sanitizeSectionHtml } from './sanitize';

/** Book shape shared by the parsers: OpenedBookContent minus bookHash. */
export interface ParsedBook {
  title: string;
  author?: string;
  sectionCount: number;
  getSectionTitle(index: number): string;
  getSectionHtml(index: number): string;
  getSectionText(index: number): string;
}

interface ManifestItem {
  id: string;
  href: string;
  mediaType: string;
  properties?: string;
}

const CONTAINER_PATH = 'META-INF/container.xml';

const parseXml = (xml: string): Document => new DOMParser().parseFromString(xml, 'application/xml');

/** All descendant elements (own walk: avoids parser quirks with `*` + namespaces). */
function descendants(root: Element): Element[] {
  const out: Element[] = [];
  const walk = (el: Element): void => {
    for (const child of Array.from(el.children)) {
      out.push(child);
      walk(child);
    }
  };
  walk(root);
  return out;
}

/** Local name of an element, robust to `dc:`-style prefixes. */
const localNameOf = (el: Element): string =>
  el.tagName.includes(':') ? (el.tagName.split(':').pop() ?? el.tagName) : el.tagName;

const findByLocalName = (root: Element, localName: string): Element[] =>
  descendants(root).filter((el) => localNameOf(el) === localName);

/** Strip `#fragment` and `?query` from an href/src reference. */
const stripRef = (ref: string): string => ref.split('#')[0]!.split('?')[0]!;

/** Lowercased file name of a path — TOC titles map to spine items by it. */
const fileNameOf = (path: string): string => (path.split('/').pop() ?? '').toLowerCase();

/** Directory part of a zip path ('' for root-level files). */
const dirOf = (path: string): string => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

/** Resolve an OPF-relative href against the OPF's directory. */
function resolveRelative(baseDir: string, href: string): string {
  if (!baseDir) return href;
  const out: string[] = [];
  for (const segment of [...baseDir.split('/'), ...href.split('/')]) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') out.pop();
    else out.push(segment);
  }
  return out.join('/');
}

/** Locate a zip entry, tolerating percent-encoding and case drift. */
function findEntry(zip: JSZip, path: string): JSZip.JSZipObject | null {
  const direct = zip.file(path) ?? zip.file(decodeURIComponent(path));
  if (direct) return direct;

  const target = path.toLowerCase();
  const base = `/${target.split('/').pop() ?? ''}`;
  let byLower: JSZip.JSZipObject | null = null;
  let byBase: JSZip.JSZipObject | null = null;
  zip.forEach((relativePath, file) => {
    if (file.dir) return;
    const lower = relativePath.toLowerCase();
    if (!byLower && lower === target) byLower = file;
    if (!byBase && base && lower.endsWith(base)) byBase = file;
  });
  return byLower ?? byBase;
}

async function readZipText(zip: JSZip, path: string): Promise<string | null> {
  const entry = findEntry(zip, path);
  if (!entry) return null;
  return entry.async('string');
}

function readOpfPath(containerXml: string): string | null {
  const doc = parseXml(containerXml);
  const rootfile = findByLocalName(doc.documentElement, 'rootfile')[0];
  return rootfile?.getAttribute('full-path') ?? null;
}

function readDublinCore(opf: Document): { title: string; author?: string } {
  const scope = findByLocalName(opf.documentElement, 'metadata')[0] ?? opf.documentElement;
  const title = (findByLocalName(scope, 'title')[0]?.textContent ?? '').trim();
  const author = (findByLocalName(scope, 'creator')[0]?.textContent ?? '').trim();
  return { title, author: author || undefined };
}

function readManifest(opf: Document): Map<string, ManifestItem> {
  const manifest = new Map<string, ManifestItem>();
  const manifestEl = findByLocalName(opf.documentElement, 'manifest')[0];
  if (!manifestEl) return manifest;
  for (const item of findByLocalName(manifestEl, 'item')) {
    const id = item.getAttribute('id');
    const href = item.getAttribute('href');
    if (!id || !href) continue;
    manifest.set(id, {
      id,
      href,
      mediaType: item.getAttribute('media-type') ?? '',
      properties: item.getAttribute('properties') ?? undefined,
    });
  }
  return manifest;
}

function readSpineIdrefs(opf: Document): string[] {
  const spineEl = findByLocalName(opf.documentElement, 'spine')[0];
  if (!spineEl) return [];
  return findByLocalName(spineEl, 'itemref')
    .map((itemref) => itemref.getAttribute('idref'))
    .filter((idref): idref is string => Boolean(idref));
}

/** EPUB2 NCX item: the spine@toc reference, else the first .ncx media item. */
function pickNcxItem(opf: Document, manifest: Map<string, ManifestItem>): ManifestItem | undefined {
  const spineEl = findByLocalName(opf.documentElement, 'spine')[0];
  const tocId = spineEl?.getAttribute('toc');
  if (tocId) {
    const item = manifest.get(tocId);
    if (item) return item;
  }
  return [...manifest.values()].find((item) => item.mediaType === 'application/x-dtbncx+xml');
}

/** EPUB3 nav document: anchor label per referenced file name (first wins). */
function collectNavTitles(navXml: string, titles: Map<string, string>): void {
  const doc = new DOMParser().parseFromString(navXml, 'text/html');
  const navs = Array.from(doc.getElementsByTagName('nav'));
  const toc =
    navs.find((nav) => (nav.getAttribute('epub:type') ?? nav.getAttribute('type')) === 'toc') ??
    navs[0];
  if (!toc) return;
  for (const anchor of Array.from(toc.getElementsByTagName('a'))) {
    const href = anchor.getAttribute('href');
    const label = (anchor.textContent ?? '').trim();
    if (!href || !label) continue;
    const file = fileNameOf(stripRef(href));
    if (file && !titles.has(file)) titles.set(file, label);
  }
}

/** EPUB2 NCX: navPoint label per content src file name (first wins). */
function collectNcxTitles(ncxXml: string, titles: Map<string, string>): void {
  const doc = parseXml(ncxXml);
  for (const navPoint of findByLocalName(doc.documentElement, 'navPoint')) {
    const label = (findByLocalName(navPoint, 'text')[0]?.textContent ?? '').trim();
    const src = findByLocalName(navPoint, 'content')[0]?.getAttribute('src');
    if (!label || !src) continue;
    const file = fileNameOf(stripRef(src));
    if (file && !titles.has(file)) titles.set(file, label);
  }
}

async function readTocTitles(
  zip: JSZip,
  opf: Document,
  manifest: Map<string, ManifestItem>,
  opfPath: string,
): Promise<Map<string, string>> {
  const titles = new Map<string, string>();
  const opfDir = dirOf(opfPath);

  const navItem = [...manifest.values()].find((item) =>
    (item.properties ?? '').split(/\s+/).includes('nav'),
  );
  if (navItem) {
    const raw = await readZipText(zip, resolveRelative(opfDir, stripRef(navItem.href)));
    if (raw !== null) collectNavTitles(raw, titles);
  }
  if (titles.size === 0) {
    const ncxItem = pickNcxItem(opf, manifest);
    if (ncxItem) {
      const raw = await readZipText(zip, resolveRelative(opfDir, stripRef(ncxItem.href)));
      if (raw !== null) collectNcxTitles(raw, titles);
    }
  }
  return titles;
}

/** Body inner markup of an XHTML section document. */
function bodyInnerHtml(raw: string): string {
  const doc = new DOMParser().parseFromString(raw, 'text/html');
  return doc.body ? doc.body.innerHTML : raw;
}

/**
 * Parse an EPUB archive into a ParsedBook (register-ready for the
 * opened-book registry via `bookLibrary.openBook`).
 */
export async function parseEpub(data: ArrayBuffer, hash: string): Promise<ParsedBook> {
  const zip = await JSZip.loadAsync(data);

  const containerXml = await readZipText(zip, CONTAINER_PATH);
  if (containerXml === null) {
    throw new Error(`EPUB 解析失败（${hash}）：缺少 META-INF/container.xml`);
  }
  const opfPath = readOpfPath(containerXml);
  if (!opfPath) {
    throw new Error(`EPUB 解析失败（${hash}）：container.xml 中未找到 OPF 路径`);
  }
  const opfXml = await readZipText(zip, opfPath);
  if (opfXml === null) {
    throw new Error(`EPUB 解析失败（${hash}）：未找到 OPF 文件 ${opfPath}`);
  }

  const opf = parseXml(opfXml);
  const meta = readDublinCore(opf);
  const manifest = readManifest(opf);
  const opfDir = dirOf(opfPath);

  const spinePaths: string[] = [];
  for (const idref of readSpineIdrefs(opf)) {
    const item = manifest.get(idref);
    if (!item) continue;
    spinePaths.push(resolveRelative(opfDir, stripRef(item.href)));
  }
  if (spinePaths.length === 0) {
    throw new Error(`EPUB 解析失败（${hash}）：spine 为空`);
  }

  const tocTitles = await readTocTitles(zip, opf, manifest, opfPath);
  const titles = spinePaths.map((path, i) => tocTitles.get(fileNameOf(path)) ?? `第 ${i + 1} 节`);

  // Decompress + sanitize every spine section exactly once; the synchronous
  // getters below serve from these caches (no re-inflate on later access).
  const htmlCache = new Map<number, string>();
  const textCache = new Map<number, string>();
  await Promise.all(
    spinePaths.map(async (path, index) => {
      const raw = await readZipText(zip, path);
      const safeHtml = sanitizeSectionHtml(raw === null ? '' : bodyInnerHtml(raw));
      htmlCache.set(index, safeHtml);
      textCache.set(index, extractChapterText(safeHtml).text);
    }),
  );

  return {
    title: meta.title || '未命名书籍',
    author: meta.author,
    sectionCount: spinePaths.length,
    getSectionTitle: (index) => titles[index] ?? `第 ${index + 1} 节`,
    getSectionHtml: (index) => htmlCache.get(index) ?? '',
    getSectionText: (index) => textCache.get(index) ?? '',
  };
}

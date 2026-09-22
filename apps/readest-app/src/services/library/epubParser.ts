/**
 * Minimal EPUB parser (ticket 06, design doc "EPUB 解析").
 *
 * Pipeline: JSZip → META-INF/container.xml → OPF → Dublin Core metadata +
 * manifest + spine order. Section titles prefer the EPUB3 nav document
 * (nav[epub:type=toc] or the first nav), falling back to the EPUB2 NCX
 * toc.ncx, and finally to "第 N 节" for spine items the TOC does not cover.
 *
 * The same TOC walk also yields the raw material of the node model: every
 * directory entry with its declared nesting depth, resolved onto the physical
 * spine, plus the line offsets of the intra-section anchors inside each spine
 * section (`getTocEntries` / `getSpineAnchors`). Both are computed from the
 * PRISTINE section markup, because the sanitizer drops `id` — the very
 * attribute a `#sigil_toc_id_N` destination names.
 *
 * `parseEpub` decompresses and sanitizes every spine section once; the sync
 * getters then serve from cache (OpenedBookContent has synchronous accessors,
 * and re-rendering must not re-inflate the archive).
 */
import JSZip from 'jszip';
import { extractAnchoredNodeText, resolveSpineAnchors } from '@/services/reader/extractor';
import { sanitizeSectionHtml } from './sanitize';
import type { BookTocEntry, NodeAnchor } from '@/types/readingAgent';

/** Book shape shared by the parsers: OpenedBookContent minus bookHash. */
export interface ParsedBook {
  title: string;
  author?: string;
  cover?: string;
  spineCount: number;
  getSpineTitle(index: number): string;
  getSpineHtml(index: number): string;
  getSpineText(index: number): string;
  /** The book's own directory, resolved onto the physical spine. */
  getTocEntries(): BookTocEntry[];
  /** Directory anchors located inside a spine section (empty when unknown). */
  getSpineAnchors(index: number): NodeAnchor[];
}

/** One directory row as parsed, before it is resolved onto the spine. */
interface RawTocEntry {
  label: string;
  href: string;
  /** Nesting depth declared by the directory (0 = top level). */
  depth: number;
}

/** Parsed directory plus the directory the entries' hrefs are relative to. */
interface TocEntries {
  entries: RawTocEntry[];
  dir: string;
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

/** `href` hash part (intra-section anchor) without the leading `#`. */
const anchorOf = (ref: string): string | undefined => {
  const hash = ref.split('#')[1];
  return hash ? hash : undefined;
};

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

/**
 * Count the element's ancestors matching `match` (parentNode chain, so it
 * behaves the same on the HTML and XML DOMs).
 */
function ancestorDepth(el: Element, match: (ancestor: Element) => boolean): number {
  let depth = 0;
  for (let node: Node | null = el.parentNode; node; node = node.parentNode) {
    if (node.nodeType === 1 && match(node as Element)) depth += 1;
  }
  return depth;
}

/**
 * EPUB3 nav document rows in document order: every `<a>` of the TOC nav,
 * labelled with the depth of the `<ol>` it is nested in (top list = 0).
 *
 * Reading all anchors (not only the first of each `<li>`) keeps the previous
 * title-collection semantics exactly; the depth is the new information the
 * node model needs to tell 章 from 节.
 */
function collectNavEntries(navXml: string): RawTocEntry[] {
  const doc = new DOMParser().parseFromString(navXml, 'text/html');
  const navs = Array.from(doc.getElementsByTagName('nav'));
  const toc =
    navs.find((nav) => (nav.getAttribute('epub:type') ?? nav.getAttribute('type')) === 'toc') ??
    navs[0];
  if (!toc) return [];
  const entries: RawTocEntry[] = [];
  for (const anchor of Array.from(toc.getElementsByTagName('a'))) {
    const href = anchor.getAttribute('href');
    const label = (anchor.textContent ?? '').trim();
    if (!href || !label) continue;
    const lists = ancestorDepth(anchor, (el) => el.tagName.toUpperCase() === 'OL');
    entries.push({ label, href, depth: Math.max(0, lists - 1) });
  }
  return entries;
}

/**
 * EPUB2 NCX `navPoint` rows in document order (pre-order, so a parent
 * precedes its children), each stamped with its number of enclosing
 * `navPoint`s as the declared nesting depth.
 */
function collectNcxEntries(ncxXml: string): RawTocEntry[] {
  const doc = parseXml(ncxXml);
  const entries: RawTocEntry[] = [];
  for (const navPoint of findByLocalName(doc.documentElement, 'navPoint')) {
    const label = (findByLocalName(navPoint, 'text')[0]?.textContent ?? '').trim();
    const src = findByLocalName(navPoint, 'content')[0]?.getAttribute('src');
    if (!label || !src) continue;
    entries.push({
      label,
      href: src,
      depth: ancestorDepth(navPoint, (el) => localNameOf(el) === 'navPoint'),
    });
  }
  return entries;
}

/**
 * Read the book's directory (EPUB3 nav preferred, EPUB2 NCX as fallback —
 * the same precedence the title map always used). `dir` is the archive
 * directory the returned hrefs are relative to, so the caller can resolve
 * them onto the spine.
 */
async function readTocEntries(
  zip: JSZip,
  opf: Document,
  manifest: Map<string, ManifestItem>,
  opfPath: string,
): Promise<TocEntries> {
  const opfDir = dirOf(opfPath);

  const navItem = [...manifest.values()].find((item) =>
    (item.properties ?? '').split(/\s+/).includes('nav'),
  );
  if (navItem) {
    const path = resolveRelative(opfDir, stripRef(navItem.href));
    const raw = await readZipText(zip, path);
    if (raw !== null) {
      const entries = collectNavEntries(raw);
      if (entries.length > 0) return { entries, dir: dirOf(path) };
    }
  }

  const ncxItem = pickNcxItem(opf, manifest);
  if (ncxItem) {
    const path = resolveRelative(opfDir, stripRef(ncxItem.href));
    const raw = await readZipText(zip, path);
    if (raw !== null) return { entries: collectNcxEntries(raw), dir: dirOf(path) };
  }

  return { entries: [], dir: opfDir };
}

/** Body inner markup of an XHTML section document. */
function bodyInnerHtml(raw: string): string {
  const doc = new DOMParser().parseFromString(raw, 'text/html');
  return doc.body ? doc.body.innerHTML : raw;
}

/** Convert a binary buffer to base64 safely across environments. */
export function toBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  return btoa(binary);
}

/**
 * Extract book cover image from EPUB manifest/metadata if available.
 * Checks EPUB3 properties="cover-image", EPUB2 meta[name="cover"], and
 * manifest item fallback with image media type.
 */
async function readCoverImage(
  zip: JSZip,
  opf: Document,
  manifest: Map<string, ManifestItem>,
  opfPath: string,
): Promise<string | undefined> {
  const opfDir = dirOf(opfPath);
  let coverItem: ManifestItem | undefined;

  // 1. EPUB 3: item with properties="cover-image"
  for (const item of manifest.values()) {
    if ((item.properties ?? '').split(/\s+/).includes('cover-image')) {
      coverItem = item;
      break;
    }
  }

  // 2. EPUB 2: <meta name="cover" content="item_id"/> in metadata
  if (!coverItem) {
    const metaCover = findByLocalName(opf.documentElement, 'meta').find(
      (el) => el.getAttribute('name')?.toLowerCase() === 'cover',
    );
    const coverId = metaCover?.getAttribute('content');
    if (coverId && manifest.has(coverId)) {
      coverItem = manifest.get(coverId);
    }
  }

  // 3. Fallback: manifest image item with id or href containing "cover"
  if (!coverItem) {
    for (const item of manifest.values()) {
      if (
        item.mediaType.startsWith('image/') &&
        (item.id.toLowerCase().includes('cover') || fileNameOf(item.href).toLowerCase().includes('cover'))
      ) {
        coverItem = item;
        break;
      }
    }
  }

  if (!coverItem) return undefined;

  const coverPath = resolveRelative(opfDir, stripRef(coverItem.href));
  const entry = findEntry(zip, coverPath);
  if (!entry) return undefined;

  try {
    const uint8 = await entry.async('uint8array');
    if (!uint8 || uint8.length === 0) return undefined;
    const mime = coverItem.mediaType || 'image/jpeg';
    return `data:${mime};base64,${toBase64(uint8)}`;
  } catch {
    return undefined;
  }
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

  const toc = await readTocEntries(zip, opf, manifest, opfPath);

  const spineIndexByPath = new Map<string, number>();
  const spineIndexByFile = new Map<string, number>();
  spinePaths.forEach((path, index) => {
    const lower = path.toLowerCase();
    if (!spineIndexByPath.has(lower)) spineIndexByPath.set(lower, index);
    const file = fileNameOf(path);
    if (!spineIndexByFile.has(file)) spineIndexByFile.set(file, index);
  });

  /** Resolve a directory href (relative to the TOC document) onto the spine. */
  const spineIndexOfHref = (href: string): number => {
    const path = resolveRelative(toc.dir, stripRef(href));
    const exact = spineIndexByPath.get(path.toLowerCase());
    if (exact !== undefined) return exact;
    return spineIndexByFile.get(fileNameOf(path)) ?? -1;
  };

  // Titles are still "first TOC entry naming that file wins", now derived
  // from the very same rows the node model consumes.
  const titlesByFile = new Map<string, string>();
  const tocEntries: BookTocEntry[] = toc.entries.map((entry) => {
    const file = fileNameOf(stripRef(entry.href));
    if (file && !titlesByFile.has(file)) titlesByFile.set(file, entry.label);
    return {
      label: entry.label,
      depth: entry.depth,
      spineIndex: spineIndexOfHref(entry.href),
      anchor: anchorOf(entry.href),
      href: entry.href,
    };
  });
  const titles = spinePaths.map((path, i) => titlesByFile.get(fileNameOf(path)) ?? `第 ${i + 1} 节`);
  const cover = await readCoverImage(zip, opf, manifest, opfPath);

  /** Anchor ids the directory places inside each spine section. */
  const anchorIdsBySpine = new Map<number, string[]>();
  for (const entry of tocEntries) {
    if (entry.spineIndex < 0 || !entry.anchor) continue;
    const ids = anchorIdsBySpine.get(entry.spineIndex);
    if (ids) ids.push(entry.anchor);
    else anchorIdsBySpine.set(entry.spineIndex, [entry.anchor]);
  }

  // Decompress every spine section exactly once; the synchronous getters
  // below serve from these caches (no re-inflate on later access). Text and
  // anchors come out of ONE extraction over the PRISTINE markup: the
  // sanitizer strips `id`, so an anchored heading would lose the attribute
  // the directory addresses it by. Only the display HTML is sanitized.
  const htmlCache = new Map<number, string>();
  const textCache = new Map<number, string>();
  const anchorCache = new Map<number, NodeAnchor[]>();
  await Promise.all(
    spinePaths.map(async (path, index) => {
      const raw = await readZipText(zip, path);
      const pristine = raw === null ? '' : bodyInnerHtml(raw);
      htmlCache.set(index, sanitizeSectionHtml(pristine));
      const extracted = extractAnchoredNodeText(pristine, anchorIdsBySpine.get(index) ?? []);
      textCache.set(index, extracted.text);
      anchorCache.set(index, resolveSpineAnchors(extracted.anchorOffsets));
    }),
  );

  return {
    title: meta.title || '未命名书籍',
    author: meta.author,
    cover,
    spineCount: spinePaths.length,
    getSpineTitle: (index) => titles[index] ?? `第 ${index + 1} 节`,
    getSpineHtml: (index) => htmlCache.get(index) ?? '',
    getSpineText: (index) => textCache.get(index) ?? '',
    getTocEntries: () => tocEntries.map((entry) => ({ ...entry })),
    getSpineAnchors: (index) => [...(anchorCache.get(index) ?? [])],
  };
}

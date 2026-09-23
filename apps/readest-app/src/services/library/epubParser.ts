/**
 * EPUB metadata reader (候选 9).
 *
 * What this module is: **the cheap half of ingestion**. `importBookFile` needs a
 * title, an author and a cover, and it used to get them from a parser that also
 * inflated, sanitized and text-extracted *every* spine section and resolved every
 * directory href onto the spine — `Promise.all` over the whole book — only for the
 * caller to keep three fields and discard the rest. The reader then re-resolved
 * the same directory with different rules inside the Foliate engine (`resolveTargetDestination`,
 * `buildTocIndexes`), so `BookTocEntry.spineIndex` could differ between import time
 * and open time, and only the engine's answer was ever used.
 *
 * Measured before this change: `parseEpub` returned a 9-member `ParsedBook`, and
 * **no production path consumed any member beyond `title`/`author`/`cover`** —
 * `openBook` routes EPUB through the engine and TXT through `parseTxt`. The
 * spine/text/directory half was a pass-through, so it is gone (deletion test:
 * complexity vanished, it did not reappear anywhere). ADR-0010 ¶31 had already
 * conceded the interface widening "for a caller that does not exist"; the caller
 * still does not exist.
 *
 * What it costs now: reading `container.xml`, the OPF, the Dublin Core metadata
 * and (only when a cover is declared) one image entry. That is O(metadata)
 * instead of O(book), which is what ADR-0002 asks for ("on demand", "no
 * pre-indexing wait").
 *
 * The spine is still *counted*, but not materialized: `readSpineIdrefs` only walks
 * the already-in-memory OPF, so an archive with an empty spine is rejected at
 * import time exactly as before, at no extra decompression cost.
 *
 * The one directory resolver that remains is the engine's — the single rule for
 * "directory entry → spine section" now lives where the pages are actually cut.
 */
import JSZip from 'jszip';

/** The three fields ingestion actually needs. */
export interface EpubMetadata {
  title: string;
  author?: string;
  cover?: string;
  /** Spine length, read from the OPF without inflating a single section. */
  spineCount: number;
}

/** EPUB3/EPUB2 both point at the OPF through the container document. */
const CONTAINER_PATH = 'META-INF/container.xml';

const parseXml = (xml: string): Document =>
  new DOMParser().parseFromString(xml, 'application/xml');

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
  (el.localName || el.tagName).toLowerCase().replace(/^.*:/, '');

const findByLocalName = (root: Element, localName: string): Element[] =>
  descendants(root).filter((el) => localNameOf(el) === localName.toLowerCase());

/** Strip `#fragment` and `?query` from an href/src reference. */
const stripRef = (ref: string): string => ref.split('#')[0]!.split('?')[0]!;

/** Directory part of a zip path ('' for root-level files). */
const dirOf = (path: string): string =>
  path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';

/** Resolve an OPF-relative href against the OPF's directory. */
function resolveRelative(baseDir: string, href: string): string {
  const parts = (baseDir ? `${baseDir}/${href}` : href).split('/');
  const stack: string[] = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return stack.join('/');
}

/** Locate a zip entry, tolerating percent-encoding and case drift. */
function findEntry(zip: JSZip, path: string): JSZip.JSZipObject | null {
  const direct = zip.file(path);
  if (direct) return direct;
  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    /* keep the raw path */
  }
  if (decoded !== path) {
    const byDecoded = zip.file(decoded);
    if (byDecoded) return byDecoded;
  }
  const lower = decoded.toLowerCase();
  const match = Object.keys(zip.files).find(
    (name) => name.toLowerCase() === lower && !zip.files[name]!.dir,
  );
  return match ? zip.file(match) : null;
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

interface ManifestItem {
  id: string;
  href: string;
  mediaType: string;
  properties?: string;
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

/**
 * Spine length. Only walks the OPF already in memory — no section is inflated —
 * so this keeps the "an EPUB with no spine is not importable" guard cheaply.
 */
function readSpineLength(opf: Document): number {
  const spineEl = findByLocalName(opf.documentElement, 'spine')[0];
  if (!spineEl) return 0;
  return findByLocalName(spineEl, 'itemref').filter((el) =>
    Boolean(el.getAttribute('idref')),
  ).length;
}

/** Convert a binary buffer to base64 safely across environments. */
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
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
    if (coverId) coverItem = manifest.get(coverId);
  }

  // 3. Fallback: the first image item whose id or file name mentions "cover".
  if (!coverItem) {
    for (const item of manifest.values()) {
      if (
        item.mediaType.startsWith('image/') &&
        (item.id.toLowerCase().includes('cover') ||
          item.href.toLowerCase().includes('cover'))
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
 * Read an EPUB's shelf metadata. Throws when the archive is not an EPUB
 * (missing container / OPF) or declares no spine, which is the same guard the
 * old full parse applied — just without decompressing the book to apply it.
 */
export async function readEpubMetadata(data: ArrayBuffer, hash: string): Promise<EpubMetadata> {
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
  const spineCount = readSpineLength(opf);
  if (spineCount === 0) {
    throw new Error(`EPUB 解析失败（${hash}）：spine 为空`);
  }

  const meta = readDublinCore(opf);
  const manifest = readManifest(opf);
  const cover = await readCoverImage(zip, opf, manifest, opfPath);

  return {
    title: meta.title || '未命名书籍',
    author: meta.author,
    cover,
    spineCount,
  };
}
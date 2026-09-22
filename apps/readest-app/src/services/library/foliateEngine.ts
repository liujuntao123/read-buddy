/**
 * Foliate rendering engine adapter (ticket 07).
 *
 * Wraps the vendored `vendor/foliate-js/view.js` `<foliate-view>` web
 * component behind a small, dependency-injected handle so that:
 * - the vendor module is only imported lazily at runtime (`openIn` /
 *   `prepare`), never at module top level — happy-dom tests inject a fake
 *   view module instead of loading the real one;
 * - the reader UI (FoliatePane), the library store and the opened-book
 *   registry (engineToContent) share one typed seam.
 *
 * Vendor facts this adapter relies on (verified in vendor/foliate-js):
 * - importing `view.js` registers `<foliate-view>` via customElements;
 * - `view.open(file)` resolves the format by magic numbers / file name and
 *   sets `view.book` (sections, toc, metadata) without rendering yet;
 * - `view.init()` performs the first navigation, which emits the initial
 *   `relocate`;
 * - `relocate` detail is `view.lastLocation` = {…progress, tocItem, pageItem,
 *   cfi, range}; the spine index lives at `section.current` (progress.js);
 * - `load` detail is `{ doc, index }` where `doc` is the chapter's iframe
 *   Document;
 * - every text format exposes `sections[i].createDocument()` → Document
 *   (EPUB/MOBI/FB2). `sections[i].load()` returns a *blob URL string*, not a
 *   Document, so it is only used as a fallback; CBZ sections are image-only
 *   and yield no extractable text.
 */
import { extractAnchoredNodeText, resolveSpineAnchors } from '@/services/reader/extractor';
import { engineWebfontCss } from '@/services/reader/webfonts';
import { sanitizeSectionHtml } from './sanitize';
import { toBase64 } from './epubParser';
import type { OpenedBookContent } from './contentRegistry';
import type { BookTocEntry, NodeAnchor } from '@/types/readingAgent';

/** Minimal structural types for the vendored foliate view element. */
export interface FoliateViewElement extends HTMLElement {
  open(bookOrFile: File | unknown): Promise<void>;
  init(options?: { lastLocation?: unknown; showTextStart?: boolean }): Promise<void>;
  close(): void;
  next(distance?: number): Promise<void>;
  prev(distance?: number): Promise<void>;
  goTo(target: unknown): Promise<unknown>;
  goToFraction(fraction: number): Promise<void>;
  book?: FoliateBook | null;
  lastLocation?: FoliateLocation | null;
}

/** Section of a foliate book (spine item). */
export interface FoliateSection {
  id?: string;
  href?: string;
  /** Returns the parsed section document (EPUB / MOBI / FB2). */
  createDocument?(): Promise<Document>;
  /** Returns a blob URL string for rendering (not a Document on EPUB/MOBI). */
  load?(): Promise<Document | string | null>;
  unload?(): void;
}

export interface FoliateTocItem {
  label: string;
  href: string;
  subitems?: FoliateTocItem[] | null;
}

/**
 * One reader-facing TOC row: label + destination + 0-based nesting depth.
 * Flattening preserves document order, which for a TOC tree is exactly a
 * pre-order walk (a parent directly precedes its children), so a consumer can
 * render the hierarchy by indenting on `depth`.
 */
export interface TocItem {
  label: string;
  href: string;
  /** 0 for a top-level 章, 1 for a 节 nested under it, and so on. */
  depth: number;
}

export interface FoliateBook {
  sections?: FoliateSection[];
  toc?: FoliateTocItem[];
  metadata?: { title?: string; author?: string };
  /** Foliate books expose the cover as a Blob (EPUB/MOBI/FB2/CBZ). */
  getCover?(): Promise<Blob | null>;
  /** EPUB/MOBI/FB2/CBZ books expose destroy() to release blob URLs. */
  destroy?(): void;
  resolveHref?(href: string): { index: number } | null;
}

/** Shape of `view.lastLocation` (view.js #onRelocate / progress.js). */
export interface FoliateLocation {
  index?: number;
  fraction?: number;
  cfi?: string;
  section?: { current?: number; total?: number };
  tocItem?: { label?: string; href?: string } | null;
}

/** Reader-facing position snapshot surfaced through the engine handle. */
export interface EngineLocation {
  index: number;
  fraction: number;
  cfi?: string;
  tocItemLabel?: string;
  /** href of the TOC entry covering the current position (chapter nav). */
  tocItemHref?: string;
}

export type ReaderTheme = 'light' | 'sepia' | 'dark';
export type PageMode = 'single' | 'double';

/**
 * Reader layout parameters mapped onto the paginator's attributes:
 * - `pageMode: 'single'` → `flow="scrolled"` + one column (infinite scroll),
 *   `'double'` → paginated columns;
 * - `contentWidth` → `max-inline-size` (the content column width — the
 *   adjustable “单页宽度”, also capping each paginated column);
 * - `pageMargin` → `margin` (top/bottom whitespace of the paginated page);
 * - `columnGap` → `gap` (column gap / side whitespace, percent).
 */
export interface ReaderLayoutParams {
  pageMode: PageMode;
  contentWidth?: number;
  pageMargin?: number;
  columnGap?: number;
}

export const DEFAULT_READER_LAYOUT: Required<ReaderLayoutParams> = {
  pageMode: 'double',
  contentWidth: 720,
  pageMargin: 48,
  columnGap: 7,
};

/**
 * Chapter-iframe theme CSS per reading look. Backgrounds mirror the app
 * theme surfaces (readest dark: #1D1D20, readest-sepia: #FAF5EA, light:
 * #FFFFFF) so the book page merges seamlessly with the surrounding UI
 * instead of showing a different tint under 护眼/夜间 mode.
 */
export function getReaderThemeStyles(theme: ReaderTheme): string {
  if (theme === 'dark') {
    return `
      html, body {
        color: #cbd5e1 !important;
        background-color: #1d1d20 !important;
      }
      a, a:link, a:visited {
        color: #60a5fa !important;
      }
      p, div, span, h1, h2, h3, h4, h5, h6, li, blockquote, dd, dt {
        color: inherit !important;
      }
      img, image, svg {
        filter: brightness(0.85) contrast(1.05);
      }
    `;
  }
  if (theme === 'sepia') {
    return `
      html, body {
        color: #433422 !important;
        background-color: #faf5ea !important;
      }
      a, a:link, a:visited {
        color: #8b5cf6 !important;
      }
      p, div, span, h1, h2, h3, h4, h5, h6, li, blockquote, dd, dt {
        color: inherit !important;
      }
    `;
  }
  return `
    html, body {
      color: #1f2937 !important;
      background-color: #ffffff !important;
    }
    a, a:link, a:visited {
      color: #2563eb !important;
    }
    p, div, span, h1, h2, h3, h4, h5, h6, li, blockquote, dd, dt {
      color: inherit !important;
    }
  `;
}

export type RelocateListener = (location: EngineLocation) => void;
export type LoadListener = (payload: { doc: Document; index: number }) => void;

export interface FoliateEngineHandle {
  /**
   * Load the book without attaching it to the DOM: resolves once
   * `view.open(file)` finished, so spineCount / toc / titles are valid.
   * Called by `openIn` and by `openBook` before registering content.
   */
  prepare(): Promise<void>;
  /** Prepare (if needed), attach the view to `container` and render. */
  openIn(container: HTMLElement): Promise<void>;
  /** Jump to a CFI; falls back to the start of the book when unresolvable. */
  goToCfi(cfi: string): Promise<void>;
  /** Page turn within/across chapters (foliate `next`/`prev`). */
  next(): Promise<void>;
  prev(): Promise<void>;
  /** Navigate to a TOC href (chapter navigation) or a spine index. */
  goTo(target: string | number): Promise<void>;
  goToFraction(fraction: number): Promise<void>;
  onRelocate(callback: RelocateListener): () => void;
  onLoad(callback: LoadListener): () => void;
  /** Plain text of a section (cached after it has been loaded once). */
  getSpineText(index: number): Promise<string>;
  /** Cached sanitized chapter HTML ('' when the section was never loaded). */
  getCachedSpineHtml(index: number): string;
  /** Cached plain text ('' when the section was never loaded). */
  getCachedSpineText(index: number): string;
  getSpineTitle(index: number): string;
  readonly spineCount: number;
  tocItems(): TocItem[];
  /** The book's own directory, resolved onto the physical spine. */
  tocEntries(): BookTocEntry[];
  /** Directory anchors located inside a spine section (empty when unknown). */
  getSpineAnchors(index: number): NodeAnchor[];
  currentLocation(): EngineLocation | null;
  getCover?(): Promise<string | undefined>;
  close(): void;
  setTheme?(theme: ReaderTheme): void;
  setPageMode?(mode: PageMode): void;
  /** Apply page mode + column width + margins in one shot (see ReaderLayoutParams). */
  setLayout?(params: ReaderLayoutParams): void;
  /** Inject extra reader CSS (typography) — merged with the theme styles. */
  setTypography?(css: string): void;
  getTocIndex?(location: EngineLocation): number;
  nextChapter?(): Promise<void>;
  prevChapter?(): Promise<void>;
}

export interface FoliateEngineDeps {
  /**
   * Lazy loader for the vendored view module. The real one is only imported
   * in the browser (its top-level side effect registers `<foliate-view>`).
   * Tests inject a loader that resolves after defining a fake element.
   */
  loadViewModule?: () => Promise<FoliateViewModule>;
}

/** Structural subset the engine actually consumes from the vendor module. */
export interface FoliateViewModule {
  /* The registration side effect is the point; the exports are unused. */
  makeBook?: (file: File) => Promise<FoliateBook>;
}
const FALLBACK_SECTION_TITLE = (index: number): string => `第 ${index + 1} 节`;

/**
 * Depth-first flatten of the foliate TOC tree into label/href/depth rows.
 *
 * The hierarchy is NOT discarded here: `depth` carries the level each row came
 * from, so the reader can re-indent it. Both the EPUB3 nav document
 * (`<ol>` nesting) and the EPUB2 NCX (`navPoint` nesting) reach us as a real
 * tree — vendored foliate's `childGetter.$$` only walks direct children — and
 * books like 何为良好生活 ship 11 章 with 70 §节 nested under them. Flattening
 * without a depth made those 81 rows read as siblings.
 */
export function flattenToc(items: FoliateTocItem[] | null | undefined): TocItem[] {
  const out: TocItem[] = [];
  const walk = (list: FoliateTocItem[], depth: number): void => {
    for (const item of list) {
      if (!item) continue;
      if (item.label && item.href) out.push({ label: item.label, href: item.href, depth });
      if (item.subitems?.length) walk(item.subitems, depth + 1);
    }
  };
  walk(items ?? [], 0);
  return out;
}

/**
 * `href` hash part (the intra-section anchor) without its leading `#`.
 * Returns `undefined` for a plain file href (`ch1.xhtml`) so a TOC entry
 * without an anchor never claims one.
 */
export function tocAnchorOf(href: string): string | undefined {
  const hash = href.split('#')[1];
  return hash ? hash : undefined;
}

/**
 * Project the flattened TOC onto the physical spine, keeping document order.
 *
 * `tocIndexMap` only holds the entries whose href resolved, so an entry that
 * did not resolve reports `spineIndex: -1` instead of silently vanishing —
 * the node builder needs to see that the directory declared it. The raw
 * `href` (anchor included) travels along so the engine can navigate straight
 * to the 节 without re-deriving it from label + anchor.
 */
export function tocEntriesOf(
  flatToc: TocItem[],
  tocIndexMap: Map<number, number>,
): BookTocEntry[] {
  return flatToc.map((item, tocIndex) => ({
    label: item.label,
    depth: item.depth,
    spineIndex: tocIndexMap.get(tocIndex) ?? -1,
    anchor: tocAnchorOf(item.href),
    href: item.href,
  }));
}

/**
 * Resolve a destination (href string or spine index) against the book, with
 * multi-tier fallback for broken/relative TOC hrefs or intra-chapter anchors.
 */
export function resolveTargetDestination(
  book: FoliateBook | null,
  target: string | number,
): { index: number; anchor?: (doc: Document) => any } | null {
  if (typeof target === 'number') {
    if (target >= 0 && (!book?.sections || target < book.sections.length)) {
      return { index: target };
    }
    return null;
  }
  if (!target || !book) return null;

  try {
    const native = book.resolveHref?.(target);
    if (native && typeof native.index === 'number' && native.index >= 0) {
      return native;
    }
  } catch {
    /* ignore */
  }

  const sections = book.sections ?? [];
  const [rawPath, hash] = target.split('#');
  const path = rawPath ? decodeURI(rawPath).replace(/\\/g, '/').replace(/^\.?\//, '') : '';
  const hashAnchor = hash
    ? (doc: Document) => {
        try {
          return (
            doc.getElementById(hash) ??
            doc.querySelector(`[name="${CSS.escape(hash)}"]`) ??
            doc.querySelector(`[id="${CSS.escape(hash)}"]`) ??
            0
          );
        } catch {
          return 0;
        }
      }
    : () => 0;

  if (path) {
    const filename = path.split('/').pop()?.toLowerCase();
    const index = sections.findIndex((section) => {
      const sId = (section.id || '').replace(/\\/g, '/').replace(/^\.?\//, '');
      const sHref = (section.href || '').replace(/\\/g, '/').replace(/^\.?\//, '');
      if (sId === path || sHref === path) return true;
      if (decodeURI(sId) === path || decodeURI(sHref) === path) return true;
      if (sId.endsWith('/' + path) || path.endsWith('/' + sId)) return true;
      if (sHref.endsWith('/' + path) || path.endsWith('/' + sHref)) return true;
      if (filename) {
        const sFilename = (sId || sHref).split('/').pop()?.toLowerCase();
        if (sFilename && sFilename === filename) return true;
      }
      return false;
    });

    if (index >= 0) {
      return { index, anchor: hashAnchor };
    }
  }

  return null;
}

/**
 * Split a producer-generated spine fragment name into its base and part:
 * `text/part0006_split_003.html` → `{ base: 'part0006', part: 3 }`, and
 * `null` for an ordinary file name (`part0005.html`, `ch1.xhtml`).
 *
 * Calibre/Sigil-style EPUBs cut one chapter into `<base>_split_NNN` files of a
 * size cap, but the TOC only ever links `_split_000`. This is the raw material
 * for `inheritSplitFragmentTitles`.
 */
export function splitFragmentOf(href: string): { base: string; part: number } | null {
  const file = (href.split('/').pop() ?? '').toLowerCase();
  const match = /^(.*)_split_(\d+)\.[a-z0-9]+$/.exec(file);
  if (!match) return null;
  return { base: match[1]!, part: Number(match[2]) };
}

/**
 * Carry a chapter title onto the untitled continuation fragments of that same
 * chapter, so the reader header and the whole-book index do not degrade to
 * 「第 N 节」 for them.
 *
 * 《思考快与慢》 is the motivating case: 182 spine sections, but the NCX only
 * anchors the 48 `_split_000` heads, leaving 134 continuations titleless.
 * Inheritance is deliberately narrow — a fragment inherits only from the
 * nearest preceding titled section that shares its `_split_` base, so a gap in
 * an ordinary spine (`何为良好生活`: 11 real sections) is never papered over.
 */
export function inheritSplitFragmentTitles(
  book: FoliateBook | null,
  labelByIndex: Map<number, string>,
  hrefByIndex: Map<number, string>,
): void {
  const sections = book?.sections ?? [];
  for (let index = 0; index < sections.length; index += 1) {
    if (labelByIndex.has(index)) continue;
    const section = sections[index];
    const frag = splitFragmentOf(section?.href || section?.id || '');
    // `_split_000` IS the chapter head; only continuations inherit.
    if (!frag || frag.part === 0) continue;

    for (let prev = index - 1; prev >= 0; prev -= 1) {
      const label = labelByIndex.get(prev);
      if (!label) continue;
      const prevSection = sections[prev];
      const prevFrag = splitFragmentOf(prevSection?.href || prevSection?.id || '');
      if (prevFrag && prevFrag.base === frag.base) {
        labelByIndex.set(index, label);
        const prevHref = hrefByIndex.get(prev);
        if (prevHref) hrefByIndex.set(index, prevHref);
      }
      break;
    }
  }
}

/**
 * Build spine index → TOC label (and href) maps, plus TOC index → spine index map.
 */
function buildTocIndexes(
  book: FoliateBook | null,
  flatToc: TocItem[],
): {
  labelByIndex: Map<number, string>;
  hrefByIndex: Map<number, string>;
  tocIndexMap: Map<number, number>;
} {
  const labelByIndex = new Map<number, string>();
  const hrefByIndex = new Map<number, string>();
  const tocIndexMap = new Map<number, number>();

  flatToc.forEach(({ label, href }, tocIdx) => {
    const resolved = resolveTargetDestination(book, href);
    if (!resolved || resolved.index < 0) return;
    const { index } = resolved;
    tocIndexMap.set(tocIdx, index);
    if (!labelByIndex.has(index)) labelByIndex.set(index, label);
    if (!hrefByIndex.has(index)) hrefByIndex.set(index, href);
  });

  inheritSplitFragmentTitles(book, labelByIndex, hrefByIndex);

  return { labelByIndex, hrefByIndex, tocIndexMap };
}

/** Normalize a foliate lastLocation into the reader-facing EngineLocation. */
function toEngineLocation(last: FoliateLocation | null | undefined): EngineLocation | null {
  if (!last) return null;
  const index =
    typeof last.index === 'number' ? last.index : (last.section?.current ?? 0);
  const label = typeof last.tocItem?.label === 'string' ? last.tocItem.label : undefined;
  const href = typeof last.tocItem?.href === 'string' ? last.tocItem.href : undefined;
  return {
    index,
    fraction: typeof last.fraction === 'number' ? last.fraction : 0,
    cfi: typeof last.cfi === 'string' ? last.cfi : undefined,
    tocItemLabel: label && label.trim() ? label : undefined,
    tocItemHref: href && href.trim() ? href : undefined,
  };
}

/**
 * Create the engine for one book file. Nothing browser-specific happens
 * before `prepare()`/`openIn()` (both await the lazily injected view module),
 * so constructing the handle stays safe in any environment.
 */
export function createFoliateEngine(file: File, deps: FoliateEngineDeps = {}): FoliateEngineHandle {
  const loadViewModule: () => Promise<FoliateViewModule> =
    deps.loadViewModule ??
    (async () =>
      (await import('../../../vendor/foliate-js/view.js')) as unknown as FoliateViewModule);

  const relocateListeners = new Set<RelocateListener>();
  const loadListeners = new Set<LoadListener>();
  const htmlCache = new Map<number, string>();
  const textCache = new Map<number, string>();
  /** Directory anchors located inside a section, aligned with `textCache`. */
  const spineAnchors = new Map<number, NodeAnchor[]>();
  /** In-flight section loads: 'load' and 'relocate' both warm the same index. */
  const pendingSections = new Map<number, Promise<void>>();

  let view: FoliateViewElement | null = null;
  let book: FoliateBook | null = null;
  let flatToc: TocItem[] = [];
  let labelByIndex = new Map<number, string>();
  let hrefByIndex = new Map<number, string>();
  let tocIndexMap = new Map<number, number>();
  let location: EngineLocation | null = null;
  let opened = false;
  let closed = false;
  let rendered = false;
  let currentTheme: ReaderTheme = 'light';
  /** Reader typography CSS (font size/family, line height, spacing). */
  let typographyCss = '';
  let layout: Required<ReaderLayoutParams> = { ...DEFAULT_READER_LAYOUT };
  /** In-flight first render (openIn): shared by concurrent callers. */
  let initPromise: Promise<void> | null = null;

  /** Theme + typography must share one stylesheet (paginator setStyles replaces it).
   *  App web fonts (LXGW WenKai) are prepended as absolute-url @font-face
   *  rules so chapter iframes can load them too (services/reader/webfonts). */
  const applyCurrentStyles = (): void => {
    const parts = [
      engineWebfontCss(),
      getReaderThemeStyles(currentTheme),
      typographyCss,
    ].filter(Boolean);
    const css = parts.join('\n');
    const anyView = view as unknown as {
      setStyles?: (styles: string) => void;
      renderer?: { setStyles?: (styles: string) => void };
    };
    anyView?.setStyles?.(css);
    anyView?.renderer?.setStyles?.(css);
  };

  /** Backwards-compatible alias: theme only re-application. */
  const applyCurrentTheme = applyCurrentStyles;

  const applyCurrentLayout = (): void => {
    const single = layout.pageMode === 'single';
    const anyView = view as unknown as {
      setMaxColumnCount?: (count: number) => void;
      setFlow?: (flow: string) => void;
      setMaxInlineSize?: (px: number | string) => void;
      setGap?: (v: number | string) => void;
      setMargin?: (v: number | string) => void;
      renderer?: {
        setAttribute?: (name: string, val: string) => void;
        removeAttribute?: (name: string) => void;
        render?: () => void;
      };
    };
    const columnCount = single ? 1 : 2;
    const flow = single ? 'scrolled' : 'paginated';
    const width = Math.round(layout.contentWidth);
    const margin = Math.round(layout.pageMargin);
    const gap = Math.round(layout.columnGap);
    anyView?.setMaxColumnCount?.(columnCount);
    anyView?.setFlow?.(flow);
    anyView?.setMaxInlineSize?.(width);
    anyView?.setMargin?.(margin);
    anyView?.setGap?.(gap);
    // Direct renderer fallback when the vendored View lacks the setters.
    const r = anyView?.renderer;
    r?.setAttribute?.('max-column-count', String(columnCount));
    r?.setAttribute?.('flow', flow);
    r?.setAttribute?.('max-inline-size', String(width));
    r?.setAttribute?.('margin', String(margin));
    r?.setAttribute?.('gap', String(gap));
    r?.render?.();
  };

  const emitRelocate = (next: EngineLocation): void => {
    for (const callback of relocateListeners) callback(next);
  };

  /**
   * The book's own directory projected onto the spine. Safe before
   * `prepare()` finished: an empty flatToc yields an empty list.
   */
  const tocEntries = (): BookTocEntry[] => tocEntriesOf(flatToc, tocIndexMap);

  /** Anchor ids of the directory entries that resolve to spine `index`. */
  const anchorIdsForSpine = (index: number): string[] => {
    const ids: string[] = [];
    flatToc.forEach((item, tocIndex) => {
      if (tocIndexMap.get(tocIndex) !== index) return;
      const anchor = tocAnchorOf(item.href);
      if (anchor) ids.push(anchor);
    });
    return ids;
  };

  const cacheSection = (index: number): Promise<void> => {
    if (closed || index < 0) return Promise.resolve();
    if (htmlCache.has(index)) return Promise.resolve();
    const inFlight = pendingSections.get(index);
    if (inFlight) return inFlight;

    const section = book?.sections?.[index];
    if (!section) return Promise.resolve();

    const load = (async () => {
      let doc: Document | null = null;
      try {
        if (typeof section.createDocument === 'function') doc = await section.createDocument();
        else {
          const loaded = await section.load?.();
          doc = loaded instanceof Document ? loaded : null;
        }
      } catch {
        return; // a broken section must not break rendering/navigation
      } finally {
        pendingSections.delete(index);
      }
      if (!doc?.body) return;
      // TEXT + ANCHORS come out of ONE extraction over the PRISTINE body:
      // the sanitizer strips `id`, so an anchored heading (`<h2 id=…>`) would
      // lose the very attribute the offsets are found by. The display HTML
      // stays sanitized.
      const raw = doc.body.innerHTML;
      htmlCache.set(index, sanitizeSectionHtml(raw));
      const extracted = extractAnchoredNodeText(raw, anchorIdsForSpine(index));
      textCache.set(index, extracted.text);
      spineAnchors.set(index, resolveSpineAnchors(extracted.anchorOffsets));
    })();
    pendingSections.set(index, load);
    return load;
  };

  const handleRelocate = (detail: unknown): void => {
    const next = toEngineLocation(
      (view?.lastLocation ?? (detail as FoliateLocation | undefined)) || null,
    );
    if (!next) return;
    location = next;
    // A relocated tocItem is the most accurate chapter title for that index.
    if (next.tocItemLabel) labelByIndex.set(next.index, next.tocItemLabel);
    if (next.tocItemHref) hrefByIndex.set(next.index, next.tocItemHref);
    void cacheSection(next.index);
    emitRelocate(next);
  };

  const handleLoad = (detail: unknown): void => {
    const payload = detail as { doc?: Document; index?: number } | undefined;
    if (!payload || typeof payload.index !== 'number' || !payload.doc) return;
    applyCurrentTheme();
    // Warm the AI-source cache for the chapter that just got rendered.
    void cacheSection(payload.index);
    for (const callback of loadListeners) callback({ doc: payload.doc, index: payload.index });
  };

  const prepare = async (): Promise<void> => {
    if (opened || closed) return;
    // Importing the module registers <foliate-view> (side effect).
    await loadViewModule();
    const element = document.createElement('foliate-view') as FoliateViewElement;
    element.addEventListener('relocate', (event: Event) =>
      handleRelocate((event as CustomEvent).detail),
    );
    element.addEventListener('load', (event: Event) => handleLoad((event as CustomEvent).detail));
    view = element;
    await element.open(file);
    book = element.book ?? null;
    flatToc = flattenToc(book?.toc);
    const indexes = buildTocIndexes(book, flatToc);
    labelByIndex = indexes.labelByIndex;
    hrefByIndex = indexes.hrefByIndex;
    tocIndexMap = indexes.tocIndexMap;
    opened = true;
  };

  const goToTarget = async (target: string | number) => {
    if (!view || closed) return;
    let ok = false;
    try {
      const res = await view.goTo(target);
      if (res && (typeof res !== 'object' || (res as any).index >= 0)) {
        ok = true;
      }
    } catch {
      ok = false;
    }
    if (ok) return;

    const resolved = resolveTargetDestination(book, target);
    if (resolved && resolved.index >= 0) {
      try {
        const renderer = (view as unknown as { renderer?: { goTo: (dest: unknown) => Promise<unknown> } })?.renderer;
        if (renderer?.goTo) {
          await renderer.goTo(resolved);
          (view as unknown as { history?: { pushState: (t: unknown) => void } })?.history?.pushState?.(target);
        }
      } catch {
        /* fallback */
      }
    }
  };

  const getTocIndex = (loc: EngineLocation): number => {
    if (flatToc.length === 0) return -1;
    if (loc.tocItemHref) {
      const found = flatToc.findIndex((item) => item.href === loc.tocItemHref);
      if (found >= 0) return found;
    }
    // Match by spine section index: find the first TOC entry matching loc.index
    const firstMatch = flatToc.findIndex((_, idx) => tocIndexMap.get(idx) === loc.index);
    if (firstMatch >= 0) return firstMatch;

    // Fallback: latest TOC entry whose section <= loc.index
    let best = -1;
    for (let i = 0; i < flatToc.length; i++) {
      const sIndex = tocIndexMap.get(i);
      if (sIndex !== undefined && sIndex <= loc.index) {
        best = i;
      }
    }
    if (best >= 0) return best;
    return 0;
  };

  const nextChapter = async () => {
    if (!view || closed) return;
    const currentLoc = location;
    const currSec = currentLoc ? currentLoc.index : 0;
    const currHref = currentLoc?.tocItemHref;

    // 1. Try to advance via TOC items
    if (flatToc.length > 0) {
      const currTocIdx = currentLoc ? getTocIndex(currentLoc) : -1;
      for (let i = Math.max(0, currTocIdx + 1); i < flatToc.length; i++) {
        const item = flatToc[i]!;
        const sIndex = tocIndexMap.get(i);
        if (
          (sIndex !== undefined && sIndex > currSec) ||
          (item.href !== currHref && (!currHref || !item.href.startsWith(currHref.split('#')[0]!)))
        ) {
          await goToTarget(item.href);
          return;
        }
      }
    }

    // 2. Otherwise advance spine section
    const totalSec = book?.sections?.length ?? 0;
    if (currSec < totalSec - 1) {
      const nextSec = currSec + 1;
      const tocItem = flatToc.find((_, idx) => tocIndexMap.get(idx) === nextSec);
      if (tocItem) {
        await goToTarget(tocItem.href);
      } else {
        await goToTarget(nextSec);
      }
    }
  };

  const prevChapter = async () => {
    if (!view || closed) return;
    const currentLoc = location;
    const currSec = currentLoc ? currentLoc.index : 0;
    const currHref = currentLoc?.tocItemHref;

    // 1. Try to retreat via TOC items
    if (flatToc.length > 0) {
      const currTocIdx = currentLoc ? getTocIndex(currentLoc) : flatToc.length;
      for (let i = Math.min(flatToc.length - 1, currTocIdx - 1); i >= 0; i--) {
        const item = flatToc[i]!;
        const sIndex = tocIndexMap.get(i);
        if (
          (sIndex !== undefined && sIndex < currSec) ||
          (item.href !== currHref && (!currHref || !item.href.startsWith(currHref.split('#')[0]!)))
        ) {
          await goToTarget(item.href);
          return;
        }
      }
    }

    // 2. Otherwise retreat spine section
    if (currSec > 0) {
      const prevSec = currSec - 1;
      const tocItem = flatToc.find((_, idx) => tocIndexMap.get(idx) === prevSec);
      if (tocItem) {
        await goToTarget(tocItem.href);
      } else {
        await goToTarget(prevSec);
      }
    }
  };

  return {
    get spineCount(): number {
      return book?.sections?.length ?? 0;
    },

    prepare,

    openIn: async (container: HTMLElement) => {
      await prepare();
      if (closed || !view) return;
      const element = view;
      if (element.parentElement !== container) container.append(element);
      applyCurrentLayout();
      applyCurrentStyles();
      if (!rendered) {
        initPromise ??= element
          .init({})
          .then(() => {
            rendered = true;
            applyCurrentLayout();
            applyCurrentStyles();
          })
          .catch((err: unknown) => {
            initPromise = null;
            throw err;
          });
      }
      if (initPromise) await initPromise;
      applyCurrentLayout();
      applyCurrentStyles();
    },

    goToCfi: async (cfi: string) => {
      if (!view || closed) return;
      let resolved = false;
      try {
        resolved = (await view.goTo(cfi)) != null;
      } catch {
        resolved = false;
      }
      if (!resolved) {
        try {
          await view.goToFraction(0);
        } catch {
          /* already at the start; nothing to recover */
        }
      }
    },

    next: async () => {
      await view?.next();
    },
    prev: async () => {
      await view?.prev();
    },

    goTo: goToTarget,
    nextChapter,
    prevChapter,

    setTheme: (theme: ReaderTheme) => {
      currentTheme = theme;
      applyCurrentStyles();
    },

    setPageMode: (mode: PageMode) => {
      layout = { ...layout, pageMode: mode };
      applyCurrentLayout();
    },

    setLayout: (params: ReaderLayoutParams) => {
      layout = { ...layout, ...params };
      applyCurrentLayout();
    },

    setTypography: (css: string) => {
      typographyCss = css;
      applyCurrentStyles();
    },

    getTocIndex,

    goToFraction: async (fraction: number) => {
      if (!view || closed) return;
      try {
        await view.goToFraction(fraction);
      } catch {
        /* ignore */
      }
    },

    onRelocate: (callback) => {
      relocateListeners.add(callback);
      return () => relocateListeners.delete(callback);
    },

    onLoad: (callback) => {
      loadListeners.add(callback);
      return () => loadListeners.delete(callback);
    },

    getSpineText: async (index: number) => {
      await cacheSection(index);
      return textCache.get(index) ?? '';
    },

    getCachedSpineHtml: (index) => htmlCache.get(index) ?? '',

    getCachedSpineText: (index) => textCache.get(index) ?? '',

    getSpineTitle: (index: number) => labelByIndex.get(index) ?? FALLBACK_SECTION_TITLE(index),

    tocItems: () => flatToc.map((item) => ({ ...item })),

    tocEntries,

    getSpineAnchors: (index: number) => [...(spineAnchors.get(index) ?? [])],

    currentLocation: () => (closed ? null : location),

    getCover: async (): Promise<string | undefined> => {
      if (!book) return undefined;
      try {
        if (typeof (book as any).getCover === 'function') {
          const res = await (book as any).getCover();
          if (res instanceof Blob) {
            const buffer = await res.arrayBuffer();
            const uint8 = new Uint8Array(buffer);
            return `data:${res.type || 'image/jpeg'};base64,${toBase64(uint8)}`;
          }
        }
      } catch {
        /* ignore */
      }
      return undefined;
    },

    close: () => {
      if (closed) return;
      closed = true;
      relocateListeners.clear();
      loadListeners.clear();
      try {
        view?.close();
      } catch {
        /* the element may never have been opened */
      }
      try {
        book?.destroy?.();
      } catch {
        /* best-effort blob URL release */
      }
      view?.remove();
      view = null;
      book = null;
      location = null;
    },
  };
}

/**
 * Adapt an (opened) engine into the OpenedBookContent shape consumed by the
 * AI features (nodeSource resolves through the registry).
 *
 * `getSpineHtml` is synchronous while section loading is async, so it
 * returns whatever the engine has cached — the current chapter is always
 * cached (the engine warms it on every `load`/`relocate`); a chapter the
 * user never visited yields '' and the summary guard shows its hint.
 */
export function engineToContent(engine: FoliateEngineHandle, hash: string): OpenedBookContent {
  return {
    bookHash: hash,
    spineCount: engine.spineCount,
    getSpineTitle: (index) => engine.getSpineTitle(index),
    getSpineHtml: (index) => engine.getCachedSpineHtml(index),
    getSpineText: (index) => engine.getCachedSpineText(index),
    // Loads the section through the engine (prepare→createDocument) even
    // when the reader has never visited it — the import pipeline needs the
    // full spine text up front for segmentation and offsets.
    getSpineTextAsync: (index) => engine.getSpineText(index),
    // The directory + its intra-section anchors, for the node importer.
    getTocEntries: () => engine.tocEntries(),
    getSpineAnchors: (index) => engine.getSpineAnchors(index),
    // Engine books are never monolithic; segmentation stays TXT-only.
  };
}

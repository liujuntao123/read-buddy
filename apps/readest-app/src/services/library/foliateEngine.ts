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
import { extractChapterText } from '@/services/reader/extractor';
import { sanitizeSectionHtml } from './sanitize';
import type { OpenedBookContent } from './contentRegistry';

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

export interface FoliateBook {
  sections?: FoliateSection[];
  toc?: FoliateTocItem[];
  metadata?: { title?: string; author?: string };
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

export type RelocateListener = (location: EngineLocation) => void;
export type LoadListener = (payload: { doc: Document; index: number }) => void;

export interface FoliateEngineHandle {
  /**
   * Load the book without attaching it to the DOM: resolves once
   * `view.open(file)` finished, so sectionCount / toc / titles are valid.
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
  getSectionText(index: number): Promise<string>;
  /** Cached sanitized chapter HTML ('' when the section was never loaded). */
  getCachedSectionHtml(index: number): string;
  /** Cached plain text ('' when the section was never loaded). */
  getCachedSectionText(index: number): string;
  getSectionTitle(index: number): string;
  readonly sectionCount: number;
  tocItems(): { label: string; href: string }[];
  currentLocation(): EngineLocation | null;
  close(): void;
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

/** Depth-first flatten of the foliate TOC tree into label/href pairs. */
export function flattenToc(items: FoliateTocItem[] | null | undefined): { label: string; href: string }[] {
  const out: { label: string; href: string }[] = [];
  const walk = (list: FoliateTocItem[]): void => {
    for (const item of list) {
      if (!item) continue;
      if (item.label && item.href) out.push({ label: item.label, href: item.href });
      if (item.subitems?.length) walk(item.subitems);
    }
  };
  walk(items ?? []);
  return out;
}

/**
 * Build spine index → TOC label (and href) maps. Prefers the book's own
 * `resolveHref` (used by foliate itself), then falls back to matching the
 * href path against `section.id`. First TOC entry wins for a shared spine.
 */
function buildTocIndexes(
  book: FoliateBook | null,
  flatToc: { label: string; href: string }[],
): { labelByIndex: Map<number, string>; hrefByIndex: Map<number, string> } {
  const labelByIndex = new Map<number, string>();
  const hrefByIndex = new Map<number, string>();
  const sections = book?.sections ?? [];
  for (const { label, href } of flatToc) {
    let index: number | undefined;
    try {
      const resolved = book?.resolveHref?.(href);
      if (resolved && typeof resolved.index === 'number') index = resolved.index;
    } catch {
      // MOBI resolveHref throws on non-filepos hrefs; ignore and fall through.
    }
    if (index === undefined) {
      const path = href.split('#')[0]!;
      const found = sections.findIndex((section) => section.id === path || section.href === path);
      if (found >= 0) index = found;
    }
    if (index === undefined || index < 0) continue;
    if (!labelByIndex.has(index)) labelByIndex.set(index, label);
    if (!hrefByIndex.has(index)) hrefByIndex.set(index, href);
  }
  return { labelByIndex, hrefByIndex };
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
  /** In-flight section loads: 'load' and 'relocate' both warm the same index. */
  const pendingSections = new Map<number, Promise<void>>();

  let view: FoliateViewElement | null = null;
  let book: FoliateBook | null = null;
  let flatToc: { label: string; href: string }[] = [];
  let labelByIndex = new Map<number, string>();
  let hrefByIndex = new Map<number, string>();
  let location: EngineLocation | null = null;
  let opened = false;
  let closed = false;
  let rendered = false;

  const emitRelocate = (next: EngineLocation): void => {
    for (const callback of relocateListeners) callback(next);
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
      const html = sanitizeSectionHtml(doc.body.innerHTML);
      htmlCache.set(index, html);
      textCache.set(index, extractChapterText(html).text);
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
    opened = true;
  };

  return {
    get sectionCount(): number {
      return book?.sections?.length ?? 0;
    },

    prepare,

    openIn: async (container: HTMLElement) => {
      await prepare();
      if (closed || !view) return;
      if (view.parentElement !== container) container.append(view);
      // init() renders the first section and emits the initial relocate. It
      // must run exactly once: re-attaching (shelf → reader round-trip) keeps
      // the current position; the CFI resume is handled by the pane.
      if (!rendered) {
        rendered = true;
        await view.init();
      }
    },

    goToCfi: async (cfi: string) => {
      if (!view || closed) return;
      let resolved = false;
      try {
        // foliate's goTo swallows navigation errors and returns undefined.
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

    goTo: async (target: string | number) => {
      if (!view || closed) return;
      try {
        await view.goTo(target);
      } catch {
        /* foliate logs internally; ignore unresolvable targets */
      }
    },

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

    getSectionText: async (index: number) => {
      await cacheSection(index);
      return textCache.get(index) ?? '';
    },

    getCachedSectionHtml: (index) => htmlCache.get(index) ?? '',

    getCachedSectionText: (index) => textCache.get(index) ?? '',

    getSectionTitle: (index: number) => labelByIndex.get(index) ?? FALLBACK_SECTION_TITLE(index),

    tocItems: () => flatToc.map(({ label, href }) => ({ label, href })),

    currentLocation: () => (closed ? null : location),

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
 * AI features (chapterSource resolves through the registry).
 *
 * `getSectionHtml` is synchronous while section loading is async, so it
 * returns whatever the engine has cached — the current chapter is always
 * cached (the engine warms it on every `load`/`relocate`); a chapter the
 * user never visited yields '' and the summary guard shows its hint.
 */
export function engineToContent(engine: FoliateEngineHandle, hash: string): OpenedBookContent {
  return {
    bookHash: hash,
    sectionCount: engine.sectionCount,
    getSectionTitle: (index) => engine.getSectionTitle(index),
    getSectionHtml: (index) => engine.getCachedSectionHtml(index),
    getSectionText: (index) => engine.getCachedSectionText(index),
    // Engine books are never monolithic; segmentation stays TXT-only.
  };
}

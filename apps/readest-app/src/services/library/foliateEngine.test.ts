import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearOpenedBook, getOpenedBook, registerOpenedBook } from './contentRegistry';
import {
  createFoliateEngine,
  engineToContent,
  flattenToc,
  getReaderThemeStyles,
  inheritSplitFragmentTitles,
  resolveTargetDestination,
  splitFragmentOf,
  type FoliateEngineHandle,
  type FoliateViewModule,
} from './foliateEngine';

/**
 * Fake view module strategy (ticket 07 DI seam): the tests never import the
 * vendored `view.js`. Instead they register a fake `<foliate-view>` custom
 * element implementing the protocol the engine consumes (open / init /
 * relocate / load / next / prev / goTo / goToFraction / close), and the
 * injected `loadViewModule` resolves an empty module — mirroring the real
 * module's define-side-effect.
 */

interface FakeSectionSpec {
  id: string;
  html: string;
}

interface FakeBookSpec {
  sections: FakeSectionSpec[];
  toc?: { label: string; href: string; subitems?: { label: string; href: string }[] }[];
}

const flatTocOf = (spec: FakeBookSpec): { label: string; href: string }[] =>
  flattenToc((spec.toc ?? []).map((item) => ({ ...item, subitems: item.subitems ?? null })));

class FakeFoliateView extends HTMLElement {
  static spec: FakeBookSpec | null = null;
  static initCount = 0;
  static initArgs: unknown[] = [];
  static fractionCalls: number[] = [];

  book: unknown = null;
  lastLocation: unknown = null;
  viewClosed = false;
  bookDestroyed = false;
  stylesApplied = '';
  maxColumnCount = 2;
  /** All renderer attributes applied by the engine (layout settings). */
  attrs: Record<string, string> = {};
  renderer: unknown = {
    setStyles: (styles: string) => {
      this.stylesApplied = styles;
    },
    setAttribute: (name: string, value: string) => {
      this.attrs[name] = String(value);
      if (name === 'max-column-count') this.maxColumnCount = parseInt(value, 10);
    },
    render: vi.fn(),
    goTo: vi.fn(async (resolved: { index: number }) => {
      this.#emitLoad(resolved.index);
      this.#locate(resolved.index);
      return resolved;
    }),
  };
  /** Spies per spec section (engine caching relies on createDocument). */
  createDocumentCalls: Record<number, number> = {};

  async open(file: File): Promise<void> {
    void file;
    const spec = FakeFoliateView.spec!;
    this.book = {
      sections: spec.sections.map((section, index) => ({
        id: section.id,
        createDocument: () => {
          this.createDocumentCalls[index] = (this.createDocumentCalls[index] ?? 0) + 1;
          return Promise.resolve(this.#docOf(index));
        },
      })),
      toc: spec.toc ?? [],
      resolveHref: (href: string) => {
        const path = href.split('#')[0]!;
        const index = spec.sections.findIndex((section) => section.id === path);
        return index >= 0 ? { index } : null;
      },
      destroy: () => {
        this.bookDestroyed = true;
      },
    };
  }

  /**
   * Mirrors the vendored view.js contract: `init({ lastLocation,
   * showTextStart })` destructures its options argument, so a bare `init()`
   * call throws (regression guard for the 打开书籍失败 open failure).
   */
  async init(options: { lastLocation?: unknown; showTextStart?: boolean }): Promise<void> {
    // Destructure like the vendor: a bare init() throws here.
    const { lastLocation, showTextStart } = options;
    void lastLocation;
    void showTextStart;
    FakeFoliateView.initCount++;
    FakeFoliateView.initArgs.push(options);
    this.#emitLoad(0);
    this.#locate(0);
  }

  async next(): Promise<void> {
    this.#locate(this.#index()); // page turn stays inside the section
  }

  async prev(): Promise<void> {
    this.#locate(this.#index());
  }

  async goTo(target: string | number): Promise<{ index: number } | null> {
    if (typeof target === 'number') {
      this.#emitLoad(target);
      this.#locate(target);
      return { index: target };
    }
    const resolved = (this.book as { resolveHref?: (href: string) => { index: number } | null })
      .resolveHref?.(target);
    if (!resolved) return null;
    this.#emitLoad(resolved.index);
    this.#locate(resolved.index);
    return resolved;
  }

  async goToFraction(fraction: number): Promise<void> {
    FakeFoliateView.fractionCalls.push(fraction);
    this.#locate(0);
  }

  close(): void {
    this.viewClosed = true;
  }

  #docOf(index: number): Document {
    const doc = document.implementation.createHTMLDocument(`ch${index}`);
    doc.body.innerHTML = FakeFoliateView.spec!.sections[index]!.html;
    return doc;
  }

  #emitLoad(index: number): void {
    this.dispatchEvent(
      new CustomEvent('load', { detail: { doc: this.#docOf(index), index } }),
    );
  }

  #locate(index: number): void {
    const spec = FakeFoliateView.spec!;
    const tocItem =
      flatTocOf(spec).find((item) => (this.book as { resolveHref: (h: string) => { index: number } | null }).resolveHref(item.href)?.index === index) ??
      null;
    this.lastLocation = {
      fraction: (index + 1) / spec.sections.length,
      section: { current: index, total: spec.sections.length },
      tocItem,
      cfi: `epubcfi(/6/${(index + 1) * 4}!/2/2)`,
    };
    this.dispatchEvent(new CustomEvent('relocate', { detail: this.lastLocation }));
  }

  #index(): number {
    return (this.lastLocation as { section?: { current?: number } } | null)?.section?.current ?? 0;
  }
}

if (!customElements.get('foliate-view')) {
  customElements.define('foliate-view', FakeFoliateView);
}

const loadViewModule = (): Promise<FoliateViewModule> => Promise.resolve({});

const SPEC: FakeBookSpec = {
  sections: [
    { id: 'ch1.xhtml', html: '<h2>第一章 迷雾之城</h2><p>灯火在雾中摇曳。</p>' },
    { id: 'ch2.xhtml', html: '<h2>第二章 图书馆的密语</h2><p>星图亮了起来。</p>' },
    { id: 'ch3.xhtml', html: '<h2>第三章 长夜漫漫</h2><p>长夜第一节。</p>' },
  ],
  toc: [
    { label: '第一章 迷雾之城', href: 'ch1.xhtml' },
    { label: '第二章 图书馆的密语', href: 'ch2.xhtml' },
    {
      label: '卷二',
      href: 'ch2.xhtml',
      subitems: [{ label: '第三章 长夜漫漫', href: 'ch3.xhtml' }],
    },
  ],
};

const makeEngine = (): FoliateEngineHandle =>
  createFoliateEngine(new File([new Uint8Array([1])], '迷雾之城.epub'), { loadViewModule });

beforeEach(() => {
  FakeFoliateView.spec = SPEC;
  FakeFoliateView.initCount = 0;
  FakeFoliateView.initArgs = [];
  FakeFoliateView.fractionCalls = [];
});

describe('createFoliateEngine', () => {
  it('prepare exposes the spine and flattened toc without touching the DOM', async () => {
    const engine = makeEngine();
    expect(engine.spineCount).toBe(0); // nothing loaded yet

    await engine.prepare();

    expect(engine.spineCount).toBe(3);
    // Flattening keeps document order and stamps the level each row came
    // from, so 「第三章」 stays recognisable as a 节 under 「卷二」.
    expect(engine.tocEntries().map(({ label, href, depth }) => ({ label, href, depth }))).toEqual([
      { label: '第一章 迷雾之城', href: 'ch1.xhtml', depth: 0 },
      { label: '第二章 图书馆的密语', href: 'ch2.xhtml', depth: 0 },
      { label: '卷二', href: 'ch2.xhtml', depth: 0 },
      { label: '第三章 长夜漫漫', href: 'ch3.xhtml', depth: 1 },
    ]);
    expect(engine.getSpineTitle(0)).toBe('第一章 迷雾之城');
    expect(engine.getSpineTitle(2)).toBe('第三章 长夜漫漫');
  });

  it('falls back to 第 N 节 for sections without a toc entry', async () => {
    FakeFoliateView.spec = { sections: SPEC.sections }; // no toc
    const engine = makeEngine();
    await engine.prepare();
    expect(engine.getSpineTitle(1)).toBe('第 2 节');
    expect(engine.tocEntries().map(({ label, href, depth }) => ({ label, href, depth }))).toEqual([]);
  });

  it('openIn attaches the view, renders and reports the first location', async () => {
    const engine = makeEngine();
    const container = document.createElement('div');

    await engine.openIn(container);

    expect(container.childElementCount).toBe(1);
    expect(container.firstElementChild!.tagName.toLowerCase()).toBe('foliate-view');
    expect(FakeFoliateView.initCount).toBe(1);

    const location = engine.currentLocation();
    expect(location).not.toBeNull();
    expect(location!.index).toBe(0);
    expect(location!.fraction).toBeCloseTo(1 / 3);
    expect(location!.cfi).toBe('epubcfi(/6/4!/2/2)');
    expect(location!.tocItemLabel).toBe('第一章 迷雾之城');
  });

  it('passes an options object to init — vendor init() destructures its argument', async () => {
    // Regression (打开书籍失败，请重试): the adapter used to call the bare
    // `view.init()`, which the vendored view.js destructures — TypeError on
    // every first open. The fake above mirrors that contract.
    const engine = makeEngine();

    await engine.openIn(document.createElement('div'));

    expect(FakeFoliateView.initArgs).toHaveLength(1);
    expect(FakeFoliateView.initArgs[0]).toBeInstanceOf(Object);
  });

  it('a failed init stays retryable (rendered flips only on success)', async () => {
    const engine = makeEngine();
    const first = document.createElement('div');
    const originalInit = FakeFoliateView.prototype.init;
    // First openIn: make init reject once.
    FakeFoliateView.prototype.init = function (this: FakeFoliateView) {
      FakeFoliateView.prototype.init = originalInit;
      return Promise.reject(new Error('boom'));
    } as typeof FakeFoliateView.prototype.init;
    await expect(engine.openIn(first)).rejects.toThrow('boom');

    // Second openIn: init runs again and succeeds.
    await engine.openIn(document.createElement('div'));
    expect(FakeFoliateView.initCount).toBeGreaterThanOrEqual(1);
    expect(engine.currentLocation()).not.toBeNull();
  });

  it('re-attaching moves the element without re-initializing (shelf round-trip)', async () => {
    const engine = makeEngine();
    const first = document.createElement('div');
    const second = document.createElement('div');

    await engine.openIn(first);
    await engine.goTo('ch2.xhtml'); // move away from the start
    const before = engine.currentLocation()!.index;

    await engine.openIn(second);

    expect(FakeFoliateView.initCount).toBe(1); // init ran exactly once
    expect(second.contains(first.firstElementChild!)).toBe(false);
    expect(second.childElementCount).toBe(1);
    expect(engine.currentLocation()!.index).toBe(before); // position kept
  });

  it('forwards relocate to subscribers and updates currentLocation', async () => {
    const engine = makeEngine();
    await engine.openIn(document.createElement('div'));

    const seen: number[] = [];
    const unsubscribe = engine.onRelocate((loc) => seen.push(loc.index));

    await engine.goTo('ch2.xhtml');

    expect(seen).toEqual([1]);
    expect(engine.currentLocation()!.index).toBe(1);
    expect(engine.currentLocation()!.tocItemLabel).toBe('第二章 图书馆的密语');

    unsubscribe();
    await engine.goTo('ch3.xhtml');
    expect(seen).toEqual([1]); // no more events after unsubscribe
  });

  it('forwards load events with the chapter document', async () => {
    const engine = makeEngine();
    const loads: { doc: Document; index: number }[] = [];
    engine.onLoad((payload) => loads.push(payload));

    await engine.openIn(document.createElement('div'));

    expect(loads).toHaveLength(1);
    expect(loads[0]!.index).toBe(0);
    expect(loads[0]!.doc.querySelector('h2')?.textContent).toBe('第一章 迷雾之城');
  });

  it('getSpineText loads each section once and caches the result', async () => {
    const engine = makeEngine();
    const container = document.createElement('div');
    await engine.openIn(container); // renders + caches section 0
    const view = container.firstElementChild as FakeFoliateView;
    expect(view.createDocumentCalls[0]).toBe(1);

    const text0 = await engine.getSpineText(0);
    expect(text0).toContain('灯火在雾中摇曳。');
    expect(view.createDocumentCalls[0]).toBe(1); // cached, not re-loaded

    const text2 = await engine.getSpineText(2);
    expect(text2).toContain('长夜第一节。');
    expect(view.createDocumentCalls[2]).toBe(1);
  });

  it('caches sanitized html for loaded chapters only', async () => {
    FakeFoliateView.spec = {
      sections: [
        { id: 'a.xhtml', html: '<h2>一</h2><p>正文<script>evil()</script></p>' },
        { id: 'b.xhtml', html: '<h2>二</h2><p>未访问</p>' },
      ],
      toc: [{ label: '一', href: 'a.xhtml' }],
    };
    const engine = makeEngine();
    await engine.openIn(document.createElement('div'));

    expect(engine.getCachedSpineHtml(0)).toContain('正文');
    expect(engine.getCachedSpineHtml(0)).not.toContain('script');
    expect(engine.getCachedSpineText(0)).toContain('正文');
    // never-visited chapter: nothing cached yet
    expect(engine.getCachedSpineHtml(1)).toBe('');
    expect(engine.getCachedSpineText(1)).toBe('');
  });

  it('goToCfi falls back to fraction 0 when the CFI cannot resolve', async () => {
    const engine = makeEngine();
    await engine.openIn(document.createElement('div'));
    await engine.goTo('ch2.xhtml');

    await engine.goToCfi('not-a-cfi');

    expect(FakeFoliateView.fractionCalls).toEqual([0]);
  });

  it('applyPresentation forwards theme styles to the renderer', async () => {
    const engine = makeEngine();
    const container = document.createElement('div');
    await engine.openIn(container);
    const view = container.firstElementChild as FakeFoliateView;

    engine.applyPresentation({ theme: 'dark' });
    expect(view.stylesApplied).toContain('background-color: #1d1d20');
    expect(view.stylesApplied).toContain('color: #cbd5e1');

    engine.applyPresentation({ theme: 'sepia' });
    expect(view.stylesApplied).toContain('background-color: #faf5ea');

    engine.applyPresentation({ theme: 'light' });
    expect(view.stylesApplied).toContain('background-color: #ffffff');
  });

  it('applyPresentation maps page mode onto column count and flow', async () => {
    const engine = makeEngine();
    const container = document.createElement('div');
    await engine.openIn(container);
    const view = container.firstElementChild as FakeFoliateView;

    engine.applyPresentation({ theme: 'light', layout: { pageMode: 'single', contentWidth: 720, pageMargin: 48, columnGap: 24 } });
    expect(view.maxColumnCount).toBe(1);
    // Single page = single-column infinite scroll (paginator flow=scrolled).
    expect(view.attrs['flow']).toBe('scrolled');

    engine.applyPresentation({ theme: 'light', layout: { pageMode: 'double', contentWidth: 720, pageMargin: 48, columnGap: 24 } });
    expect(view.maxColumnCount).toBe(2);
    expect(view.attrs['flow']).toBe('paginated');
  });

  it('reports which route carried each presentation knob instead of failing silently', async () => {
    // The vendored view exposes layout through `renderer.setAttribute` but NOT
    // through the element setters (this is the fake's real shape, and how a Foliate
    // build can differ). Before `presentationDiagnostics`, that difference was
    // invisible: the `?.`-probed setter simply did nothing and nothing said so.
    const engine = makeEngine();
    const container = document.createElement('div');
    await engine.openIn(container);

    engine.applyPresentation({ theme: 'light', layout: { pageMode: 'single', contentWidth: 900, pageMargin: 72, columnGap: 10 } });
    const report = engine.presentationDiagnostics();

    expect(report.viaRendererFallback).toEqual(
      expect.arrayContaining(['max-column-count', 'flow', 'max-inline-size', 'margin', 'gap']),
    );
    // Everything reached the view one way or another, so nothing is stale.
    expect(report.unsupported).toEqual([]);

    // Styles go through `renderer.setStyles` on this view.
    engine.applyPresentation({ theme: 'dark' });
    expect(engine.presentationDiagnostics().viaRendererFallback).toContain('styles');
  });

  it('names a knob that reached neither route as unsupported', async () => {
    // A build whose renderer lacks `setAttribute` and whose element lacks the
    // setters: the reader keeps the old layout, and now that fact is reportable.
    const engine = makeEngine();
    const container = document.createElement('div');
    await engine.openIn(container);
    const view = container.firstElementChild as FakeFoliateView;
    const renderer = view.renderer as { setAttribute?: unknown };
    const saved = renderer.setAttribute;
    delete renderer.setAttribute;

    engine.applyPresentation({ theme: 'light', layout: { pageMode: 'double', contentWidth: 700, pageMargin: 60, columnGap: 24 } });

    expect(engine.presentationDiagnostics().unsupported).toEqual(
      expect.arrayContaining(['max-inline-size']),
    );
    renderer.setAttribute = saved;

    // Restoring the route clears the report rather than accumulating.
    engine.applyPresentation({ theme: 'light', layout: { pageMode: 'double', contentWidth: 700, pageMargin: 60, columnGap: 24 } });
    expect(engine.presentationDiagnostics().unsupported).toEqual([]);
  });

  it('applyPresentation maps typography-adjacent knobs onto renderer attributes', async () => {
    const engine = makeEngine();
    const container = document.createElement('div');
    await engine.openIn(container);
    const view = container.firstElementChild as FakeFoliateView;

    engine.applyPresentation({
      theme: 'light',
      layout: { pageMode: 'single', contentWidth: 900, pageMargin: 72, columnGap: 10 },
    });
    expect(view.attrs['max-column-count']).toBe('1');
    expect(view.attrs['flow']).toBe('scrolled');
    expect(view.attrs['max-inline-size']).toBe('900');
    expect(view.attrs['margin']).toBe('72');
    expect(view.attrs['gap']).toBe('10');

    engine.applyPresentation({ theme: 'light', layout: { pageMode: 'double', contentWidth: 900, pageMargin: 72, columnGap: 10 } });
    expect(view.attrs['max-column-count']).toBe('2');
    expect(view.attrs['flow']).toBe('paginated');
    // Other knobs persist across partial updates.
    expect(view.attrs['max-inline-size']).toBe('900');
  });

  it('applyPresentation merges reader css with the theme stylesheet', async () => {
    const engine = makeEngine();
    const container = document.createElement('div');
    await engine.openIn(container);
    const view = container.firstElementChild as FakeFoliateView;

    engine.applyPresentation({ theme: 'dark' });
    engine.applyPresentation({ theme: 'dark', typographyCss: 'html { font-size: 21px !important; }' });

    // One stylesheet carries both the theme and the reader typography —
    // the paginator's setStyles replaces the previous content wholesale.
    expect(view.stylesApplied).toContain('background-color: #1d1d20');
    expect(view.stylesApplied).toContain('font-size: 21px');

    engine.applyPresentation({ theme: 'light' });
    expect(view.stylesApplied).toContain('background-color: #ffffff');
    expect(view.stylesApplied).toContain('font-size: 21px');
  });

  // The "which TOC row is the reader on" ladder moved to
  // `services/reader/chapterNavigation` (候选 7) and is covered by its own suite;
  // the engine no longer publishes a second answer.

  it('close tears down the view, releases the book and drops listeners', async () => {
    const engine = makeEngine();
    const container = document.createElement('div');
    await engine.openIn(container);
    const view = container.firstElementChild as FakeFoliateView;

    const onRelocate = vi.fn();
    engine.onRelocate(onRelocate);

    engine.close();

    expect(view.viewClosed).toBe(true);
    expect(view.bookDestroyed).toBe(true);
    expect(container.childElementCount).toBe(0);
    expect(engine.currentLocation()).toBeNull();

    // Events from the detached element no longer reach anyone.
    view.dispatchEvent(new CustomEvent('relocate', { detail: { section: { current: 2 } } }));
    expect(onRelocate).not.toHaveBeenCalled();
  });
});

describe('directory entries and intra-section anchors', () => {
  /**
   * 《何为良好生活》 shape: the NCX declares 章 + nested §节, but the 节
   * destinations are anchors *inside* one spine file (`#sigil_toc_id_N` on the
   * `<h2>` heading). Building per-节 nodes requires the line offset of each of
   * those anchors inside the spine's own normalized text.
   */
  const SIGIL_SPEC: FakeBookSpec = {
    sections: [
      { id: 'text00001.html', html: '<h2>版权页</h2><p>版权所有。</p>' },
      {
        id: 'text00003.html',
        html: [
          '<p>导言：伦理学何为？</p>',
          '<h2 id="sigil_toc_id_1">第一章 伦理与伦理学</h2>',
          '<p>伦理学的起点。</p>',
          '<h2 id="sigil_toc_id_2">§1 伦理学这个名称</h2>',
          '<p>第一个小节的正文。</p>',
          '<h2 id="sigil_toc_id_3">§2 伦理与道德</h2>',
          '<p>第二个小节的正文。</p>',
        ].join(''),
      },
    ],
    toc: [
      {
        label: '第一章 伦理与伦理学',
        href: 'text00003.html#sigil_toc_id_1',
        subitems: [
          { label: '§1 伦理学这个名称', href: 'text00003.html#sigil_toc_id_2' },
          { label: '§2 伦理与道德', href: 'text00003.html#sigil_toc_id_3' },
        ],
      },
    ],
  };

  const sigilEngine = async (): Promise<FoliateEngineHandle> => {
    FakeFoliateView.spec = SIGIL_SPEC;
    const engine = makeEngine();
    await engine.prepare();
    return engine;
  };

  it('resolves the directory onto the spine, keeping depth, anchor and href', async () => {
    const engine = await sigilEngine();

    expect(engine.tocEntries()).toEqual([
      {
        label: '第一章 伦理与伦理学',
        depth: 0,
        spineIndex: 1,
        anchor: 'sigil_toc_id_1',
        href: 'text00003.html#sigil_toc_id_1',
      },
      {
        label: '§1 伦理学这个名称',
        depth: 1,
        spineIndex: 1,
        anchor: 'sigil_toc_id_2',
        href: 'text00003.html#sigil_toc_id_2',
      },
      {
        label: '§2 伦理与道德',
        depth: 1,
        spineIndex: 1,
        anchor: 'sigil_toc_id_3',
        href: 'text00003.html#sigil_toc_id_3',
      },
    ]);
  });

  it('reports -1 for an entry whose href cannot resolve and no anchor without a hash', async () => {
    FakeFoliateView.spec = {
      sections: [{ id: 'a.xhtml', html: '<h2>一</h2><p>正文。</p>' }],
      toc: [
        { label: '一', href: 'a.xhtml' },
        { label: '二（缺文件）', href: 'missing.xhtml#sec2' },
      ],
    };
    const engine = makeEngine();
    await engine.prepare();

    expect(engine.tocEntries()).toEqual([
      { label: '一', depth: 0, spineIndex: 0, anchor: undefined, href: 'a.xhtml' },
      { label: '二（缺文件）', depth: 0, spineIndex: -1, anchor: 'sec2', href: 'missing.xhtml#sec2' },
    ]);
  });

  it('locates each directory anchor at a line start of the cached spine text', async () => {
    const engine = await sigilEngine();
    // Nothing cached yet: unknown, and asking must not crash.
    expect(engine.getSpineAnchors(1)).toEqual([]);

    const text = await engine.getSpineText(1);
    const entries = engine.tocEntries();
    const anchors = engine.getSpineAnchors(1);

    expect(anchors.map((anchor) => anchor.id)).toEqual([
      'sigil_toc_id_1',
      'sigil_toc_id_2',
      'sigil_toc_id_3',
    ]);
    const offsets = anchors.map((anchor) => anchor.offset);
    expect(offsets.every((offset) => offset > 0)).toBe(true);
    expect([...offsets].sort((a, b) => a - b)).toEqual(offsets); // ascending

    // The reported offset really is the heading's line start: slicing there
    // yields the very line the directory named.
    anchors.forEach((anchor, i) => {
      expect(text.slice(anchor.offset).split('\n')[0]).toBe(entries[i]!.label);
    });
    // 节 entries all live inside the one spine file, in order.
    expect(text.slice(offsets[1]!)).toContain('第二个小节的正文。');
  });

  it('keeps the anchors even though the sanitized html drops the id', async () => {
    const engine = await sigilEngine();
    await engine.getSpineText(1);

    // The sanitizer whitelists href/title/alt/src only — `id` is gone, which
    // is exactly why the offsets are computed from the pristine markup.
    const safeHtml = engine.getCachedSpineHtml(1);
    expect(safeHtml).toContain('§1 伦理学这个名称');
    expect(safeHtml).not.toContain('sigil_toc_id_2');
    expect(engine.getSpineAnchors(1).map((anchor) => anchor.id)).toContain('sigil_toc_id_2');
  });

  it('hands out a copy of the anchor list', async () => {
    const engine = await sigilEngine();
    await engine.getSpineText(1);

    engine.getSpineAnchors(1).push({ id: 'injected', offset: 999 });

    expect(engine.getSpineAnchors(1).map((anchor) => anchor.id)).not.toContain('injected');
  });

  it('is safe before prepare(): no directory, no anchors, no throw', () => {
    const engine = makeEngine();

    expect(engine.tocEntries()).toEqual([]);
    expect(engine.getSpineAnchors(0)).toEqual([]);
  });
});

describe('engineToContent', () => {
  it('adapts a prepared engine into the opened-book registry shape', async () => {
    const engine = makeEngine();
    await engine.prepare();
    await engine.openIn(document.createElement('div'));

    const hash = 'engine-hash-1';
    const content = engineToContent(engine, hash);
    registerOpenedBook(content);

    expect(getOpenedBook(hash)).toBe(content);
    expect(content.spineCount).toBe(3);
    expect(content.getSpineTitle(1)).toBe('第二章 图书馆的密语');
    // current chapter (rendered) is cached and extractable for the AI features
    expect(content.getSpineHtml(0)).toContain('灯火在雾中摇曳');
    expect(await content.getSpineText(0)).toContain('灯火在雾中摇曳');
    // the directory + its anchors travel through the registry adapter too
    expect(content.getTocEntries().map((entry) => [entry.label, entry.depth])).toEqual([
      ['第一章 迷雾之城', 0],
      ['第二章 图书馆的密语', 0],
      ['卷二', 0],
      ['第三章 长夜漫漫', 1],
    ]);
    expect(content.getSpineAnchors(0)).toEqual([]);
    // An engine book states its kind and reports no monolithic text. This used
    // to be tested as method *absence* — the type-tag probing 候选 8 removed.
    expect(content.kind).toBe('engine');
    expect(content.getMonolithicText()).toBeUndefined();

    clearOpenedBook(hash);
  });
});

describe('resolveTargetDestination and getReaderThemeStyles', () => {
  it('generates css rules for all 3 themes, matching the app theme surfaces', () => {
    // Book page backgrounds must equal the app UI surfaces so 护眼/夜间
    // mode shows one continuous tone (readest dark / readest-sepia tokens).
    expect(getReaderThemeStyles('dark')).toContain('background-color: #1d1d20');
    expect(getReaderThemeStyles('sepia')).toContain('background-color: #faf5ea');
    expect(getReaderThemeStyles('light')).toContain('background-color: #ffffff');
  });

  it('resolves direct numeric index, relative hrefs, and anchors', () => {
    const fakeBook = {
      sections: [
        { id: 'OEBPS/Text/intro.xhtml', href: 'OEBPS/Text/intro.xhtml' },
        { id: 'OEBPS/Text/chapter1.xhtml', href: 'OEBPS/Text/chapter1.xhtml' },
        { id: 'OEBPS/Text/chapter2.xhtml', href: 'OEBPS/Text/chapter2.xhtml' },
      ],
      resolveHref: (href: string) => {
        // Native resolver only matches exact id
        const idx = fakeBook.sections.findIndex((s) => s.id === href);
        return idx >= 0 ? { index: idx } : null;
      },
    };

    // Direct number
    expect(resolveTargetDestination(fakeBook, 1)).toEqual({ index: 1 });

    // Exact id matches native
    expect(resolveTargetDestination(fakeBook, 'OEBPS/Text/chapter1.xhtml')).toEqual({ index: 1 });

    // Relative/unprefixed path with anchor falls back and succeeds
    const resolved = resolveTargetDestination(fakeBook, 'Text/chapter1.xhtml#sec1');
    expect(resolved?.index).toBe(1);
    expect(typeof resolved?.anchor).toBe('function');

    // Filename-only href
    expect(resolveTargetDestination(fakeBook, 'chapter2.xhtml')?.index).toBe(2);

    // Unresolvable href returns null
    expect(resolveTargetDestination(fakeBook, 'unknown.xhtml')).toBeNull();
  });
});

describe('flattenToc depth', () => {
  it('stamps the nesting level of every row in document order', () => {
    // 《何为良好生活》 shape: 章 rows carrying §节 children.
    const toc = [
      { label: '第一章 伦理与伦理学', href: 'text00003.html#sigil_toc_id_1', subitems: [
        { label: '§1 伦理学这个名称', href: 'text00003.html#sigil_toc_id_2' },
        { label: '§2 伦理与道德', href: 'text00003.html#sigil_toc_id_3' },
      ] },
      { label: '第二章 功效主义与自私的基因', href: 'text00004.html#sigil_toc_id_9', subitems: [
        { label: '§1 功效主义简介', href: 'text00004.html#sigil_toc_id_10' },
      ] },
    ];

    expect(flattenToc(toc)).toEqual([
      { label: '第一章 伦理与伦理学', href: 'text00003.html#sigil_toc_id_1', depth: 0 },
      { label: '§1 伦理学这个名称', href: 'text00003.html#sigil_toc_id_2', depth: 1 },
      { label: '§2 伦理与道德', href: 'text00003.html#sigil_toc_id_3', depth: 1 },
      { label: '第二章 功效主义与自私的基因', href: 'text00004.html#sigil_toc_id_9', depth: 0 },
      { label: '§1 功效主义简介', href: 'text00004.html#sigil_toc_id_10', depth: 1 },
    ]);
  });

  it('counts levels beyond two and keeps a flat toc at depth 0', () => {
    const threeDeep = [
      { label: '卷一', href: 'a.xhtml', subitems: [
        { label: '第一章', href: 'b.xhtml', subitems: [{ label: '第一节', href: 'c.xhtml' }] },
      ] },
    ];
    expect(flattenToc(threeDeep).map((item) => item.depth)).toEqual([0, 1, 2]);

    expect(flattenToc([{ label: '序言', href: 'x.xhtml' }])).toEqual([
      { label: '序言', href: 'x.xhtml', depth: 0 },
    ]);
    expect(flattenToc(null)).toEqual([]);
  });

  it('skips label-less rows without losing the depth of the ones kept', () => {
    const toc = [
      { label: '', href: 'skip.xhtml' },
      { label: '第一章', href: 'a.xhtml', subitems: [{ label: '第一节', href: 'b.xhtml' }] },
    ];
    expect(flattenToc(toc)).toEqual([
      { label: '第一章', href: 'a.xhtml', depth: 0 },
      { label: '第一节', href: 'b.xhtml', depth: 1 },
    ]);
  });
});

describe('split fragment titles', () => {
  it('parses producer split names and rejects ordinary ones', () => {
    expect(splitFragmentOf('text/part0006_split_003.html')).toEqual({ base: 'part0006', part: 3 });
    expect(splitFragmentOf('PART0006_SPLIT_000.HTML')).toEqual({ base: 'part0006', part: 0 });
    expect(splitFragmentOf('text/part0005.html')).toBeNull();
    expect(splitFragmentOf('ch1.xhtml')).toBeNull();
    expect(splitFragmentOf('')).toBeNull();
  });

  it('carries a chapter title onto its untitled _split_ continuations', () => {
    // 《思考快与慢》 shape: the NCX anchors only the 48 `_split_000` heads.
    const book = {
      sections: [
        { id: 'text/part0004_split_000.html', href: 'text/part0004_split_000.html' },
        { id: 'text/part0004_split_001.html', href: 'text/part0004_split_001.html' },
        { id: 'text/part0004_split_002.html', href: 'text/part0004_split_002.html' },
        { id: 'text/part0005.html', href: 'text/part0005.html' },
        { id: 'text/part0006_split_000.html', href: 'text/part0006_split_000.html' },
      ],
    };
    const labelByIndex = new Map<number, string>([
      [0, '序言'],
      [3, '第一部分 系统1，系统2'],
      [4, '第1章 一张愤怒的脸和一道乘法题'],
    ]);
    const hrefByIndex = new Map<number, string>([
      [0, 'text/part0004_split_000.html'],
      [4, 'text/part0006_split_000.html'],
    ]);

    inheritSplitFragmentTitles(book, labelByIndex, hrefByIndex);

    expect(labelByIndex.get(1)).toBe('序言');
    expect(labelByIndex.get(2)).toBe('序言');
    expect(labelByIndex.get(4)).toBe('第1章 一张愤怒的脸和一道乘法题');
    // The _000 head keeps the title it already had.
    expect(labelByIndex.get(0)).toBe('序言');
    expect(hrefByIndex.get(2)).toBe('text/part0004_split_000.html');
  });

  it('never invents a title for a plain untitled spine section', () => {
    // 《何为良好生活》 shape: 11 real sections, one of them without a TOC entry.
    const book = {
      sections: [
        { id: 'OEBPS/text00001.html', href: 'OEBPS/text00001.html' },
        { id: 'OEBPS/text00002.html', href: 'OEBPS/text00002.html' },
        { id: 'OEBPS/text00003.html', href: 'OEBPS/text00003.html' },
      ],
    };
    const labelByIndex = new Map<number, string>([[0, '版权页'], [2, '第一章 伦理与伦理学']]);

    inheritSplitFragmentTitles(book, labelByIndex, new Map());

    expect(labelByIndex.has(1)).toBe(false);
  });

  it('does not cross over into a different base file', () => {
    const book = {
      sections: [
        { id: 'text/a_split_000.html', href: 'text/a_split_000.html' },
        { id: 'text/b_split_001.html', href: 'text/b_split_001.html' },
      ],
    };
    const labelByIndex = new Map<number, string>([[0, '第一章']]);

    inheritSplitFragmentTitles(book, labelByIndex, new Map());

    expect(labelByIndex.has(1)).toBe(false);
  });
});

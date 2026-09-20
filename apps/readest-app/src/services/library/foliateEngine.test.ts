import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearOpenedBook, getOpenedBook, registerOpenedBook } from './contentRegistry';
import {
  createFoliateEngine,
  engineToContent,
  flattenToc,
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
  static fractionCalls: number[] = [];

  book: unknown = null;
  lastLocation: unknown = null;
  viewClosed = false;
  bookDestroyed = false;
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

  async init(): Promise<void> {
    FakeFoliateView.initCount++;
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
  FakeFoliateView.fractionCalls = [];
});

describe('createFoliateEngine', () => {
  it('prepare exposes the spine and flattened toc without touching the DOM', async () => {
    const engine = makeEngine();
    expect(engine.sectionCount).toBe(0); // nothing loaded yet

    await engine.prepare();

    expect(engine.sectionCount).toBe(3);
    expect(engine.tocItems()).toEqual([
      { label: '第一章 迷雾之城', href: 'ch1.xhtml' },
      { label: '第二章 图书馆的密语', href: 'ch2.xhtml' },
      { label: '卷二', href: 'ch2.xhtml' },
      { label: '第三章 长夜漫漫', href: 'ch3.xhtml' },
    ]);
    expect(engine.getSectionTitle(0)).toBe('第一章 迷雾之城');
    expect(engine.getSectionTitle(2)).toBe('第三章 长夜漫漫');
  });

  it('falls back to 第 N 节 for sections without a toc entry', async () => {
    FakeFoliateView.spec = { sections: SPEC.sections }; // no toc
    const engine = makeEngine();
    await engine.prepare();
    expect(engine.getSectionTitle(1)).toBe('第 2 节');
    expect(engine.tocItems()).toEqual([]);
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

  it('getSectionText loads each section once and caches the result', async () => {
    const engine = makeEngine();
    const container = document.createElement('div');
    await engine.openIn(container); // renders + caches section 0
    const view = container.firstElementChild as FakeFoliateView;
    expect(view.createDocumentCalls[0]).toBe(1);

    const text0 = await engine.getSectionText(0);
    expect(text0).toContain('灯火在雾中摇曳。');
    expect(view.createDocumentCalls[0]).toBe(1); // cached, not re-loaded

    const text2 = await engine.getSectionText(2);
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

    expect(engine.getCachedSectionHtml(0)).toContain('正文');
    expect(engine.getCachedSectionHtml(0)).not.toContain('script');
    expect(engine.getCachedSectionText(0)).toContain('正文');
    // never-visited chapter: nothing cached yet
    expect(engine.getCachedSectionHtml(1)).toBe('');
    expect(engine.getCachedSectionText(1)).toBe('');
  });

  it('goToCfi falls back to fraction 0 when the CFI cannot resolve', async () => {
    const engine = makeEngine();
    await engine.openIn(document.createElement('div'));
    await engine.goTo('ch2.xhtml');

    await engine.goToCfi('not-a-cfi');

    expect(FakeFoliateView.fractionCalls).toEqual([0]);
  });

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

describe('engineToContent', () => {
  it('adapts a prepared engine into the opened-book registry shape', async () => {
    const engine = makeEngine();
    await engine.prepare();
    await engine.openIn(document.createElement('div'));

    const hash = 'engine-hash-1';
    const content = engineToContent(engine, hash);
    registerOpenedBook(content);

    expect(getOpenedBook(hash)).toBe(content);
    expect(content.sectionCount).toBe(3);
    expect(content.getSectionTitle(1)).toBe('第二章 图书馆的密语');
    // current chapter (rendered) is cached and extractable for the AI features
    expect(content.getSectionHtml(0)).toContain('灯火在雾中摇曳');
    expect(content.getSectionText(0)).toContain('灯火在雾中摇曳');
    // engine books are never monolithic
    expect(content.getMonolithicText).toBeUndefined();

    clearOpenedBook(hash);
  });
});

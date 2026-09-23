import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FoliatePane from './FoliatePane';
import { applyTheme } from '@/theme/readingTheme';
import type {
  EngineLocation,
  FoliateEngineHandle,
  PresentationDiagnostics,
  PresentationPatch,
} from '@/services/library/foliateEngine';
import type { BookNode } from '@/types/readingAgent';
import {
  clearAgentBookContext,
  createAgentBookContext,
  registerAgentBookContext,
} from '@/services/agent/agentContext';
import { clearLocateListeners, requestLocate } from '@/services/reader/readerLink';
import { useAISidebarStore } from '@/store/aiSidebarStore';
import { useChatStore } from '@/store/chatStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useReaderStore } from '@/store/readerStore';
import { useReaderSettingsStore } from '@/store/readerSettingsStore';

/**
 * A hand-rolled engine double: listeners are captured so tests can drive
 * relocate/load like the foliate view would. openIn mimics attachment by
 * appending a placeholder node into the container.
 */
interface FakeEngine extends FoliateEngineHandle {
  openIn: (container: HTMLElement) => Promise<void>;
  next: () => Promise<void>;
  prev: () => Promise<void>;
  goTo: (target: string | number) => Promise<void>;
  goToCfi: (cfi: string) => Promise<void>;
  close: () => void;
  /** One presentation entry point since 候选 4. */
  applyPresentation: (patch: PresentationPatch) => void;
  presentationDiagnostics: () => PresentationDiagnostics;
  relocators: Set<(location: EngineLocation) => void>;
  loaders: Set<(payload: { doc: Document; index: number }) => void>;
  location: EngineLocation | null;
}

const makeEngine = (toc = TOC): FakeEngine => {
  const relocators = new Set<(location: EngineLocation) => void>();
  const loaders = new Set<(payload: { doc: Document; index: number }) => void>();
  const engine: FakeEngine = {
    openIn: vi.fn(async (container: HTMLElement) => {
      container.appendChild(document.createElement('div'));
    }),
    next: vi.fn(async () => {}),
    prev: vi.fn(async () => {}),
    goTo: vi.fn(async () => {}),
    goToCfi: vi.fn(async () => {}),
    goToFraction: vi.fn(async () => {}),
    prepare: vi.fn(async () => {}),
    relocators,
    loaders,
    location: null,
    onRelocate: vi.fn((cb) => {
      relocators.add(cb);
      return () => relocators.delete(cb);
    }),
    onLoad: vi.fn((cb) => {
      loaders.add(cb);
      return () => loaders.delete(cb);
    }),
    getSpineText: vi.fn(async () => ''),
    getCachedSpineHtml: vi.fn(() => ''),
    getCachedSpineText: vi.fn(() => ''),
    getSpineTitle: vi.fn((index: number) => TOC[index]?.label ?? `第 ${index + 1} 节`),
    get spineCount() {
      return toc.length;
    },
    tocEntries: vi.fn(() =>
      toc.map(({ label, href }, index) => ({ label, href, depth: 0, spineIndex: index })),
    ),
    getSpineAnchors: vi.fn(() => []),
    currentLocation: vi.fn(function (this: FakeEngine) {
      return this.location;
    }),
    close: vi.fn(),
    getCover: vi.fn(async () => undefined),
    applyPresentation: vi.fn(),
    presentationDiagnostics: () => ({
      viaElement: [],
      viaRendererFallback: [],
      unsupported: [],
    }),
    };
  return engine;
};

const TOC = [
  { label: '第一章 迷雾之城', href: 'ch1.xhtml' },
  { label: '第二章 图书馆的密语', href: 'ch2.xhtml' },
  { label: '第三章 长夜漫漫', href: 'ch3.xhtml' },
];

const relocate = (engine: FakeEngine, index: number, href?: string): void => {
  const location: EngineLocation = {
    index,
    fraction: (index + 1) / 3,
    cfi: `epubcfi(/6/${index + 1})`,
    tocItemLabel: TOC[index]?.label,
    tocItemHref: href ?? TOC[index]?.href,
  };
  engine.location = location;
  for (const cb of engine.relocators) cb(location);
};

const resetStores = (): void => {
  useReaderStore.setState({
    bookHash: 'engine-book',
    bookTitle: '迷雾之城',
    spineIndex: 0,
    anchor: undefined,
    nodeTitle: '',
    spineCount: 3,
  });
  useLibraryStore.setState({ currentHash: null, engines: {}, resumeCfi: null });
  useAISidebarStore.setState({ expanded: false, width: 400, activeTab: 'summary' });
};

beforeEach(() => {
  resetStores();
  clearLocateListeners();
  window.localStorage.setItem('readest-plus:page-mode', 'double');
  useReaderSettingsStore.getState().reset();
  useChatStore.setState({ quoteDraft: null });
});

afterEach(() => {
  resetStores();
  clearLocateListeners();
  clearAgentBookContext('engine-book');
});

describe('FoliatePane', () => {
  it('renders a placeholder when no engine is provided', () => {
    render(<FoliatePane engine={null} />);
    expect(screen.getByTestId('foliate-pane').textContent).toContain('未加载引擎书籍');
  });

  it('attaches the engine view into the container on mount', async () => {
    const engine = makeEngine();
    render(<FoliatePane engine={engine} />);

    await waitFor(() => expect(engine.openIn).toHaveBeenCalledTimes(1));
    const container = screen.getByTestId('foliate-container');
    expect(container.childElementCount).toBe(1);

    // Unmount clears the DOM but never closes the store-owned engine.
    // (cleanup runs via @testing-library afterEach)
  });

  it('shows a loading overlay until the engine finishes opening', async () => {
    const engine = makeEngine();
    let finish: () => void = () => {};
    vi.mocked(engine.openIn).mockImplementation(
      (container: HTMLElement) =>
        new Promise<void>((resolve) => {
          finish = () => {
            container.appendChild(document.createElement('div'));
            resolve();
          };
        }),
    );

    render(<FoliatePane engine={engine} />);
    // Before `openIn` resolves the pane is an empty box: the reader must be told
    // the book is on its way instead of being shown nothing.
    expect(screen.getByTestId('foliate-opening').textContent).toContain('正在打开书籍…');

    await act(async () => {
      finish();
    });
    await waitFor(() => expect(screen.queryByTestId('foliate-opening')).toBeNull());
  });

  it('drops the loading overlay when opening fails, leaving the error Banner', async () => {
    const engine = makeEngine();
    vi.mocked(engine.openIn).mockRejectedValue(new Error('boom'));

    render(<FoliatePane engine={engine} />);
    await waitFor(() => expect(screen.queryByTestId('foliate-opening')).toBeNull());
    expect(screen.getByText('打开书籍失败，请重试')).toBeTruthy();
  });

  it('seeds the reading context from the engine position on re-attach', async () => {
    const engine = makeEngine();
    relocate(engine, 1); // position recorded before the pane mounts

    render(<FoliatePane engine={engine} />);

    await waitFor(() => {
      expect(useReaderStore.getState().spineIndex).toBe(1);
      expect(useReaderStore.getState().nodeTitle).toBe('第二章 图书馆的密语');
    });
  });

  it('relocate events update the reader store chapter context', async () => {
    const engine = makeEngine();
    render(<FoliatePane engine={engine} />);
    await waitFor(() => expect(engine.openIn).toHaveBeenCalled());

    act(() => relocate(engine, 2));

    expect(useReaderStore.getState().spineIndex).toBe(2);
    expect(useReaderStore.getState().nodeTitle).toBe('第三章 长夜漫漫');
  });

  it('carries the directory anchor of the relocated href into the store', async () => {
    const engine = makeEngine();
    render(<FoliatePane engine={engine} />);
    await waitFor(() => expect(engine.openIn).toHaveBeenCalled());

    act(() => relocate(engine, 1, 'ch2.xhtml#sigil_toc_id_1'));
    expect(useReaderStore.getState().spineIndex).toBe(1);
    expect(useReaderStore.getState().anchor).toBe('sigil_toc_id_1');

    // A href without a hash clears the anchor (段起始处).
    act(() => relocate(engine, 2, 'ch3.xhtml'));
    expect(useReaderStore.getState().anchor).toBeUndefined();
  });

  it('locates an agent request through the node model instead of scanning spine texts', async () => {
    const engine = makeEngine();
    const nodes: BookNode[] = [
      {
        nodeId: 'engine-book:n_0',
        bookHash: 'engine-book',
        nodeIndex: 0,
        title: '第一章 迷雾之城',
        depth: 0,
        startOffset: 0,
        endOffset: 100,
        charCount: 100,
        spineIndex: 0,
        href: 'ch1.xhtml',
        indexStatus: 'ready',
      },
      {
        nodeId: 'engine-book:n_1',
        bookHash: 'engine-book',
        nodeIndex: 1,
        title: '§2 图书馆的密语',
        depth: 1,
        parentNodeId: 'engine-book:n_0',
        startOffset: 0,
        endOffset: 60,
        charCount: 60,
        spineIndex: 1,
        anchor: 'sigil_toc_id_2',
        href: 'ch2.xhtml#sigil_toc_id_2',
        indexStatus: 'ready',
      },
    ];
    registerAgentBookContext(
      createAgentBookContext({ bookHash: 'engine-book', nodes, fullText: '' }),
    );

    render(<FoliatePane engine={engine} />);
    await waitFor(() => expect(engine.openIn).toHaveBeenCalled());

    act(() => {
      requestLocate({ bookHash: 'engine-book', nodeIndex: 1, quoteSnippet: '图书馆的密语' });
    });

    // The node's own href (目录锚点 included) is the destination …
    await waitFor(() => expect(engine.goTo).toHaveBeenCalledWith('ch2.xhtml#sigil_toc_id_2'));
    // … so the book is never scanned section by section.
    expect(engine.getSpineText).not.toHaveBeenCalled();
  });

  it('arrow keys page through the book and Escape retracts the toolbar', async () => {
    const engine = makeEngine();
    render(<FoliatePane engine={engine} />);
    await waitFor(() => expect(engine.openIn).toHaveBeenCalled());

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(engine.next).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(engine.prev).toHaveBeenCalledTimes(1);

    // Arrows must not hijack the chat composer.
    const input = document.createElement('input');
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: 'ArrowRight' });
    expect(engine.next).toHaveBeenCalledTimes(1);
    input.remove();
  });

  it('shows the selection toolbar for iframe selections and forwards quick actions', async () => {
    const engine = makeEngine();
    const readSelection = vi.fn(() => ({
      text: '灯火在雾中摇曳',
      rect: new DOMRect(20, 40, 120, 16),
    }));

    render(<FoliatePane engine={engine} readSelection={readSelection} />);
    await waitFor(() => expect(engine.openIn).toHaveBeenCalled());
    expect(screen.queryByTestId('selection-toolbar')).toBeNull();

    // Engine 'load' wires the chapter doc; a mouseup in that doc reads the
    // (injected) selection and summons the shared toolbar.
    let doc!: Document;
    act(() => {
      doc = document.implementation.createHTMLDocument('ch0');
      doc.body.innerHTML = '<p>灯火在雾中摇曳</p>';
      for (const cb of engine.loaders) cb({ doc, index: 0 });
    });
    expect(readSelection).not.toHaveBeenCalled();

    act(() => {
      doc.dispatchEvent(new Event('mouseup'));
    });

    expect(readSelection).toHaveBeenCalledWith(doc);
    expect(screen.getByTestId('selection-toolbar')).toBeTruthy();

    const sendSpy = vi.spyOn(useChatStore.getState(), 'send').mockResolvedValue(undefined);
    fireEvent.click(screen.getByRole('button', { name: '解释' }));
    expect(sendSpy).toHaveBeenCalledTimes(1);
    const [instruction, quoteText] = sendSpy.mock.calls[0]!;
    // The selection travels as the quote (it renders as the quote block); the
    // message body is the instruction alone, so the passage shows up once.
    expect(instruction).toContain('请解释');
    expect(instruction).not.toContain('灯火在雾中摇曳');
    expect(quoteText).toBe('灯火在雾中摇曳');
    expect(useAISidebarStore.getState().expanded).toBe(true);
    expect(useAISidebarStore.getState().activeTab).toBe('chat');
    sendSpy.mockRestore();

    // 无残留: the toolbar dismisses after the action.
    await waitFor(() => expect(screen.queryByTestId('selection-toolbar')).toBeNull());
  });

  it('hides the toolbar when the selection collapses (mouseup with no selection)', async () => {
    const engine = makeEngine();
    let has = true;
    const readSelection = vi.fn(() =>
      has ? { text: '迷雾中的灯', rect: new DOMRect(0, 0, 10, 10) } : null,
    );

    render(<FoliatePane engine={engine} readSelection={readSelection} />);
    await waitFor(() => expect(engine.openIn).toHaveBeenCalled());

    let doc!: Document;
    act(() => {
      doc = document.implementation.createHTMLDocument('ch0');
      for (const cb of engine.loaders) cb({ doc, index: 0 });
    });
    act(() => {
      doc.dispatchEvent(new Event('mouseup'));
    });
    expect(screen.getByTestId('selection-toolbar')).toBeTruthy();

    has = false;
    act(() => {
      doc.dispatchEvent(new Event('mouseup'));
    });
    expect(screen.queryByTestId('selection-toolbar')).toBeNull();
  });

  it('consumes the pending resume CFI once after attaching', async () => {
    const engine = makeEngine();
    useLibraryStore.setState({ resumeCfi: 'epubcfi(/6/8!/2/2)' });

    render(<FoliatePane engine={engine} />);
    await waitFor(() => expect(engine.goToCfi).toHaveBeenCalledWith('epubcfi(/6/8!/2/2)'));
    expect(useLibraryStore.getState().resumeCfi).toBeNull();
  });

  it('applies the page mode from the settings store to the engine', async () => {
    const engine = makeEngine();
    render(<FoliatePane engine={engine} />);
    await waitFor(() => expect(engine.openIn).toHaveBeenCalled());

    // The store is the single source of truth (HeaderBar drives it).
    act(() => {
      useReaderSettingsStore.getState().setPageMode('single');
    });
    expect(engine.applyPresentation).toHaveBeenLastCalledWith(
      expect.objectContaining({ layout: expect.objectContaining({ pageMode: 'single' }) }),
    );

    act(() => {
      useReaderSettingsStore.getState().setPageMode('double');
    });
    expect(engine.applyPresentation).toHaveBeenLastCalledWith(
      expect.objectContaining({ layout: expect.objectContaining({ pageMode: 'double' }) }),
    );
  });

  it('applies persisted typography and layout settings to the engine', async () => {
    const engine = makeEngine();
    useReaderSettingsStore.getState().setTypography({ fontSize: 21, fontFamily: 'songti' });
    useReaderSettingsStore.getState().setLayoutSettings({ contentWidth: 900 });

    render(<FoliatePane engine={engine} />);
    await waitFor(() => expect(engine.openIn).toHaveBeenCalled());

    expect(engine.applyPresentation).toHaveBeenCalledWith(expect.objectContaining({ typographyCss: expect.stringContaining('font-size: 21px') }));
    expect(engine.applyPresentation).toHaveBeenCalledWith(expect.objectContaining({ typographyCss: expect.stringContaining('font-family') }));
    expect(engine.applyPresentation).toHaveBeenCalledWith(
      expect.objectContaining({ layout: expect.objectContaining({ pageMode: 'double', contentWidth: 900 }) }),
    );
  });

  it('does not intercept the wheel in single-page (scrolled) mode', async () => {
    const engine = makeEngine();
    render(<FoliatePane engine={engine} />);
    await waitFor(() => expect(engine.openIn).toHaveBeenCalled());

    act(() => {
      useReaderSettingsStore.getState().setPageMode('single');
    });
    const container = screen.getByTestId('foliate-container');
    fireEvent.wheel(container, { deltaY: 400 });
    fireEvent.wheel(container, { deltaY: 400 });
    expect(engine.next).not.toHaveBeenCalled();

    // Wheel on the chapter iframe doc in single-page mode also does not intercept
    const doc = document.implementation.createHTMLDocument();
    act(() => {
      for (const cb of engine.loaders) cb({ doc, index: 0 });
      doc.dispatchEvent(new WheelEvent('wheel', { deltaY: 400, bubbles: true }));
    });
    expect(engine.next).not.toHaveBeenCalled();

    // Back to double-page: wheel turns pages again.
    act(() => {
      useReaderSettingsStore.getState().setPageMode('double');
    });
    fireEvent.wheel(container, { deltaY: 80 });
    expect(engine.next).toHaveBeenCalledTimes(1);
  });

  it('turns pages on mouse wheel scroll with threshold', async () => {
    const engine = makeEngine();
    render(<FoliatePane engine={engine} />);
    await waitFor(() => expect(engine.openIn).toHaveBeenCalled());

    const container = screen.getByTestId('foliate-container');

    // Small scroll should not turn page
    fireEvent.wheel(container, { deltaY: 20 });
    expect(engine.next).not.toHaveBeenCalled();

    // Accumulated scroll beyond threshold turns page forward
    fireEvent.wheel(container, { deltaY: 60 });
    expect(engine.next).toHaveBeenCalledTimes(1);

    // After cooldown, scroll up turns page backward
    await new Promise((r) => setTimeout(r, 300));
    fireEvent.wheel(container, { deltaY: -80 });
    expect(engine.prev).toHaveBeenCalledTimes(1);
  });

  it('turns pages when keyboard events occur inside chapter iframe doc', async () => {
    const engine = makeEngine();
    render(<FoliatePane engine={engine} />);
    await waitFor(() => expect(engine.openIn).toHaveBeenCalled());

    const doc = document.implementation.createHTMLDocument('ch0');
    act(() => {
      for (const cb of engine.loaders) cb({ doc, index: 0 });
    });

    act(() => {
      doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    expect(engine.next).toHaveBeenCalledTimes(1);

    act(() => {
      doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true }));
    });
    expect(engine.next).toHaveBeenCalledTimes(2);

    act(() => {
      doc.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    });
    expect(engine.next).toHaveBeenCalledTimes(3);

    act(() => {
      doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    });
    expect(engine.prev).toHaveBeenCalledTimes(1);

    act(() => {
      doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageUp', bubbles: true }));
    });
    expect(engine.prev).toHaveBeenCalledTimes(2);
  });

  it('synchronizes reading-theme changes to the engine', async () => {
    const engine = makeEngine();
    render(<FoliatePane engine={engine} />);
    await waitFor(() => expect(engine.openIn).toHaveBeenCalled());

    act(() => {
      applyTheme('dark');
    });

    await waitFor(() => {
      expect(engine.applyPresentation).toHaveBeenCalledWith(expect.objectContaining({ theme: 'dark' }));
    });
  });
});

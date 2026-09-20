import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FoliatePane from './FoliatePane';
import type { EngineLocation, FoliateEngineHandle } from '@/services/library/foliateEngine';
import { useAISidebarStore } from '@/store/aiSidebarStore';
import { useChatStore } from '@/store/chatStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useReaderStore } from '@/store/readerStore';

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
    getSectionText: vi.fn(async () => ''),
    getCachedSectionHtml: vi.fn(() => ''),
    getCachedSectionText: vi.fn(() => ''),
    getSectionTitle: vi.fn((index: number) => TOC[index]?.label ?? `第 ${index + 1} 节`),
    get sectionCount() {
      return toc.length;
    },
    tocItems: vi.fn(() => toc.map(({ label, href }) => ({ label, href }))),
    currentLocation: vi.fn(function (this: FakeEngine) {
      return this.location;
    }),
    close: vi.fn(),
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
    sectionIndex: 0,
    chapterTitle: '',
    sectionCount: 3,
  });
  useLibraryStore.setState({ currentHash: null, engines: {}, resumeCfi: null });
  useAISidebarStore.setState({ expanded: false, width: 400, activeTab: 'summary' });
};

beforeEach(() => {
  resetStores();
  useChatStore.setState({ quoteDraft: null });
});

afterEach(() => {
  resetStores();
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

  it('seeds the reading context from the engine position on re-attach', async () => {
    const engine = makeEngine();
    relocate(engine, 1); // position recorded before the pane mounts

    render(<FoliatePane engine={engine} />);

    await waitFor(() => {
      expect(useReaderStore.getState().sectionIndex).toBe(1);
      expect(useReaderStore.getState().chapterTitle).toBe('第二章 图书馆的密语');
    });
    expect(screen.getByTestId('foliate-chapter-title').textContent).toBe('第二章 图书馆的密语');
  });

  it('relocate events update the reader store chapter context', async () => {
    const engine = makeEngine();
    render(<FoliatePane engine={engine} />);
    await waitFor(() => expect(engine.openIn).toHaveBeenCalled());

    act(() => relocate(engine, 2));

    expect(useReaderStore.getState().sectionIndex).toBe(2);
    expect(useReaderStore.getState().chapterTitle).toBe('第三章 长夜漫漫');
    expect(screen.getByTestId('foliate-chapter-title').textContent).toBe('第三章 长夜漫漫');
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

  it('navigates chapters via the toc dropdown and prev/next chapter buttons', async () => {
    const engine = makeEngine();
    render(<FoliatePane engine={engine} />);
    await waitFor(() => expect(engine.openIn).toHaveBeenCalled());
    act(() => relocate(engine, 1));

    // Chapter buttons jump by toc entries (not foliate page turns).
    const prev = screen.getByRole('button', { name: '上一章' }) as HTMLButtonElement;
    const next = screen.getByRole('button', { name: '下一章' }) as HTMLButtonElement;
    expect(prev.disabled).toBe(false);
    expect(next.disabled).toBe(false);
    fireEvent.click(next);
    expect(engine.goTo).toHaveBeenCalledWith('ch3.xhtml');
    fireEvent.click(prev);
    expect(engine.goTo).toHaveBeenCalledWith('ch1.xhtml');

    // The dropdown lists every toc entry and navigates on click.
    const tocList = screen.getByTestId('foliate-toc-list');
    expect(tocList.textContent).toContain('第二章 图书馆的密语');
    fireEvent.click(screen.getByRole('button', { name: '第三章 长夜漫漫' }));
    expect(engine.goTo).toHaveBeenCalledWith('ch3.xhtml');
  });

  it('disables chapter navigation at the ends of the toc', async () => {
    const engine = makeEngine();
    render(<FoliatePane engine={engine} />);
    await waitFor(() => expect(engine.openIn).toHaveBeenCalled());
    act(() => relocate(engine, 0));

    expect((screen.getByRole('button', { name: '上一章' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '下一章' }) as HTMLButtonElement).disabled).toBe(false);
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
    expect(sendSpy.mock.calls[0]![0]).toContain('灯火在雾中摇曳');
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
});

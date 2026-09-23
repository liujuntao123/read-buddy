import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearAgentBookContext,
  createAgentBookContext,
  registerAgentBookContext,
} from '@/services/agent/agentContext';
import { useReaderStore } from '@/store/readerStore';
import {
  POSITION_SAVE_DEBOUNCE_MS,
  flushReadingPosition,
  loadPersistedPosition,
  recordReadingPosition,
  resetReadingPosition,
  setPositionPersister,
  type PersistedReadingPosition,
} from './readingPosition';

/**
 * The Reading Position owner's contract, exercised through the injected
 * persister seam alone — no database, no engine, no store beyond the reader
 * state it is responsible for writing.
 */
const saved: PersistedReadingPosition[] = [];
let stored: PersistedReadingPosition | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  saved.length = 0;
  stored = null;
  setPositionPersister({
    save: async (record) => {
      saved.push(record);
    },
    load: async () => stored,
  });
  useReaderStore.setState({
    bookHash: '',
    bookTitle: '',
    spineIndex: 0,
    anchor: undefined,
    nodeTitle: '',
    spineCount: 0,
  });
  clearAgentBookContext('b');
});

afterEach(() => {
  resetReadingPosition();
  vi.useRealTimers();
});

describe('recordReadingPosition', () => {
  it('writes the reading state immediately and the record only after the debounce', async () => {
    recordReadingPosition({ bookHash: 'b', spineIndex: 4 });

    // State is synchronous: node resolution reads it right away.
    expect(useReaderStore.getState().spineIndex).toBe(4);
    // The write is not.
    expect(saved).toEqual([]);

    await vi.advanceTimersByTimeAsync(POSITION_SAVE_DEBOUNCE_MS);
    expect(saved).toEqual([{ bookHash: 'b', spineIndex: 4, nodeIndex: 4 }]);
  });

  it('collapses a burst of page turns into a single write', async () => {
    for (const spineIndex of [1, 2, 3, 4, 5]) {
      recordReadingPosition({ bookHash: 'b', spineIndex });
      await vi.advanceTimersByTimeAsync(100);
    }
    await vi.advanceTimersByTimeAsync(POSITION_SAVE_DEBOUNCE_MS);

    expect(saved).toEqual([{ bookHash: 'b', spineIndex: 5, nodeIndex: 5 }]);
  });

  it('never loses the last page turn to the debounce when flushed', async () => {
    recordReadingPosition({ bookHash: 'b', spineIndex: 2 });
    await vi.advanceTimersByTimeAsync(100);
    recordReadingPosition({ bookHash: 'b', spineIndex: 3 });

    // Flush well inside the debounce window — the old pane-local throttle could
    // drop exactly this write.
    await flushReadingPosition();
    expect(saved).toEqual([{ bookHash: 'b', spineIndex: 3, nodeIndex: 3 }]);

    // The pending timer is gone, so nothing is written twice.
    await vi.advanceTimersByTimeAsync(POSITION_SAVE_DEBOUNCE_MS * 2);
    expect(saved).toHaveLength(1);
  });

  it('carries the Node Anchor and the engine CFI with the position', async () => {
    recordReadingPosition(
      { bookHash: 'b', spineIndex: 7, anchor: 'sigil_toc_id_3' },
      { cfi: 'epubcfi(/6/16!/2/2)' },
    );
    await flushReadingPosition();

    expect(saved).toEqual([
      {
        bookHash: 'b',
        spineIndex: 7,
        nodeIndex: 7,
        anchor: 'sigil_toc_id_3',
        cfi: 'epubcfi(/6/16!/2/2)',
      },
    ]);
    // Moving to a section start clears the stale anchor.
    recordReadingPosition({ bookHash: 'b', spineIndex: 8 });
    await flushReadingPosition();
    expect(useReaderStore.getState().anchor).toBeUndefined();
    expect(saved[1]).toEqual({ bookHash: 'b', spineIndex: 8, nodeIndex: 8 });
  });

  it('derives the title from the node model and returns it to the caller', () => {
    registerAgentBookContext(
      createAgentBookContext({
        bookHash: 'b',
        nodes: [
          {
            nodeId: 'b:n_0',
            bookHash: 'b',
            nodeIndex: 0,
            title: '第一章 起源',
            startOffset: 0,
            endOffset: 6,
            charCount: 6,
            depth: 0,
            spineIndex: 0,
            indexStatus: 'ready',
          },
        ],
        fullText: '甲乙丙丁戊己',
      }),
    );

    const title = recordReadingPosition({ bookHash: 'b', spineIndex: 0 });
    expect(title).toBe('第一章 起源');
    expect(useReaderStore.getState().nodeTitle).toBe('第一章 起源');
  });

  it('uses the caller fallback title when the node model cannot name the node', () => {
    // Spine 9 is past the demo fixture, so no source can name it.
    const title = recordReadingPosition(
      { bookHash: 'unindexed', spineIndex: 9 },
      { titleFallback: '第二章 雾锁' },
    );
    expect(title).toBe('第二章 雾锁');
    expect(useReaderStore.getState().nodeTitle).toBe('第二章 雾锁');
  });

  it('restores state without writing it back when persist is false', async () => {
    recordReadingPosition({ bookHash: 'b', spineIndex: 9 }, { persist: false });
    expect(useReaderStore.getState().spineIndex).toBe(9);

    await vi.advanceTimersByTimeAsync(POSITION_SAVE_DEBOUNCE_MS * 2);
    expect(saved).toEqual([]);
  });
});

describe('loadPersistedPosition', () => {
  it('reads through the persister', async () => {
    stored = { bookHash: 'b', spineIndex: 3, anchor: 'a' };
    await expect(loadPersistedPosition('b')).resolves.toEqual({
      bookHash: 'b',
      spineIndex: 3,
      anchor: 'a',
    });
  });

  it('reports nothing to resume for a book without a stored position', async () => {
    await expect(loadPersistedPosition('b')).resolves.toBeNull();
  });
});

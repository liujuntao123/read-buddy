/**
 * Reading Position ownership（阅读位置的唯一属主）。
 *
 * The finding (候选 3): recording a position meant calling
 * `readerStore.setPosition(spineIndex, title, anchor?)`, so **five** call sites
 * each resolved the title and the anchor themselves — two of them with their own
 * copy of the href→anchor parser — and **three** of them persisted the result on
 * independent triggers (a pane-local 1500 ms throttle that could drop the last
 * page turn of a session, an effect keyed on every position change, and the
 * store's own save path). Nothing owned 「读者能回到哪里」.
 *
 * This module owns it. Callers hand over a Reading Position and nothing else:
 *
 * - the **title** is resolved from the node model (`resolveNodeViewAt`); the
 *   fallback title is only for the case where the model cannot name the node yet;
 * - the **anchor** travels with the position, so a resumed session resolves the
 *   same Book Node instead of its owning 章;
 * - **persistence** is debounced here and flushed explicitly, so a page turn is
 *   never lost to a throttle, and closing the window flushes the tail.
 *
 * Persistence itself is injected (`setPositionPersister`) rather than imported:
 * the store that owns the database and the live engines binds it at creation,
 * which keeps this module free of any store import cycle.
 */
import { resolveNodeViewAt, type ReadingPosition } from '@/services/bookNodes';
import { useReaderStore } from '@/store/readerStore';

/** What the reader can be resumed to. `cfi` is the engine's exact location. */
export interface PersistedReadingPosition {
  bookHash: string;
  /** Physical spine-section / virtual-section ordinal. */
  spineIndex: number;
  /**
   * The Book Node the reader was at — resolved from the Node View, so it is a
   * genuine node ordinal even when it differs from `spineIndex`. The shelf needs
   * it to name a level without guessing.
   */
  nodeIndex?: number;
  anchor?: string;
  cfi?: string;
}

/** The database + engine seam this module writes through. */
export interface PositionPersister {
  save(record: PersistedReadingPosition): Promise<void>;
  /** The stored position for a book, or null when it has none / was removed. */
  load(bookHash: string): Promise<PersistedReadingPosition | null>;
}

let persister: PositionPersister | null = null;

/** Bound once by the library store (tests inject an isolated database). */
export function setPositionPersister(next: PositionPersister): void {
  persister = next;
}

/**
 * How long a position change is allowed to sit before it is written. Long enough
 * that a burst of page turns collapses into one write; short enough that a crash
 * loses at most one pause.
 */
export const POSITION_SAVE_DEBOUNCE_MS = 1_500;

let timer: ReturnType<typeof setTimeout> | null = null;
let pending: PersistedReadingPosition | null = null;

const cancelTimer = (): void => {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
};

/**
 * Record where the reader is. The **only** way a Reading Position changes:
 * callers pass the physical position (plus what only they know — the engine's
 * CFI and, at relocate time, the directory label the engine already has in hand)
 * and this module derives the title from the node model.
 *
 * Returns the resolved title so a caller that also displays it does not resolve
 * it a second time.
 */
export function recordReadingPosition(
  position: ReadingPosition,
  options: { cfi?: string; titleFallback?: string; persist?: boolean } = {},
): string {
  const view = resolveNodeViewAt(position);
  const title = view.title || options.titleFallback || '';

  // State first: every node-model answer reads it from here. `setPosition`
  // always writes `anchor`, so moving to a section start clears a stale one.
  useReaderStore.getState().setPosition(position.spineIndex, title, position.anchor);

  // Restoring a stored position must not immediately write it back.
  if (options.persist === false) return title;

  const record: PersistedReadingPosition = {
    bookHash: position.bookHash,
    spineIndex: position.spineIndex,
    nodeIndex: view.nodeIndex,
    ...(position.anchor ? { anchor: position.anchor } : {}),
    ...(options.cfi ? { cfi: options.cfi } : {}),
  };

  pending = record;
  cancelTimer();
  timer = setTimeout(() => {
    timer = null;
    void flushReadingPosition();
  }, POSITION_SAVE_DEBOUNCE_MS);
  return title;
}

/** Write the pending position now (page hide, unmount, explicit save). */
export async function flushReadingPosition(): Promise<void> {
  cancelTimer();
  const record = pending;
  pending = null;
  if (!record || !persister) return;
  await persister.save(record);
}

/** The stored position for a book, or null when there is nothing to resume. */
export async function loadPersistedPosition(
  bookHash: string,
): Promise<PersistedReadingPosition | null> {
  if (!persister) return null;
  return persister.load(bookHash);
}

/** Testing seam: forget the pending write without writing it. */
export function resetReadingPosition(): void {
  cancelTimer();
  pending = null;
}

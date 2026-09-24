import Dexie, { type Table } from 'dexie';
import type { AISettings, BookSegmentation, NodeSummary, Conversation, Message } from '@/types/ai';
import type { LibraryBook } from '@/types/library';
import type { ReaderHighlight } from '@/types/highlight';
import type {
  AgentTurnTraceRecord,
  BookNodeRecord,
  BookPanoramaRecord,
  ReadingEntityRecord,
} from '@/types/readingAgent';

export interface AISettingsRow extends AISettings {
  /** Singleton row key; keeps the settings table a single-record store. */
  id: string;
}

export const AI_SETTINGS_KEY = 'global';

/**
 * Local IndexedDB persistence layer (Dexie).
 * Plaintext credential storage per ADR 0008; imported book files are stored
 * verbatim so the library is fully offline and re-openable.
 *
 * Table history:
 * - v3 added the whole-book agent index tables. Its first
 *   draft created `chapter_nodes` with an `id` primary key; while that draft
 *   was hot-reloading through running dev servers, some browsers installed a
 *   v3 database with that broken store (writes then failed with
 *   `Evaluating the object store's key path did not yield a value`). Dexie
 *   cannot change a primary key in place, so v3 deliberately OMITS
 *   `chapter_nodes` (opening a legacy v3 database diffs the store away) and
 *   v4 (re)created it with the `chapterId` primary key.
 * - v5 is the node-model upgrade (CONTEXT.md / ADR 0010): nodes are taken from
 *   the book's own directory (anchors included) rather than one node per spine
 *   section, so both `chapter_nodes` and the per-spine-ordinal
 *   `chapterSummaries` cache are invalid. They are dropped and recreated under
 *   the unified vocabulary (`book_nodes` / `node_summaries`); the background
 *   index pipeline rebuilds them on the next book open. Shelf rows, reading
 *   progress, conversations and settings are untouched.
 * - v6 renames `Conversation.nodeIndex` to `Conversation.spineIndex` — the one
 *   field the v5 rename missed, because it was named after a node ordinal while
 *   holding a physical one (ADR 0011). This is the first data-preserving
 *   upgrade: no store is dropped, the rows are rewritten in place.
 * - v7 carries the same rename to `LibraryBook.lastNodeIndex` → `lastSpineIndex`,
 *   and reading progress gains the Node Anchor alongside the ordinal and CFI.
 * - v8 adds `highlights` — the reader's own 划线 marks (CONTEXT.md 「Highlight」).
 *   Purely additive: no existing store changes, and the rows are found again by
 *   their text anchor rather than by anything the node model computed.
 */
export class ReadBuddyDatabase extends Dexie {
  aiSettings!: Table<AISettingsRow, string>;
  bookSegmentations!: Table<BookSegmentation, string>;
  conversations!: Table<Conversation, string>;
  messages!: Table<Message, string>;
  books!: Table<LibraryBook, string>;
  // Dexie attaches a table property under the EXACT store name declared in
  // `stores()` — these must therefore stay snake_case, or the property
  // type-checks while evaluating to `undefined` at runtime.
  node_summaries!: Table<NodeSummary, string>;
  book_nodes!: Table<BookNodeRecord, string>;
  book_panoramas!: Table<BookPanoramaRecord, string>;
  reading_entities!: Table<ReadingEntityRecord, string>;
  agent_turn_traces!: Table<AgentTurnTraceRecord, string>;
  highlights!: Table<ReaderHighlight, string>;

  constructor(name = 'read-buddy') {
    super(name);
    this.version(1).stores({
      aiSettings: 'id',
      bookSegmentations: 'bookHash',
      chapterSummaries: 'id, bookHash, sectionIndex',
      conversations: 'id, bookHash, isClosed, updatedAt',
      messages: 'id, conversationId, createdAt',
    });
    this.version(2).stores({
      books: 'hash, format, updatedAt',
    });
    // v3: the three stable agent tables. chapter_nodes intentionally absent
    // (see the class comment) — the legacy store gets dropped on upgrade.
    this.version(3).stores({
      book_panoramas: 'bookHash',
      reading_entities: 'id, bookHash, category, name',
      agent_turn_traces: 'id, conversationId, messageId',
    });
    // v4: chapter_nodes with the final primary key
    // (`${bookHash}:ch_${sectionIndex}`).
    this.version(4).stores({
      chapter_nodes: 'chapterId, bookHash, sectionIndex, indexStatus',
    });
    // v5: unified node model — `book_nodes` (keyed `${bookHash}:n_${nodeIndex}`)
    // and `node_summaries`. The pre-v5 stores are deleted, not migrated: their
    // granularity (one row per spine section) no longer matches the node model.
    this.version(5).stores({
      chapterSummaries: null,
      chapter_nodes: null,
      book_nodes: 'nodeId, bookHash, nodeIndex, indexStatus',
      node_summaries: 'id, bookHash, nodeIndex',
    });
    // v6: data-only rename (ADR 0011) — `Conversation.nodeIndex` held a physical
    // spine ordinal under a node-ordinal name. No index changes (the field was
    // never indexed), so `stores({})` carries the v5 schema forward and only the
    // upgrade runs. Idempotent: a row already carrying `spineIndex` is left
    // alone, so a re-run cannot corrupt it.
    this.version(6)
      .stores({})
      .upgrade(async (tx) => {
        await tx
          .table('conversations')
          .toCollection()
          .modify((row: Record<string, unknown>) => {
            if (row.nodeIndex !== undefined && row.spineIndex === undefined) {
              row.spineIndex = row.nodeIndex;
            }
            delete row.nodeIndex;
          });
      });
    // v7: the same rename one table over (ADR 0011). `LibraryBook.lastNodeIndex`
    // held a physical spine ordinal under a node-ordinal name; it becomes
    // `lastSpineIndex`. Data-only again — the field was never indexed, so
    // `stores({})` carries the v6 schema forward.
    this.version(7)
      .stores({})
      .upgrade(async (tx) => {
        await tx
          .table('books')
          .toCollection()
          .modify((row: Record<string, unknown>) => {
            if (row.lastNodeIndex !== undefined && row.lastSpineIndex === undefined) {
              row.lastSpineIndex = row.lastNodeIndex;
            }
            delete row.lastNodeIndex;
          });
      });
    // v8: reader highlights (划线). Additive, no index on the anchor fields: the
    // list is always "this book's highlights", and painting filters by
    // `spineIndex` in memory (a book has tens of highlights, not thousands).
    this.version(8).stores({
      highlights: 'id, bookHash, nodeIndex, createdAt',
    });
  }
}

let singleton: ReadBuddyDatabase | undefined;

export function getDatabase(): ReadBuddyDatabase {
  if (!singleton) singleton = new ReadBuddyDatabase();
  return singleton;
}

import Dexie, { type Table } from 'dexie';
import type { AISettings, BookSegmentation, NodeSummary, Conversation, Message } from '@/types/ai';
import type { LibraryBook } from '@/types/library';
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
 * - v3 added the whole-book agent index tables (design doc §6.2). Its first
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
 */
export class ReadestPlusDatabase extends Dexie {
  aiSettings!: Table<AISettingsRow, string>;
  bookSegmentations!: Table<BookSegmentation, string>;
  conversations!: Table<Conversation, string>;
  messages!: Table<Message, string>;
  books!: Table<LibraryBook, string>;
  // Dexie attaches a table property under the EXACT store name declared in
  // `stores()` — these four must therefore stay snake_case, or the property
  // type-checks while evaluating to `undefined` at runtime.
  node_summaries!: Table<NodeSummary, string>;
  book_nodes!: Table<BookNodeRecord, string>;
  book_panoramas!: Table<BookPanoramaRecord, string>;
  reading_entities!: Table<ReadingEntityRecord, string>;
  agent_turn_traces!: Table<AgentTurnTraceRecord, string>;

  constructor(name = 'readest-plus') {
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
  }
}

let singleton: ReadestPlusDatabase | undefined;

export function getDatabase(): ReadestPlusDatabase {
  if (!singleton) singleton = new ReadestPlusDatabase();
  return singleton;
}

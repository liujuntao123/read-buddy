import Dexie, { type Table } from 'dexie';
import type { AISettings, BookSegmentation, ChapterSummary, Conversation, Message } from '@/types/ai';
import type { LibraryBook } from '@/types/library';

export interface AISettingsRow extends AISettings {
  /** Singleton row key; keeps the settings table a single-record store. */
  id: string;
}

export const AI_SETTINGS_KEY = 'global';

/**
 * Local IndexedDB persistence layer (Dexie).
 * Plaintext credential storage per ADR 0008; imported book files are stored
 * verbatim so the library is fully offline and re-openable.
 */
export class ReadestPlusDatabase extends Dexie {
  aiSettings!: Table<AISettingsRow, string>;
  bookSegmentations!: Table<BookSegmentation, string>;
  chapterSummaries!: Table<ChapterSummary, string>;
  conversations!: Table<Conversation, string>;
  messages!: Table<Message, string>;
  books!: Table<LibraryBook, string>;

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
  }
}

let singleton: ReadestPlusDatabase | undefined;

export function getDatabase(): ReadestPlusDatabase {
  if (!singleton) singleton = new ReadestPlusDatabase();
  return singleton;
}

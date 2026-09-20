import Dexie, { type Table } from 'dexie';
import type { AISettings, BookSegmentation, ChapterSummary, Conversation, Message } from '@/types/ai';

export interface AISettingsRow extends AISettings {
  /** Singleton row key; keeps the settings table a single-record store. */
  id: string;
}

export const AI_SETTINGS_KEY = 'global';

/**
 * Local IndexedDB persistence layer (Dexie).
 * Plaintext credential storage per ADR 0008.
 */
export class ReadestPlusDatabase extends Dexie {
  aiSettings!: Table<AISettingsRow, string>;
  bookSegmentations!: Table<BookSegmentation, string>;
  chapterSummaries!: Table<ChapterSummary, string>;
  conversations!: Table<Conversation, string>;
  messages!: Table<Message, string>;

  constructor(name = 'readest-plus') {
    super(name);
    this.version(1).stores({
      aiSettings: 'id',
      bookSegmentations: 'bookHash',
      chapterSummaries: 'id, bookHash, sectionIndex',
      conversations: 'id, bookHash, isClosed, updatedAt',
      messages: 'id, conversationId, createdAt',
    });
  }
}

let singleton: ReadestPlusDatabase | undefined;

export function getDatabase(): ReadestPlusDatabase {
  if (!singleton) singleton = new ReadestPlusDatabase();
  return singleton;
}

import type {
  AISettings,
  BookSegmentation,
  ChapterSummary,
  Conversation,
  Message,
} from '@/types/ai';
import { DEFAULT_AI_SETTINGS, chapterSummaryId } from '@/types/ai';
import { AI_SETTINGS_KEY, getDatabase, ReadestPlusDatabase, type AISettingsRow } from './database';

/**
 * Repository seam over Dexie. Every repository accepts an injected database
 * instance so unit tests can run against fake-indexeddb without the app
 * singleton. Repositories are the ONLY modules allowed to touch Dexie tables.
 */

export class AISettingsRepository {
  constructor(private readonly db: ReadestPlusDatabase = getDatabase()) {}

  async load(): Promise<AISettings> {
    const row = await this.db.aiSettings.get(AI_SETTINGS_KEY);
    if (!row) return { ...DEFAULT_AI_SETTINGS };
    const { id: _drop, ...settings } = row;
    return settings;
  }

  async save(settings: AISettings): Promise<void> {
    const row: AISettingsRow = { ...settings, id: AI_SETTINGS_KEY };
    await this.db.aiSettings.put(row);
  }
}

export class BookSegmentationRepository {
  constructor(private readonly db: ReadestPlusDatabase = getDatabase()) {}

  async load(bookHash: string): Promise<BookSegmentation | undefined> {
    return this.db.bookSegmentations.get(bookHash);
  }

  async save(segmentation: BookSegmentation): Promise<void> {
    await this.db.bookSegmentations.put(segmentation);
  }
}

export class ChapterSummaryRepository {
  constructor(private readonly db: ReadestPlusDatabase = getDatabase()) {}

  async get(bookHash: string, sectionIndex: number): Promise<ChapterSummary | undefined> {
    return this.db.chapterSummaries.get(chapterSummaryId(bookHash, sectionIndex));
  }

  async put(summary: ChapterSummary): Promise<void> {
    await this.db.chapterSummaries.put(summary);
  }

  async remove(bookHash: string, sectionIndex: number): Promise<void> {
    await this.db.chapterSummaries.delete(chapterSummaryId(bookHash, sectionIndex));
  }

  async listByBook(bookHash: string): Promise<ChapterSummary[]> {
    return this.db.chapterSummaries.where('bookHash').equals(bookHash).toArray();
  }
}

export class ConversationRepository {
  constructor(private readonly db: ReadestPlusDatabase = getDatabase()) {}

  async get(id: string): Promise<Conversation | undefined> {
    return this.db.conversations.get(id);
  }

  async put(conversation: Conversation): Promise<void> {
    await this.db.conversations.put(conversation);
  }

  async remove(id: string): Promise<void> {
    await this.db.transaction('rw', this.db.conversations, this.db.messages, async () => {
      await this.db.messages.where('conversationId').equals(id).delete();
      await this.db.conversations.delete(id);
    });
  }

  /** Newest conversation first. */
  async listByBook(bookHash: string): Promise<Conversation[]> {
    return (await this.db.conversations.where('bookHash').equals(bookHash).toArray()).sort(
      (a, b) => b.updatedAt - a.updatedAt,
    );
  }

  async appendMessage(message: Message): Promise<void> {
    await this.db.messages.put(message);
  }

  /** Oldest message first (chat display order). */
  async listMessages(conversationId: string): Promise<Message[]> {
    return (
      await this.db.messages.where('conversationId').equals(conversationId).toArray()
    ).sort((a, b) => a.createdAt - b.createdAt);
  }
}

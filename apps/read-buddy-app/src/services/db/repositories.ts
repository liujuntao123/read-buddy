import type {
  AISettings,
  BookSegmentation,
  NodeSummary,
  Conversation,
  Message,
} from '@/types/ai';
import { DEFAULT_AI_SETTINGS, nodeSummaryId } from '@/types/ai';
import { compareHighlights, type ReaderHighlight } from '@/types/highlight';
import type {
  AgentTurnTraceRecord,
  BookPanoramaRecord,
  BookNodeRecord,
  ReadingEntityRecord,
} from '@/types/readingAgent';
import { bookNodeId } from '@/types/readingAgent';
import { AI_SETTINGS_KEY, getDatabase, ReadBuddyDatabase, type AISettingsRow } from './database';

/**
 * Repository seam over Dexie. Every repository accepts an injected database
 * instance so unit tests can run against fake-indexeddb without the app
 * singleton. Repositories are the ONLY modules allowed to touch Dexie tables.
 */

export class AISettingsRepository {
  constructor(private readonly db: ReadBuddyDatabase = getDatabase()) {}

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
  constructor(private readonly db: ReadBuddyDatabase = getDatabase()) {}

  async load(bookHash: string): Promise<BookSegmentation | undefined> {
    return this.db.bookSegmentations.get(bookHash);
  }

  async save(segmentation: BookSegmentation): Promise<void> {
    await this.db.bookSegmentations.put(segmentation);
  }
}

export class NodeSummaryRepository {
  constructor(private readonly db: ReadBuddyDatabase = getDatabase()) {}

  async get(bookHash: string, nodeIndex: number): Promise<NodeSummary | undefined> {
    return this.db.node_summaries.get(nodeSummaryId(bookHash, nodeIndex));
  }

  async put(summary: NodeSummary): Promise<void> {
    await this.db.node_summaries.put(summary);
  }

  async remove(bookHash: string, nodeIndex: number): Promise<void> {
    await this.db.node_summaries.delete(nodeSummaryId(bookHash, nodeIndex));
  }

  async listByBook(bookHash: string): Promise<NodeSummary[]> {
    return this.db.node_summaries.where('bookHash').equals(bookHash).toArray();
  }
}

export class ConversationRepository {
  constructor(private readonly db: ReadBuddyDatabase = getDatabase()) {}

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

  /**
 * Oldest message first (chat display order).
 *
 * `createdAt` alone is not enough: `toArray()` on a `conversationId` index
 * returns rows in primary-key order and `id` is a uuid, so two messages written
 * in the same millisecond (a scripted turn, a fast local model) had **no defined
 * order** — the assistant reply could render above the question. Ties now fall
 * back to the id, which is at least stable across reads.
 */
  async listMessages(conversationId: string): Promise<Message[]> {
    return (
      await this.db.messages.where('conversationId').equals(conversationId).toArray()
    ).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  }
}

/**
 * Chapter node persistence (ADR 0010): the unified
 * global-offset chapter map plus the import-time micro-briefs. Rows are
 * written by the segmentation pass and updated chapter-by-chapter by the
 * brief scheduler, so partial updates use `put` on the computed primary key.
 */
export class BookNodeRepository {
  constructor(private readonly db: ReadBuddyDatabase = getDatabase()) {}

  async listByBook(bookHash: string): Promise<BookNodeRecord[]> {
    const rows = await this.db.book_nodes.where('bookHash').equals(bookHash).toArray();
    return rows.sort((a, b) => a.nodeIndex - b.nodeIndex);
  }

  async bulkPut(nodes: BookNodeRecord[]): Promise<void> {
    if (nodes.length === 0) return;
    await this.db.book_nodes.bulkPut(nodes);
  }

  async put(node: BookNodeRecord): Promise<void> {
    await this.db.book_nodes.put(node);
  }

  async get(bookHash: string, nodeIndex: number): Promise<BookNodeRecord | undefined> {
    return this.db.book_nodes.get(bookNodeId(bookHash, nodeIndex));
  }

  async deleteByBook(bookHash: string): Promise<void> {
    const rows = await this.db.book_nodes.where('bookHash').equals(bookHash).toArray();
    await this.db.book_nodes.bulkDelete(rows.map((row) => row.nodeId));
  }
}

/** Whole-book panorama portrait store (one row per book). */
export class BookPanoramaRepository {
  constructor(private readonly db: ReadBuddyDatabase = getDatabase()) {}

  async get(bookHash: string): Promise<BookPanoramaRecord | undefined> {
    return this.db.book_panoramas.get(bookHash);
  }

  async put(panorama: BookPanoramaRecord): Promise<void> {
    await this.db.book_panoramas.put(panorama);
  }

  async delete(bookHash: string): Promise<void> {
    await this.db.book_panoramas.delete(bookHash);
  }
}

/** Entity glossary store (characters / locations / terms / clues). */
export class ReadingEntityRepository {
  constructor(private readonly db: ReadBuddyDatabase = getDatabase()) {}

  async listByBook(bookHash: string): Promise<ReadingEntityRecord[]> {
    return this.db.reading_entities.where('bookHash').equals(bookHash).toArray();
  }

  async bulkPut(entities: ReadingEntityRecord[]): Promise<void> {
    if (entities.length === 0) return;
    await this.db.reading_entities.bulkPut(entities);
  }
}

/** Agent turn traces: persisted tool-call trails behind each assistant reply. */
export class AgentTraceRepository {
  constructor(private readonly db: ReadBuddyDatabase = getDatabase()) {}

  async put(trace: AgentTurnTraceRecord): Promise<void> {
    await this.db.agent_turn_traces.put(trace);
  }

  async listByMessage(messageId: string): Promise<AgentTurnTraceRecord[]> {
    return this.db.agent_turn_traces.where('messageId').equals(messageId).toArray();
  }

  async listByConversation(conversationId: string): Promise<AgentTurnTraceRecord[]> {
    const rows = await this.db.agent_turn_traces
      .where('conversationId')
      .equals(conversationId)
      .toArray();
    return rows.sort((a, b) => a.createdAt - b.createdAt);
  }
}

/**
 * Reader highlights (划线) — the reader's own persistent marks.
 *
 * Rows are always read **for one book**, in document order: the sidebar lists
 * them in reading order and the panes paint the subset belonging to the chapter
 * they are showing.
 */
export class HighlightRepository {
  constructor(private readonly db: ReadBuddyDatabase = getDatabase()) {}

  async put(highlight: ReaderHighlight): Promise<void> {
    await this.db.highlights.put(highlight);
  }

  async remove(id: string): Promise<void> {
    await this.db.highlights.delete(id);
  }

  async listByBook(bookHash: string): Promise<ReaderHighlight[]> {
    const rows = await this.db.highlights.where('bookHash').equals(bookHash).toArray();
    return rows.sort(compareHighlights);
  }
}

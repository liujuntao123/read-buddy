import { describe, expect, it } from 'vitest';
import Dexie from 'dexie';
import { ReadestPlusDatabase } from './database';
import { bookNodeId, type BookNodeRecord } from '@/types/readingAgent';
import { nodeSummaryId, type NodeSummary } from '@/types/ai';

/**
 * Migration regression tests (node-model schema upgrade, CONTEXT.md / ADR 0010).
 *
 * Scenario A upgrades a legacy **v4** database — the shipped per-spine
 * `chapter_nodes` / `chapterSummaries` pair — to v5, which deletes both stores
 * (their granularity is one row per spine section, incompatible with the node
 * model) and recreates them as `book_nodes` / `node_summaries` under the new
 * primary keys.
 *
 * Scenario B reproduces the dev-era **v3** draft that some browsers installed:
 * it created `chapter_nodes` with an `id` primary key, so every `chapterId`
 * keyed write failed with "Evaluating the object store's key path did not
 * yield a value". Dexie cannot change a primary key in place, so the final v3
 * omits the store and v4 recreates it; opening such a database must drop the
 * broken store instead of throwing "Not yet support for changing primary key".
 */

const dbName = () => `migration-test-${Math.random().toString(36).slice(2)}`;

/** v1 shelf / settings / summary stores (unchanged by v5). */
const V1_STORES = {
  aiSettings: 'id',
  bookSegmentations: 'bookHash',
  chapterSummaries: 'id, bookHash, sectionIndex',
  conversations: 'id, bookHash, isClosed, updatedAt',
  messages: 'id, conversationId, createdAt',
};
const V2_STORES = { books: 'hash, format, updatedAt' };
const V3_AGENT_STORES = {
  book_panoramas: 'bookHash',
  reading_entities: 'id, bookHash, category, name',
  agent_turn_traces: 'id, conversationId, messageId',
};

/** The dev-era draft declaration that some browsers installed (broken pk). */
class LegacyDraftV3Database extends Dexie {
  constructor(name: string) {
    super(name);
    this.version(1).stores(V1_STORES);
    this.version(2).stores(V2_STORES);
    this.version(3).stores({
      // The broken draft: `id` primary key + a compound index.
      chapter_nodes: 'id, bookHash, sectionIndex, indexStatus, [bookHash+sectionIndex]',
      ...V3_AGENT_STORES,
    });
  }
}

/** The shipped v1~v4 declaration: chapter_nodes recreated with `chapterId`. */
class LegacyChapterNodesV4Database extends Dexie {
  constructor(name: string) {
    super(name);
    this.version(1).stores(V1_STORES);
    this.version(2).stores(V2_STORES);
    // v3 deliberately omits chapter_nodes (see the class comment).
    this.version(3).stores(V3_AGENT_STORES);
    this.version(4).stores({
      chapter_nodes: 'chapterId, bookHash, sectionIndex, indexStatus',
    });
  }
}

const sampleNode = (bookHash: string, index: number): BookNodeRecord => ({
  nodeId: bookNodeId(bookHash, index),
  bookHash,
  nodeIndex: index,
  title: `第${index + 1}章 标题`,
  startOffset: 0,
  endOffset: 100,
  charCount: 100,
  depth: 0,
  indexStatus: 'pending',
  updatedAt: Date.now(),
});

const sampleSummary = (bookHash: string, index: number): NodeSummary => ({
  id: nodeSummaryId(bookHash, index),
  bookHash,
  nodeIndex: index,
  nodeTitle: `第${index + 1}章 标题`,
  modelUsed: 'deepseek-chat',
  summaryContent: '### 📌 节点核心要义',
  pipeline: 'single',
  createdAt: 1,
  updatedAt: 1,
});

/**
 * The v5 stores are asserted through `db.table(<store name>)` so the schema
 * contract (store names + primary keys) is checked explicitly; the database
 * class also exposes them as `db.book_nodes` / `db.node_summaries`.
 */
const bookNodesOf = (db: ReadestPlusDatabase) =>
  db.table<BookNodeRecord, string>('book_nodes');
const nodeSummariesOf = (db: ReadestPlusDatabase) => db.table<NodeSummary, string>('node_summaries');

describe('ReadestPlusDatabase schema migration', () => {
  it('A: upgrades a legacy v4 database, dropping chapter_nodes + chapterSummaries', async () => {
    const name = dbName();
    const legacy = new LegacyChapterNodesV4Database(name);
    await legacy.open();
    await legacy.table('chapter_nodes').put({
      chapterId: 'b:ch_0',
      bookHash: 'b',
      sectionIndex: 0,
      indexStatus: 'ready',
    });
    await legacy.table('chapterSummaries').put({ id: 'b:0', bookHash: 'b', sectionIndex: 0 });
    await legacy.close();

    // Opening with the current declaration migrates v4 → v5 instead of throwing
    // or silently leaving the per-spine stores in place.
    const db = new ReadestPlusDatabase(name);
    await db.open();

    const names = db.tables.map((table) => table.name);
    expect(names).not.toContain('chapter_nodes');
    expect(names).not.toContain('chapterSummaries');
    expect(names).toContain('book_nodes');
    expect(names).toContain('node_summaries');

    // New primary keys: `${bookHash}:n_${nodeIndex}` rows and `${bookHash}:${nodeIndex}` summaries.
    const bookNodes = bookNodesOf(db);
    expect(bookNodes.schema.primKey.keyPath).toBe('nodeId');
    expect(bookNodes.schema.indexes.map((index) => index.name)).toEqual(
      expect.arrayContaining(['bookHash', 'nodeIndex', 'indexStatus']),
    );
    const nodeSummaries = nodeSummariesOf(db);
    expect(nodeSummaries.schema.primKey.keyPath).toBe('id');
    expect(nodeSummaries.schema.indexes.map((index) => index.name)).toEqual(
      expect.arrayContaining(['bookHash', 'nodeIndex']),
    );

    // The legacy rows were dropped with their stores, not re-homed (one row
    // per spine section is not a node).
    expect(await bookNodes.count()).toBe(0);
    expect(await nodeSummaries.count()).toBe(0);

    const node = sampleNode('b', 0);
    await bookNodes.put(node);
    await expect(bookNodes.get(node.nodeId)).resolves.toMatchObject({
      nodeId: node.nodeId,
      nodeIndex: 0,
    });
    const summary = sampleSummary('b', 0);
    await nodeSummaries.put(summary);
    await expect(nodeSummaries.get(summary.id)).resolves.toMatchObject({ nodeIndex: 0 });

    // The v3 agent tables survive the upgrade (with their rows).
    await db.book_panoramas.put({
      bookHash: 'b',
      summary: '概要',
      totalNodes: 1,
      isFullyIndexed: false,
      createdAt: 1,
      updatedAt: 1,
    });
    await expect(db.book_panoramas.get('b')).resolves.toMatchObject({ summary: '概要' });

    await db.close();
    await Dexie.delete(name);
  });

  it('B: opens a legacy v3 database carrying the broken id-keyed chapter_nodes store', async () => {
    const name = dbName();
    const legacy = new LegacyDraftV3Database(name);
    await legacy.open();
    // Prove the trap: the store's primary key is `id`, so a chapterId-keyed
    // row can never be written (the reported DataError state).
    await expect(
      legacy.table('chapter_nodes').put({
        chapterId: 'b:ch_0',
        bookHash: 'b',
        sectionIndex: 0,
        indexStatus: 'pending',
      }),
    ).rejects.toBeTruthy();
    await legacy.close();

    // Must migrate instead of exploding with
    // `Not yet support for changing primary key`.
    const db = new ReadestPlusDatabase(name);
    await expect(db.open()).resolves.toBeDefined();

    const names = db.tables.map((table) => table.name);
    expect(names).not.toContain('chapter_nodes');
    expect(names).not.toContain('chapterSummaries');
    expect(names).toContain('book_nodes');
    expect(names).toContain('node_summaries');

    // The recreated stores are writable with the new keys.
    const bookNodes = bookNodesOf(db);
    const nodeSummaries = nodeSummariesOf(db);
    await bookNodes.put(sampleNode('b', 1));
    await expect(bookNodes.get(bookNodeId('b', 1))).resolves.toMatchObject({ nodeIndex: 1 });
    await nodeSummaries.put(sampleSummary('b', 1));
    await expect(nodeSummaries.get(nodeSummaryId('b', 1))).resolves.toMatchObject({
      nodeIndex: 1,
    });

    await db.close();
    await Dexie.delete(name);
  });

  it('C: fresh databases install the v5 node stores directly', async () => {
    const name = dbName();
    const db = new ReadestPlusDatabase(name);
    await db.open();
    const names = db.tables.map((table) => table.name);
    expect(names).toContain('book_nodes');
    expect(names).toContain('node_summaries');
    expect(names).not.toContain('chapter_nodes');
    expect(names).not.toContain('chapterSummaries');

    const node = sampleNode('fresh', 0);
    const bookNodes = bookNodesOf(db);
    await bookNodes.put(node);
    await expect(bookNodes.get(node.nodeId)).resolves.toBeTruthy();
    await db.close();
    await Dexie.delete(name);
  });
});

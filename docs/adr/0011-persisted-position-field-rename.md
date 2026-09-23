# ADR 0011: Rename the persisted position fields to `spineIndex` (Dexie v6, v7)

## Status
Accepted

## Context
1. **A field named after the logical ordinal held the physical one.** `Conversation.nodeIndex` was written from `openBook(bookHash, spineIndex)` — the reader's physical spine-section ordinal (`readerStore.spineIndex`) — while its name claimed a Book Node ordinal. `LibraryBook.lastNodeIndex` had the identical defect one table over. Nothing read either for display, so the lie was invisible; but any surface that later treats them as node ordinals will be wrong for exactly the books ADR 0010 exists for (《何为良好生活》: 11 spine files, 81 directory entries).
2. **The originating spec is inconsistent too.** The design doc declared the field as `sectionIndex` (`docs/readest-plus 桌面端应用设计文档.md:220`, `docs/technical-solution-reading-agent-architecture.md:459`), and `readerStore` already renamed its own `nodeIndex` → `spineIndex` for the same reason (ADR 0010 ¶6). The persisted rows are the one place the rename was never carried out.
3. **ADR 0010 stated the opposite consequence.** Its "Negative / Trade-offs" says the v5 upgrade left "shelf rows, reading progress, conversations and settings untouched". A v6/v7 that rewrites a field *on* those rows therefore looks, to a future reader, like a violation of a recorded decision rather than a deliberate follow-up. Recording it here is what makes the difference legible.
4. **No migration precedent existed.** `ReadestPlusDatabase` had five `.version()` calls and no `.upgrade()` body anywhere; v5 chose to drop and rebuild rather than migrate. These are the first data-preserving upgrades, so the pattern they set matters.
5. **Reading progress could not be resumed faithfully.** Only the ordinal and (engine-only) CFI were stored, so a resumed session restored the physical position but had no Node Anchor — the Node View then reported the **owning 章** instead of the anchored 节 until the first relocate.

## Decision
1. **Rename the fields in the model, not just the comments.** `Conversation.nodeIndex` → `spineIndex`, `StartConversationInput.nodeIndex` → `spineIndex`, and `LibraryBook.lastNodeIndex` → `lastSpineIndex`, matching `readerStore.spineIndex` and CONTEXT.md's **Reading Position**. A comment would have left the defect representable.
2. **Dexie v6 and v7 are data-only upgrades.** `.version(n).stores({})` (no index change — neither field was indexed) plus an `.upgrade()` per table, so existing topics and reading progress survive. Each upgrade is idempotent (`old !== undefined && new === undefined`) so a re-run is harmless.
3. **Reading progress gains the Node Anchor**: `LibraryBook.lastAnchor`, written alongside the ordinal and the CFI.
4. **The localStorage last-book pointer is renamed with a tolerant read.** `{ hash, nodeIndex }` → `{ hash, spineIndex }`; a record still carrying the old key is read and upgraded in place rather than discarded, because losing the 继续阅读 pointer would be a worse outcome than a stale key name.
5. **Reading Position gets one owner** (`services/reader/readingPosition.ts`): callers pass the physical position, the module derives the title from the Node View, debounces the write and exposes an explicit flush. Persistence is injected, so the owner imports no store.

## Consequences
### Positive
- `Conversation.spineIndex` / `LibraryBook.lastSpineIndex` and `readerStore.spineIndex` now mean the same thing under the same name, so a physical-to-logical mix-up is no longer expressible by naming alone.
- Resumed topics and reading progress keep working across the upgrades; no re-index and no re-configuration is required.
- An anchored 节 is restored faithfully: the anchor comes back with the position, so the Node View resolves the same node rather than its 章.
- The repo has `.upgrade()` precedent for the data-preserving migrations later work will need.

### Negative / Trade-offs
- Two upgrades run once per existing install and rewrite rows in `conversations` and `books`; a failure mid-upgrade would leave a mix of old/new field names. Both are written to be idempotent so a re-run is harmless.
- `lastSpineIndex` is *partially* node-like: for TXT books `readerStore.spineIndex` is the virtual-section ordinal, which coincides with the node ordinal. That coincidence is documented in `readerStore`, not enforced here.
- Reading Position persistence is keyed on a module-level persister (the same seam pattern as `setSegmentationRepository`), so the last store created binds it. Tests rely on that; a second store in production would be a bug.
- The engine's CFI, not the anchor, remains the precise restore for engine books. The anchor's job is to make the *resolved node* correct before the first relocate.

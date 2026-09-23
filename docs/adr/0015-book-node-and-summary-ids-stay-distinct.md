# ADR 0015: Book Node ids and Node Summary ids stay distinct

## Status
Accepted

## Context
1. **An architecture review flagged two id formats for "the same pair."**
   `bookNodeId(bookHash, nodeIndex)` produces `${bookHash}:n_${nodeIndex}` and
   `nodeSummaryId(bookHash, nodeIndex)` produces `${bookHash}:${nodeIndex}`. Both are
   addressed by a book hash plus a Book Node ordinal, so the review proposed unifying
   them — "two formats for one identity invite a join bug that no type catches."
2. **They key two independent tables.** `bookNodeId` is the primary key of
   `book_nodes` (Dexie v5, ADR 0010); `nodeSummaryId` is the primary key of
   `node_summaries`. A node row exists for every Book Node the moment a book is
   indexed; a summary row exists only for a node the reader explicitly summarized
   (ADR 0004 — summaries are strictly manual), so the two sets overlap but neither
   contains the other.
3. **The review's feared defect was checked before acting, and it does not exist.**
   Every one of the 67 references was inspected: `bookNodeId` is used only for
   `BookNode.nodeId` / `parentNodeId` / `book_nodes.nodeId`, and `nodeSummaryId` only
   for `NodeSummary.id` / `node_summaries.id`. **No code path passes one where the
   other belongs.** The differing prefix is what makes such a mistake visible in a
   log or a trace, rather than producing a silent miss against the wrong table.
4. **Unifying would cost a migration and remove that safety.** Changing either format
   means rewriting primary keys on existing installs (a third data-preserving upgrade
   after v6/v7), and afterwards a stray `${bookHash}:${nodeIndex}` string would no
   longer say which table it addresses.

## Decision
1. **Keep both formats.** The prefix is load-bearing: it distinguishes a Book Node
   identity from a Node Summary identity at the point where a mistake would otherwise
   be silent.
2. **Record the reason on both factories**, so the next review sees a decision rather
   than an apparent inconsistency.
3. **Name the shared concept instead of merging the keys.** What the two ids have in
   common is the pair `(bookHash, nodeIndex)` — CONTEXT.md's **Book Node** identity —
   not the string. That pair is what both tables are addressed by, and it is what a
   future refactor should factor out if it is factored at all.

## Consequences
### Positive
- No migration, no risk to existing `book_nodes` / `node_summaries` rows.
- A mixed-up id stays diagnosable: the prefix says which table the string came from.
- The review's concern is answered with evidence (67 reference sites, none crossing)
  rather than dismissed by preference.

### Negative / Trade-offs
- Two functions with near-identical signatures remain, so a reader must know which
  table they are addressing. The doc comments on both factories now say so.
- If a future feature genuinely needs one id space (for example exporting a node and
  its summary under a single key), it must introduce an explicit composite rather than
  relying on the two strings coinciding — which is the correct way round.
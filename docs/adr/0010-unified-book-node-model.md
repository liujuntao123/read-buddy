# ADR 0010: Unified Book Node Model (章 / 节 / 最小节点)

## Status
Accepted

## Context
1. **Two competing models of "what is a chapter".** The reader, the whole-book index and the summary were built on the *physical* division (`sectionIndex`: one node per EPUB spine file or TXT virtual segment), while the reader's directory popover showed the book's *own* table of contents with its declared nesting. Real books make the two disagree:
   - 《何为良好生活》 ships **11 spine files** but an **81-entry two-level NCX**; its 70 「节」 are anchors *inside* those files. The index therefore saw 11 章 and no 节 at all, while the reader's header said 「§3 伦理学与语言」 — the summary claimed to summarize 「本节」 while summarizing a whole chapter file.
   - 《思考快与慢》 ships **182 spine fragments** with a **flat 48-entry NCX**; the 第一部分 / 第N章 hierarchy lives only in the entry titles. The directory popover rendered all 48 rows as siblings and called them 「共 48 节」.
2. **Wording drifted per surface.** The same node was counted as a 章 in one panel and a 节 in another (`全书共 N 章`, `共 N 节`, `第 N 章` for a global ordinal), so the reader could not tell what any number meant.
3. **The product model is hierarchical and adaptive** (user): 章 is the first-level node, 节 is the second-level node, not every book has both, and every summary / companion feature works on the deepest level that actually exists.

## Decision
1. **One vocabulary, one module.** `src/services/bookNodes` owns the three level words (章 / 节 / 段), the level classifier, the book-node shape, the node tree and every count / ordinal / breadcrumb / navigation phrase. No component or prompt hard-codes 章 or 节.
2. **A node is a directory entry when the book has a usable directory**; otherwise it is a spine (or virtual) section. Nodes tile the global continuous character space with non-overlapping `[startOffset, endOffset)` ranges.
3. **Anchors make 节 real.** `extractAnchoredNodeText` reports, in one DOM walk, the line offset of every requested directory anchor inside the spine's normalized plain text, so an anchored 节 gets a text range of its own instead of being a marker on a flat list. Anchors whose id cannot be located are dropped — a phantom chapter is worse than a missing level.
4. **Level = `max(directory-declared depth, title-classifier depth)`.** The directory's own nesting is never discarded, and the classifier only supplies a level the directory failed to express (flat-NCX books). Hierarchy membership is positional, not suffix-based, so 《看见孩子》's 「准则2…」 nest correctly without a 章/节 suffix.
5. **The Minimal Node is the viewpoint.** Summaries, micro-briefs and the companion outline target the deepest level present. Container 章 nodes are structural rows: they are kept even when they own no text of their own, and they never consume a model call.
6. **Physical position ≠ logical node.** The reading context keeps the physical position (`spineIndex` + optional intra-section `anchor`); node ordinals are derived through the node model. `readerStore` therefore renamed `nodeIndex`→`spineIndex` and `setSection`→`setPosition`.
7. **Vocabulary renames end to end** (internal identifiers included): `ChapterNode`→`BookNode`, `chapterId`→`nodeId`, `parentChapterId`→`parentNodeId`, `sectionIndex`→`nodeIndex`, `chapterTitle`→`nodeTitle`, `ChapterSummary`→`NodeSummary`, `chapterSource`→`nodeSource`, `resolveCurrentChapterText`→`resolveCurrentNodeText`, `extractChapterText`→`extractNodeText`. Dexie v5 drops `chapter_nodes` / `chapterSummaries` and creates `book_nodes` / `node_summaries`.

## Consequences
### Positive
- Every surface — directory popover, navigation buttons, shelf progress, summary header, companion search, index progress, panorama outline, system prompt and tool results — answers 「第几章第几节」 from the same model.
- Anchored 节 are first-class: 《何为良好生活》 yields 70 节 with their own text ranges, each slice starting at its own heading line, and each 节 pointing at a real 章 parent (verified end-to-end against the real EPUB; `src/test/realBooks.test.ts`).
- Flat-TOC books stop being mislabelled: their hierarchy is recovered from the titles, and their fragmented spine sections merge back into one node per real chapter.
- The index cost follows the book's real structure instead of the file layout.

### Negative / Trade-offs
- Anchor-derived nodes depend on the directory's anchors resolving to a line in the normalized text; when they do not, the level is silently skipped for that entry.
- A directory may point a 章 and its first 节 at the **same** anchor (《何为良好生活》 does). Same-position entries at different levels are therefore *both* kept: the 节 keeps the anchor and the text, and the 章 retreats to the start of its spine section so its own heading line stays its text. Same-level duplicates still collapse into one node (「版权页」/「序言」); a spine section with no directory entry is merged into the preceding node.
- Front matter that the directory lists at the top level counts as 章 (《何为良好生活》 reports 10 章 = 3 front-matter rows + 8 chapters). The model counts levels, not literary importance.
- The Dexie v5 upgrade drops the pre-v5 index and summary tables rather than migrating them: after upgrading, books must be re-indexed and summaries regenerated (shelf rows, reading progress, conversations and settings are untouched).
- `ParsedBook` gained two required members, so every parser must supply a (possibly empty) directory and anchor list.
- Two of the three sample real books cannot be exercised in the happy-dom test environment at all: its XML parser (used by both the vendored loader and `parseEpub`) rejects 《思考快与慢》's `content.opf` and 《看见孩子》's `toc.ncX` with `XML parsing error`, although both files are well-formed. That is an environment limitation, not a product decision — the flat-TOC rules for those books are covered by unit tests instead (`layeredSegmenter`'s flat-directory case, `ReaderDock`'s flat-NCX case), and the real-book test asserts the honest fallback when the directory is unreadable.

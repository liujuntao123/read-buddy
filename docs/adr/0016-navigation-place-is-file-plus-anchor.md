# ADR 0016: A navigation place is (file, anchor), not an href string

## Status
Accepted — refines ADR 0013 ¶2 (「move in document order, skipping rows that point at where the reader already is」).

## Context
1. **ADR 0013 decided the comparison in terms of `target` equality.** That was enough for the shapes it was written against: a row repeating the current target (`第二章` and `卷二` both → `ch2.xhtml`) had to be skipped, and a row sharing only the *file* (`ch1.xhtml#s1` → `ch1.xhtml#s2`) had to be taken.
2. **《说理》 is a third shape.** Its NCX names each chapter's file twice — the 章 row without an anchor, its first 节 with one:
   ```text
   第2章 哲学为什么关注语言？  -> OEBPS/Text/part0043.xhtml
   §2.1 语言转向               -> OEBPS/Text/part0043.xhtml#id_1
   ```
   (`id_1` is the `<h2 id="id_1">` at the top of that same file.) All 9 chapters of the book have this shape.
3. **The symptom the reader reported** (「位于某一章的第一节时，点击上一节失效」): at `part0043.xhtml#id_1` the rule resolved the current row to §2.1 and then walked backwards onto the 章 row, whose target `part0043.xhtml` is a *different string* — so `isCurrentPlace` said "not where you are" and the step was taken. Its destination resolves to the file's start (no anchor ⇒ anchor `() => 0`), i.e. the page the reader was already looking at. The button was enabled and did nothing, for every chapter. A scan of all 227 directory rows found **27 silent no-ops** in `上一节`.
4. **The mirror defect** was in the current-row ladder: the vendored engine's `TOCProgress.getProgress` resolves a **plain-file** href to the row *preceding* the anchor the viewport has passed (`vendor/foliate-js/progress.js`, `return items[i - 1]`). A plain `part0043.xhtml` therefore means the reader is already **inside** `part0043.xhtml#id_1` — but the ladder's exact-href match picked the first row with that href, which is always the 章 row, and `下一节` then stepped onto the heading the reader had just passed (27 occurrences).

## Decision
1. **A place is `(file, anchor)`.** `splitTarget` decomposes an href into the file it names and its intra-file anchor; targets are compared in that space, never as raw strings.
2. **A row that names the current file with no anchor of its own is 「where the reader already is」.** Such a row can only resolve to the file's start — the place the node the reader is inside begins — so stepping onto it moves nothing. It is skipped in both directions.
3. **A plain-file position resolves to that file's first anchored row**, not to the first exact href match (which is the container 章). This is the engine's own semantics: the plain file is what it reports *after* the first anchor.
4. **Rows that name a different file are never the current place**, and an ordinal target (a segmented TXT book) keeps its previous behaviour — it can never equal an href.
5. **`findPrev` no longer starts at the last row when the position precedes every row.** `from < 0` means there is nothing before the reader; the loop is skipped and only the section fallback applies. (The old code sent a reader at the front of the book to its end.)

## Consequences
### Positive
- 「上一节」 from the first 节 of a chapter reaches the previous 节; 「下一节」 never steps backwards onto the heading just passed. Both verified against the real book and in the browser.
- The rule stays one rule with two adapters: nothing about the fix is engine-specific — the engine's flat rows and the node model's rows publish the same targets, so both are fixed at once.
- `canStep` and `step` still come from the same `find…` function, so the enabled state and the effect cannot diverge (ADR 0013's original guarantee).

### Negative / Trade-offs
- The reader's position is only as precise as the engine reports it: the engine gives a plain file href when several rows share a file, so 「inside the first anchored node」 is an *inference*, not a measurement. A node model that carried the viewport's anchor offset (`BookNode.startOffset`) could compare anchors by order; that needs `NavPosition` to carry more than an href, and was not required to fix the reported defect.
- A 章 row is no longer reachable by 「上一节」 while the reader is inside that chapter. That follows from ADR 0013's own rationale (a row that points at where the reader is moves nothing), and the reader who wants the chapter head has the directory.

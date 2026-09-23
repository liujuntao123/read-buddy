# ADR 0017: 「值不值得总结」 is an offline rule, not a model call

## Status
Accepted

## Context
1. **The summary panel offered its CTA on every node with ≥50 extractable characters.** A 版权信息 page and a printed 目录 page have plenty of characters and no prose, so the reader was invited to summarize a colophon (user report: 版权页 / 目录页 不应该显示总结按钮).
2. **Two ways to answer it were on the table.** A model call could judge 「这一页值不值得总结」 in context, at the cost of a request and a wait each time the reader moves; or a deterministic rule could read the *shape* of the page.
3. **The answer is a property of the file, not of the moment.** A node's text does not change, and the question is asked on every relocate. The reader would pay a model round-trip for a constant.
4. **The corpus says a rule is enough.** 14 real EPUBs (1295 nodes read straight out of the EPUBs, plus 818 nodes through the real foliate pipeline) contain exactly **20** front/back-matter nodes. Their titles are 20/20 clean (`版权信息`, `版权页`, `封面`, `封底`, `扉页`, `书名页`, `目录`), and the pages that a title cannot name — a placeholder-titled spine section (「第 2 节」) that *is* the colophon — are separable by content shape with real margin (see below).

## Decision
1. **One pure function owns the question**: `assessNodeContent({ title, text })` in `services/bookNodes/nodeContent`, returning `prose | cover | copyright | toc | blurb`. It reads no store, calls no model, and is testable with plain values.
2. **Title first, then shape.** Normalized whole-string title match against a deliberately narrow list; then a copyright-page rule (≥2 distinct strong markers inside the head 500 characters **and** ≤1000 characters total); then a 目录-page rule (≥50% 「第N章/§」 lines, or ≥8 lines with median ≤25, max ≤120 and ≤30% sentence-ending lines).
3. **Undecidable means prose.** The failure direction is a button that did not need to be there, never a missing button: the CTA is hidden only on a positive judgement.
4. **The rule never speaks for a whole book.** Only the panel's CTA is gated; the companion index still briefs every minimal node, so 「已索引 N/M」 keeps one meaning and no persisted node status changes.
5. **The panel says why.** Instead of a vanishing button, the node that is not summarizable shows an `info` note naming the page kind (「本页是版权页，没有可提炼的正文内容，无需总结。」), and its status token reads 「版权页」 rather than 「未总结」.

## Consequences
### Positive
- No model call, no latency, no cost for a question asked on every page turn; the answer is identical on a re-read.
- The thresholds are evidence-backed rather than guessed: markers exclude `出版社` / `印刷` / `定价` (an economics chapter uses 定价 six times in the real corpus), the head window keeps a bibliography's tail colophon from branding the whole node, and the 1000-character cap rescues 《何为良好生活》's 「序言」 — a node whose NCX anchor *is* the copyright page.
- 序言 / 前言 / 后记 / 附录 / 索引 / 参考文献 are never blocked; a node whose title equals the book's own is prose.

### Negative / Trade-offs
- A rule can be wrong where a model would not. Measured on the corpus: **20/20 front-matter nodes caught, zero false positives, zero misses**; the residual risks are a pure colophon longer than 1000 characters (the button stays — the safe direction) and a placeholder-titled contents page with fewer than 8 lines.
- Shape thresholds are tuned to Chinese trade publishing. A corpus in another language or from another production pipeline would have to re-measure them; the constants are named and commented so that re-measuring is a one-file change.
- An index page can read as a listing and lose its CTA; the outcome is right (a bibliography has nothing to distill) even though the note calls it 「目录页」.

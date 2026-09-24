# ADR 0005: Unstructured Book Chapter Segmentation and Map-Reduce Summarization Pipeline

## Status
Accepted

## Context
1. **Unstructured Documents**: Not all ebooks possess well-defined native TOCs or spine sections. Large monolithic TXT files, converted PDFs, or single-spine EPUB files treat the entire book as one giant continuous text block.
2. **Long Chapters**: In detailed non-fiction or academic works, individual chapters frequently exceed 12,000 ~ 20,000 characters, risking context window exhaustion, high latency, or degraded summary quality when fed in a single prompt.

## Decision
1. **Adaptive Chapter Segmentation Framework** (three levels, `services/segmentation/layeredSegmenter`):
   - **Structured Books (usable directory)**: take the book's **own TOC entries**, intra-section anchors included, so a directory finer than the spine yields per-节 nodes; fall back to one node per spine.
   - **Unstructured / Monolithic Books**: a regex heuristic detector matrix scores candidate headings and **adopts them automatically at confidence ≥ 0.75** — there is no confirmation dialog (an earlier draft proposed one; it was deleted as noise, see `store/segmentationStore.ts`). The reader sees a short "已识别 N 个章节" toast.
   - **Guaranteed fallback**: fixed-length virtual sections.
2. **Map-Reduce Summarization Pipeline**:
   - For nodes $\le 12{,}000$ characters (`SUMMARY_SINGLE_PASS_MAX_CHARS`): single-turn structured summarization.
   - For longer nodes:
     - **Map Phase**: text is partitioned into blocks with a fixed overlap, serially, one request per block; the map output is material, and it is **not** streamed to the screen.
     - **Reduce Phase**: the material is merged into the authoritative 3-part structured Markdown summary — the only call that streams.
     - UI shows stage feedback (`正在分块提炼 (1/2)...` → `正在合成整{章}脉络...`).

The exact constants, the regex matrix and the prompt wording live in code
(`layeredSegmenter.ts`, `types/ai.ts`, `summary/prompts.ts`) and are asserted by their suites;
this ADR is the record of the shape, not a copy of the values.

## Consequences

### Positive
- Works universally across well-structured EPUBs, raw TXT files, and single-spine monographs without breaking.
- High summary precision for dense 30,000+ word academic chapters without truncating conclusions.

### Negative / Trade-offs
- Map-Reduce on ultra-long chapters requires multiple API calls, resulting in higher latency (~10–25s) and higher token costs than single-turn prompts.

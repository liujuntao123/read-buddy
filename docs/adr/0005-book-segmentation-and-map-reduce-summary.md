# ADR 0005: Unstructured Book Chapter Segmentation and Map-Reduce Summarization Pipeline

## Status
Accepted

## Context
1. **Unstructured Documents**: Not all ebooks possess well-defined native TOCs or spine sections. Large monolithic TXT files, converted PDFs, or single-spine EPUB files treat the entire book as one giant continuous text block.
2. **Long Chapters**: In detailed non-fiction or academic works, individual chapters frequently exceed 12,000 ~ 20,000 characters, risking context window exhaustion, high latency, or degraded summary quality when fed in a single prompt.

## Decision
1. **Adaptive Chapter Segmentation Framework**:
   - **Structured Books (EPUB with TOC)**: Follow the native spine/TOC boundary (`sectionIndex`).
   - **Unstructured / Monolithic Books**:
     - The client runs a regex heuristic detector (e.g. `/(第[0-9一二三四五六七八九十百千]+[章回节卷]|Chapter\s+\d+|SECTION\s+\d+)/i`).
     - If patterns match, candidate Virtual Sections are identified and presented to the user with a prompt: *“检测到该书无目录，已自动识别 N 个章节，是否应用？”*
     - If no patterns match or user declines, the book is chunked into length-based Virtual Sections (default ~6,000 characters per segment).
2. **Map-Reduce Summarization Pipeline**:
   - For chapters $\le 12,000$ characters: Single-turn structured summarization.
   - For chapters $> 12,000$ characters:
     - **Map Phase**: Text is partitioned into logical sub-blocks ($\approx 8,000$ characters with 500-char overlap). Sub-summaries are generated in parallel/sequence.
     - **Reduce Phase**: Sub-summaries are combined and fed into the final prompt to synthesize the authoritative 3-part structured Markdown summary.
     - UI displays clear stage feedback: *“正在分块提炼 (1/2)...”* $\rightarrow$ *“正在合成完整脉络...”*.

## Consequences

### Positive
- Works universally across well-structured EPUBs, raw TXT files, and single-spine monographs without breaking.
- High summary precision for dense 30,000+ word academic chapters without truncating conclusions.

### Negative / Trade-offs
- Map-Reduce on ultra-long chapters requires multiple API calls, resulting in higher latency (~10–25s) and higher token costs than single-turn prompts.

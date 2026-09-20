---
id: "001"
title: "readest-plus Core Architecture & AI Companion Specification"
status: "open"
blocked_by: []
labels: ["ready-for-agent"]
---

## Problem Statement

Avid digital readers using desktop e-book readers face substantial friction when seeking AI-assisted comprehension:
1. **High Setup & Time Cost in Existing Tools**: Tools like `readest` (via its Reedy experimental subsystem) rely on upfront vector embeddings and Tantivy indexing. For large books (500k+ words), this introduces minutes of indexing delays, heavy token expenditure, and high RAM usage before a reader can ask a single question.
2. **Lack of Instant Structural Insight**: When moving into a new chapter, readers must either read blindly or switch context out of their reader into an external browser tab or chat app to copy-paste passages for summarization.
3. **Disruptive Reading UX**: Modal dialogs and floating chat bubbles cover the reading text, forcing readers to constantly open and close popups. Transparent sliding-window context truncation in chatbots causes "invisible amnesia", confusing users about what the assistant remembers.
4. **Poor Support for Unstructured Books**: Unformatted monolithic TXT or single-spine files have no chapter boundaries, breaking section-aware assistants.

## Solution

`readest-plus` delivers a **Zero-Embedding, Chapter-First Desktop AI Reading Companion**:
1. **Instant, Zero-Wait Chapter Perception**: Operates without full-book vector embeddings. When entering any chapter, text is extracted directly from the Foliate engine spine on demand.
2. **Explicit Reader-Driven Control**: Chapter summarization is strictly manual (via a clean action card) to prevent wasteful background token consumption while skimming.
3. **Adaptive Segmentation & Map-Reduce**: Automatically detects chapters in unformatted books using regex heuristics with a user-confirmation prompt (or fixed-length chunking fallback). Dense long chapters (>12,000 chars) are processed using a two-stage Map-Reduce pipeline.
4. **Dual-Pane Resizable Workspace**: The main reading viewport sits side-by-side with a resizable AI sidebar (320px–600px).
5. **Turn-Bounded Discussions**: Replaces invisible history slicing with an explicit, user-visible Turn Quota (default 10 turns) per topic.
6. **Unified Selection Annotator**: AI actions (Explain, Translate, Ask, Summarize) integrate directly into the reader's native text selection toolbar.

## User Stories

1. As a reader opening a book, I want to access AI features immediately without waiting for a lengthy background indexing or embedding process.
2. As a reader, I want to see my book in the left pane and the AI companion in the right pane simultaneously, so that my reading flow is never blocked by modal popups.
3. As a reader, I want to drag the split divider between 320px and 600px, so that I can balance text reading space and conversation width according to my screen size.
4. As a reader, I want to toggle the AI sidebar using a header icon or `Ctrl+/` (`Cmd+/`), so that I can immerse myself in full-screen reading whenever desired.
5. As a reader opening an AI Companion for the first time, I want to configure any OpenAI-compatible provider (DeepSeek, OpenAI, Claude via proxy, local Ollama) by specifying Base URL, API Key, and Model ID.
6. As a reader, I want my API Key stored locally in plaintext without complex OS Keychain setup, while visually masked in the settings UI.
7. As a reader entering a new chapter, I want to see an empty-state card with a "Generate Summary" button rather than having the app automatically burn API tokens in the background.
8. As a reader who clicks "Generate Summary", I want to see the summary stream into three structured sections (Core Takeaways, Outline, Key Concepts).
9. As a reader returning to a previously summarized chapter, I want the summary to load instantly from local IndexedDB cache without re-requesting the LLM.
10. As a reader, I want a "Regenerate" button on cached summaries, so that I can refresh the summary if I switch models or want a different perspective.
11. As a reader opening a 30,000-character long chapter, I want the system to handle it via a Map-Reduce pipeline with progress indicators, so that the summary is accurate and does not crash the context window.
12. As a reader importing a monolithic TXT file with no TOC, I want the app to detect chapters using regex patterns and ask me whether to generate Virtual Sections.
13. As a reader with an unformatted book where regex fails, I want the app to fall back to fixed-length virtual chunking (6,000~8,000 chars), so that chapter summarization still functions.
14. As a reader with questions about the current chapter, I want to chat in the companion sidebar with the chapter text automatically injected as context, while guaranteeing no future plot spoilers.
15. As a reader in a conversation thread, I want to see a clear turn counter (e.g. `💬 3/10 turns`), so that I know exactly how much budget remains for the topic.
16. As a reader who reaches the 10-turn limit, I want the UI to prompt me to start a new topic or export the conversation, ensuring conversational coherence without silent message truncation.
17. As a reader highlighting text in the book, I want AI actions (Explain, Translate, Ask, Summarize) to appear directly on the native annotator toolbar.
18. As a reader clicking "Ask AI" on highlighted text, I want the text to populate the companion input box as a blockquote, with focus ready for my question.
19. As a reader switching reader themes (Day White, Sepia Yellow, Night Dark), I want the AI companion sidebar colors to follow the theme seamlessly.
20. As a reader on a narrow laptop screen (<768px), I want the dual-pane sidebar to adapt into an overlay drawer, preserving reader typography.

## Implementation Decisions

### Modules and Boundaries
1. **Container & Shell**: Tauri 2 (Rust + OS WebView2/WebKit), aligning with upstream `apps/readest-app` and rejecting Electron.
2. **Reader Spine & Text Extractor**:
   - For structured books: queries Foliate spine sections (`bookDoc.sections[sectionIndex].load()`).
   - For unstructured books: manages a `BookSegmentation` state machine producing `VirtualSection` records.
3. **AI Pipeline & Streaming Engine**:
   - Leverages Vercel AI SDK (`ai` and `@ai-sdk/openai-compatible`).
   - Implements `SinglePassSummarizer` ($\le 12,000$ chars) and `MapReduceSummarizer` ($> 12,000$ chars).
4. **State Store (`aiSidebarStore`)**:
   - Manages sidebar expansion, active tab (`summary` | `chat`), drag width, active chapter summary status, and streaming abort controllers.
5. **Selection Bridge**:
   - Hooks into Foliate/Readest `AnnotatorToolbar` component, injecting an AI action menu alongside highlight and note tools.
6. **Local Persistence**:
   - IndexedDB stores `AISettings` (plaintext key, masked in UI), `BookSegmentation`, `ChapterSummary`, `Conversation`, and `Message`.

### Core Schemas

```typescript
interface AISettings {
  provider: 'openai-compatible' | 'deepseek' | 'claude' | 'ollama';
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTurnsPerTopic: number; // default: 10
}

interface ChapterSummary {
  id: string; // `${bookHash}_${sectionIndex}`
  bookHash: string;
  sectionIndex: number;
  chapterTitle: string;
  modelUsed: string;
  summaryContent: string;
  pipeline: 'single' | 'map-reduce';
  createdAt: number;
  updatedAt: number;
}

interface Conversation {
  id: string;
  bookHash: string;
  sectionIndex?: number;
  title: string;
  turnCount: number;
  isClosed: boolean;
  createdAt: number;
  updatedAt: number;
}
```

## Testing Decisions

### Seams and Test Strategy
1. **Highest Functional Seam - Adapter & Pipeline Level**:
   - Test `ChapterSummarizer` with mock stream responses: verify that text $\le 12,000$ chars invokes single-turn prompt, while text $> 12,000$ chars triggers chunking and Map-Reduce synthesis.
   - Test `BookSegmenter`: feed sample TXT strings containing `第一章 ... 第二章 ...` and verify regex partition into Virtual Sections.
2. **State Store Seams**:
   - Test `aiChatStore` / `ConversationManager`: verify that adding a user + assistant pair increments `turnCount`; verify that when `turnCount === maxTurnsPerTopic`, `isClosed` becomes `true` and subsequent sends are blocked until a new topic starts.
3. **Cache Seams**:
   - Test `SummaryCacheRepository`: verify retrieval by `${bookHash}:${sectionIndex}`, cache hit bypasses LLM call, and "regenerate" forces cache overwrite.
4. **Behavioral Black-Box Tests**:
   - Prior art: existing Vitest unit and browser tests in `apps/readest-app` (`vitest.config.mts`). All unit tests verify input-to-output behavior without mocking internal React hooks.

## Out of Scope

1. **Whole-book vector embeddings and semantic graph search**: Left to upstream Reedy subsystem as an optional advanced mode.
2. **Text-to-Speech (TTS) voice generation within AI Companion**: Managed separately by native Readest TTS engine.
3. **Cloud cross-device synchronization of AI chat logs**: Chat and summaries are strictly local-first.
4. **Third-party plugin system**: Extensibility is achieved via standard OpenAI-compatible endpoints.

## Further Notes

- Architecture decisions recorded in `docs/adr/0001` through `docs/adr/0008` constitute mandatory references for all subsequent tracer-bullet implementation tickets.

<div align="center">

# Readest+

**A zero-embedding, chapter-first desktop AI reading companion**

Your book on the left, summaries, questions and highlights on the right — everything it takes to understand a book, in one window.

[![CI](https://github.com/liujuntao123/readest-plus/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/liujuntao123/readest-plus/actions/workflows/ci.yml)
[![Release](https://github.com/liujuntao123/readest-plus/actions/workflows/release.yml/badge.svg)](https://github.com/liujuntao123/readest-plus/actions/workflows/release.yml)
[![Latest release](https://img.shields.io/github/v/release/liujuntao123/readest-plus?color=blue)](https://github.com/liujuntao123/readest-plus/releases)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows-0078D4.svg)](#-install)

[简体中文](README.md) · **English**

</div>

---

## What it is

Readest+ is a desktop e-book reader for Windows, built for one very specific problem: **you cannot get through a book**.

Reading calls on attention and comprehension at once — eyes scanning the words, the mind parsing meaning and holding the thread, without ever letting up — and in an age that slices attention into pieces, sustaining that for long stretches is genuinely hard. So the problem it sets out to solve is not "how do I pretend to have finished a book" but **how to make the reading itself less painful, so that you stay in the state of reading**.

Summarising a whole book in seconds and generating a mind map is convenient, but knowledge does not enter your head because it passed through a model — **an AI having read it is not you having read it**.

What a reader needs, then, is a reading exoskeleton that answers in real time: summarising, explaining and locating, but never doing the understanding for you or manufacturing fake reading.

The app has two regions:

1. **A modest but sufficient reader** — library, table of contents, typography, themes, highlights; with no model configured it is a complete local reader.
2. **An AI companion sidebar** — two features for two kinds of reading:
   - **Current-section summary** for **roaming reading** (no stated goal, following a passing interest; once attention drifts there is nothing to pull you back): spend a few minutes on the summary to see the whole section and notice which passages and topics actually interest you, then read those in the original text — the barrier to entry drops sharply.
   - **Free-form questions** for **goal-driven reading** (the book is linear, your questions are points): ask at any moment, and the answer is not confined to the current page — it draws on the whole book, sparing you the hunt through hundreds of pages.

It will not suit everyone, but if reading has been hard for you for years, this reader — less powerful than most, and perhaps useful precisely because of it — may be worth a try.

## How it differs from other readers and "read the book for me" AI tools

Readers are never in short supply; what is missing is one you can stay with. Compared with a feature-complete reader and with AI tools that finish a book in seconds, the choices here are different:

| | The usual approach | Readest+ |
| --- | --- | --- |
| **Getting started** | Embed the whole book first; a 500k-word title means minutes of waiting | Open it and read; no whole-book precomputation |
| **What the AI is for** | Reading for you: whole-book summaries, mind maps and digest notes in seconds | Reading with you: summaries, answers and pointers — the understanding and the internalising stay yours |
| **Notes and output** | Notes, mind maps and a knowledge base for everything — you can switch your brain off while reading | Highlights and typography only, no written notes — less output, more reading |

In one line: it does not try to finish the book for you; it tries to keep you reading it.

## ✨ Features

### 📚 Reading

- **Formats**: EPUB, MOBI/AZW3, FB2, CBZ comics and plain TXT (PDF is not supported yet — see [formats](#-supported-formats))
- **Real table of contents**: parsed from the book's own NCX / nav document, collapsible and clickable; a TXT with no TOC is split automatically on `Chapter N`-style headings
- **Two ways to read**: single- or double-page, with continuous cross-chapter scrolling in single-page mode; in double-page mode hovering the left or right edge reveals a page-turn button (engine books, click to turn)
- **Three themes**: Day, Sepia and Night — the companion sidebar follows along
- **Typography on your terms**: font size, typeface (eight options, including serif and kai faces), line height, paragraph spacing, content width, page margin and column gap — applied live and saved automatically (width and margin apply to engine books; the plain-text reader uses a fixed measure)
- **Library management**: covers, search by title or author, sort by recently read / date added / title / size, grid and list views, reading progress
- **Desktop integration**: `.epub`, `.mobi`, `.azw3`, `.fb2` and `.cbz` are registered file associations — double-click one to open it here; use the import button in the header to add books

### ✨ AI companion

- **Three-part node summaries**: Core takeaways · Outline of the content · Key concepts and terms — a fixed shape, so summaries are comparable across a book
- **Automatic map-reduce for long nodes**: any node (chapter / section / chunk) over 12,000 characters is summarised in two passes instead of being crammed into one context
- **Local cache**: summaries are cached per book and node, so revisiting a section costs nothing; regenerate when you switch models
- **Whole-book panorama and reading index**: one action produces a book-wide portrait (genre, theme, world setting, main characters) plus a micro-brief for every minimal node
- **A conversation with the whole book in view**: context is assembled from four layers — the panorama, the outline of micro-briefs, the current node's text, and your quote
- **A companion that reads ahead for you**: before answering it can look up a node's text or search the whole book, pin the passages it found as evidence cards under its reply (click one to jump back), and show its tool calls in a collapsible trace
- **An explicit turn cap**: 10 turns per topic by default (5–20 configurable), with the remaining count always visible; at the limit it offers a fresh topic instead of silently dropping history
- **Topic history**: switch back to an earlier topic or copy a whole conversation

### 🖍 Highlights and notes

- Select text to highlight it; highlights persist and are repainted every time their chapter is rendered
- **Highlights panel**: every mark in the book in document order, labelled with its `chapter › section` location, click to jump back
- **Undo, not a confirm dialog**: deleting a highlight leaves a five-second undo window
- **One-click export**: copy every highlight as Markdown grouped by location, ready to paste into your notes
- Any single highlight can be sent to the AI: it lands as a quote draft above the composer, with the cursor ready for your question

### 🔌 Model support

- Any **OpenAI-compatible** Chat Completions endpoint: DeepSeek, OpenAI, Ollama, vLLM, a self-hosted gateway
- Provider presets fill in the Base URL; pull the endpoint's model list and search it, or type a model ID by hand
- Test the connection before you save

## 📦 Supported formats

| Format | Extensions | Rendering |
| --- | :--- | --- |
| EPUB | `.epub` | Foliate engine, paginated or scrolled |
| Kindle | `.mobi` `.azw` `.azw3` `.prc` | Foliate engine |
| FictionBook | `.fb2` `.fbz` | Foliate engine |
| Comics | `.cbz` | Foliate engine |
| Plain text | `.txt` | Built-in reader, split on headings or by length |
| PDF | `.pdf` | Not supported |

## 🚀 Install

**Windows 10 / 11 (x64)**

1. Download the latest `readest-plus_x.y.z_x64-setup.exe` from [Releases](https://github.com/liujuntao123/readest-plus/releases/latest);
2. Run the installer;
3. On first launch Windows SmartScreen may warn about an unknown publisher — the installer is not code-signed yet. Choose **More info** → **Run anyway**.

> Want to follow every commit? CI uploads the installer built from each push to `master` as a build artifact — see [Actions](https://github.com/liujuntao123/readest-plus/actions/workflows/ci.yml).

## 🏁 Quick start

**1. Import a book**
Use the import button in the header and pick an `.epub` / `.txt` file.

**2. Configure a model**
Press `Ctrl + /` to open the companion sidebar, then the ⚙️ in its corner. Fill in the provider, Base URL, API key and model ID, test the connection, and save. Common combinations:

| Provider | Base URL | Model ID |
| --- | --- | --- |
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |
| Local Ollama | `http://localhost:11434/v1` | `qwen2.5:7b` |

> A non-empty API key is required for every provider today, so give a local Ollama / vLLM endpoint a placeholder value (e.g. `ollama`).

**3. Summarise a section**
Move to the section you want, open the **Summary** tab and press **Summarise this section**; the three-part summary streams in.

**4. Ask questions**
Switch to the **Companion** tab and type. You can also select text and choose **Ask AI** from the floating toolbar.

**5. Highlight**
Select text and press **Highlight**, then revisit everything from the **Highlights** tab.

## ⌨️ Keyboard shortcuts

| Key | Action |
| --- | --- |
| `←` `→` | Turn the page (double-page) / scroll (single-page) |
| `Space` | Page forward / scroll down |
| `Esc` | Dismiss the selection toolbar |
| `Ctrl + /` | Toggle the AI companion sidebar |
| `Enter` / `Shift + Enter` | Send / newline in the chat composer |

## 🔒 Privacy

- Your library, reading progress, highlights, summary cache and conversations live in **local IndexedDB** on your machine. Nothing is uploaded and nothing syncs across devices.
- **API keys are stored in plain text locally** (masked in the settings UI). That is a deliberate trade-off — no OS keychain dependency — and it means you should think twice on a shared machine.
- Text leaves your machine only for the summaries, panorama and chat turns **you** trigger, and only to the provider you configured. There is no telemetry, no account, and no update check.

## ❓ FAQ

**Why do I have to press "Summarise" every time?**
Because pre-generating means paying for every section you skim past. Handing you the trigger is the point.

**Why do some pages have no "Summarise" button?**
A copyright page, a table of contents or a cover has no prose to distil, so the button is hidden and the page tells you what it is. That call is made by a local rule — no request is spent on it. A scanned (image-only) book genuinely has no text to extract.

**Will the AI spoil what I have not read yet?**
The conversation's context includes the whole-book panorama and the outline of micro-briefs, which is exactly what lets it answer "where does this section sit in the book?". If you would rather it stayed off later plot points, say so in your question.

**I switched models, but the old summary is still there.**
Summaries are cached per book and node, and changing models does not invalidate them. Use **Regenerate** to redo one with the new model.

**Is there a macOS or Linux build?**
Only a Windows installer is published today. The shell is Tauri 2, so a port is planned but unscheduled.

**Do I need an AI provider to use it?**
No. Without a model configured it is a complete local reader: library, table of contents, typography, themes and highlights all work.

## 🛠 Development

You need **Node.js 24+**, **pnpm 12+**, and **Rust stable** to build the desktop shell.

```bash
pnpm install          # install dependencies
pnpm dev              # Next.js dev server (debug the reader and companion in a browser)

pnpm typecheck        # tsc --noEmit
pnpm test             # vitest run
pnpm build            # Next.js static export
pnpm build:installer  # build the Windows NSIS installer
pnpm verify           # version + types + tests + build — the full pre-commit gate
```

**Stack**

| Layer | Choice |
| --- | --- |
| Desktop shell | Tauri 2 (Rust + system WebView) |
| Frontend | Next.js 16 (static export) + React 19 + TypeScript |
| State | Zustand 5 |
| Rendering engine | Foliate-js (vendored) |
| AI | Vercel AI SDK + `@ai-sdk/openai-compatible` |
| Persistence | IndexedDB (Dexie) |
| Tests | Vitest 5 + happy-dom + Testing Library |

**Layout**

```
apps/readest-app/
  src/app/          Next.js App Router shell and global styles
  src/components/   UI (library, reader, companion sidebar, settings)
  src/services/     Core logic: parsing, segmentation, summary, chat, AI, storage, reading agent
  src/store/        Zustand stores
  src/types/        Domain types (single source of truth)
  src/hooks/        Reusable hooks (selection, edge hover, viewport width)
  src/theme/        Astryx themes (day / sepia) and the reading-theme mapping
  src/test/         Test bootstrap and real-book cases
  vendor/           The vendored foliate-js rendering engine
  src-tauri/        Tauri desktop shell and bundling config
scripts/            Version and changelog tooling
docs/               Architecture, ADRs, release process
```

Before diving into the code, read [`CONTEXT.md`](CONTEXT.md) (the domain glossary — this project is opinionated about its vocabulary), [`docs/architecture.md`](docs/architecture.md) (module map and the invariants that cross modules), [`docs/adr/`](docs/adr/) (architecture decision records) and [`docs/agents/`](docs/agents/).

## 📝 Changelog

Every release is documented in **[CHANGELOG.md](CHANGELOG.md)** and on the [Releases](https://github.com/liujuntao123/readest-plus/releases) page.

The changelog is generated from git history using [Conventional Commits](https://www.conventionalcommits.org/); the release process is documented in [`docs/releasing.md`](docs/releasing.md) (Chinese).

## 🗺 Planned

Considered, but **unscheduled and not a commitment**:

- More built-in themes and custom themes
- Highlight export to HTML / rich text
- macOS and Linux builds
- PDF support
- Code signing for the installer

## 🤝 Contributing

- **Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/)** (`feat(reader): …`, `fix(app): …`). The changelog is generated from them, so a good commit message *is* the release note.
- Run `pnpm verify` (version consistency + typecheck + tests + build) before you push.
- Read the relevant `docs/adr/` and `CONTEXT.md` first: the project enforces its domain vocabulary in code and docs alike.
- Releases are cut by maintainers — see [`docs/releasing.md`](docs/releasing.md).

## 📄 License

[MIT](LICENSE).

Bundled third-party components keep their own licenses; see the end of [LICENSE](LICENSE) (the vendored [foliate-js](https://github.com/johnfactotum/foliate-js) is MIT).

## 🙏 Acknowledgements

- [readest](https://github.com/readest/readest) — this project owes much of its architecture and interaction design to it
- [foliate-js](https://github.com/johnfactotum/foliate-js) — the paginated rendering engine
- [Tauri](https://tauri.app/) · [Next.js](https://nextjs.org/) · [Vercel AI SDK](https://sdk.vercel.ai/)

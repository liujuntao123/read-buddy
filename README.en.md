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

Readest+ is a desktop e-book reader for Windows with an AI reading companion built into the reading surface itself.

It does not build a vector index for the whole book up front, and it does not quietly spend tokens in the background: **it understands the section you are looking at, and summaries and questions happen only when you ask for them.**

If you like to look things up, map out an argument, and keep highlights while you read — and you are tired of copying passages back and forth between a reader and a browser tab — this was built for you.

## How it differs from "a reader plus an AI chat window"

| | The usual approach | Readest+ |
| --- | --- | --- |
| **Getting started** | Embed the whole book first; a 500k-word title means minutes of waiting | Open it and read; no whole-book precomputation |
| **Token spend** | Generated automatically in the background — even while you skim | Summaries, panorama and chat are all triggered by hand: one click, one request |
| **Where the AI lives** | A modal covering the text, or another app entirely | Side by side and drag-resizable; a drawer on narrow screens |
| **What it remembers** | History is truncated silently; you cannot tell what it still knows | Every topic has a visible turn cap, with the remaining count on screen |
| **Where your data is** | Uploaded to a cloud | Library, progress, highlights, summaries and chats stay on your machine |

## ✨ Features

### 📚 Reading

- **Formats**: EPUB, MOBI/AZW3, FB2, CBZ comics and plain TXT (PDF is not supported yet — see [formats](#-supported-formats))
- **Real table of contents**: parsed from the book's own NCX / nav document, collapsible and clickable; a TXT with no TOC is split automatically on `Chapter N`-style headings
- **Two ways to read**: single- or double-page, continuous scrolling in single-page mode, and click-the-edge page turns
- **Three themes**: Day, Sepia and Night — the companion sidebar follows along
- **Typography on your terms**: font size, typeface (eight options, including serif and kai faces), line height, paragraph spacing, content width, page margin and column gap — applied live and saved automatically
- **Library management**: covers, search, sort by recently read / date added / title / size, grid and list views, reading progress
- **Desktop integration**: double-click an `.epub` to open it in Readest+, or drag files anywhere onto the window to import

### ✨ AI companion

- **Three-part node summaries**: Core takeaways · Outline of the content · Key concepts and terms — a fixed shape, so summaries are comparable across a book
- **Automatic map-reduce for long sections**: anything over 12,000 characters is summarised in two passes instead of being crammed into one context
- **Local cache**: summaries are cached per book and node, so revisiting a section costs nothing; regenerate when you switch models
- **Whole-book panorama and reading index**: one action produces a book-wide portrait (genre, theme, world setting, main characters) plus a micro-brief for every minimal node
- **A conversation with the whole book in view**: context is assembled from four layers — the panorama, the outline of micro-briefs, the current node's text, and your quote; answers carry citations that jump back to the text
- **An explicit turn cap**: 10 turns per topic by default (5–20 configurable), with the remaining count always visible; at the limit it offers a fresh topic instead of silently dropping history
- **Topic history**: switch back to an earlier topic or copy a whole conversation

### 🖍 Highlights and notes

- Select text to highlight it; highlights persist and are repainted every time their chapter is rendered
- **Highlights panel**: every mark in the book in document order, labelled with its `chapter › section` location, click to jump back
- **Undo, not a confirm dialog**: deleting a highlight leaves a five-second undo window
- **One-click export**: copy every highlight as Markdown grouped by location, ready to paste into your notes
- Any single highlight can be sent to the AI, landing in the chat composer as a quote

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
Use the import button in the header, or drag an `.epub` / `.txt` straight onto the window.

**2. Configure a model**
Press `Ctrl + /` to open the companion sidebar, then the ⚙️ in its corner. Fill in the provider, Base URL, API key and model ID, test the connection, and save. Common combinations:

| Provider | Base URL | Model ID |
| --- | --- | --- |
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |
| Local Ollama | `http://localhost:11434/v1` | `qwen2.5:7b` |

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

**The model says the current node has no usable text.**
Some EPUBs load their chapter text asynchronously — wait a moment, or turn a page and retry. A scanned (image-only) book genuinely has no text to extract.

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
  src/app/          Next.js App Router shell
  src/components/   UI (library, reader, companion sidebar, settings)
  src/services/     Core logic: parsing, segmentation, summary, chat, AI, storage
  src/store/        Zustand stores
  src/types/        Domain types (single source of truth)
  src-tauri/        Tauri desktop shell and bundling config
scripts/            Version and changelog tooling
docs/               Design docs, ADRs, release process
```

Before diving into the code, read [`CONTEXT.md`](CONTEXT.md) (the domain glossary — this project is opinionated about its vocabulary), [`docs/adr/`](docs/adr/) (architecture decision records) and [`docs/agents/`](docs/agents/).

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

# readest-plus

Zero-embedding, chapter-first desktop AI reading companion (AI 增强型桌面端深度阅读客户端).

Architecture follows `docs/readest-plus 桌面端应用设计文档.md` and the ADRs under `docs/adr/`:

- **Frontend**: Next.js 16 + React 19 + TypeScript (`apps/readest-app`)
- **State**: Zustand 5 (`readerStore`, `aiSidebarStore`, feature stores)
- **AI**: Vercel AI SDK (`ai` + `@ai-sdk/openai-compatible`)
- **UI**: Tailwind CSS v4 + DaisyUI 5 + Lucide
- **Persistence**: IndexedDB via Dexie (plaintext local credentials, ADR 0008)
- **Tests**: Vitest 5 + happy-dom + @testing-library/react + fake-indexeddb

## Commands

```bash
pnpm install        # install all workspace dependencies
pnpm dev            # start the Next.js dev server
pnpm typecheck      # tsc --noEmit
pnpm test           # vitest run (single pass)
pnpm test:watch     # vitest watch mode
pnpm build          # production build
```

## Layout

```
apps/readest-app/
  src/app/            # Next.js App Router shell
  src/components/     # UI components (workspace, reader, sidebar, settings)
  src/store/          # Zustand stores
  src/services/       # Core logic: db, reader, segmentation, summary, chat, ai
  src/types/          # Shared domain types (single source of truth)
```

Issues are tracked locally under `.scratch/issues/` (see `docs/agents/issue-tracker.md`).

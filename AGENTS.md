# read-buddy Agent Configuration

This document specifies conventions and skill links for AI coding agents operating on `read-buddy`.

## Agent skills

### Issue tracker

Issues are tracked locally as Markdown files under `.scratch/issues/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Canonical 5-state triage vocabulary mapped 1:1. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout (`CONTEXT.md` at root, ADRs under `docs/adr/`). See `docs/agents/domain.md`.

### Architecture

`docs/architecture.md` is the module map plus the invariants that cross module boundaries
(node vocabulary, physical-vs-logical position, the offset space, the one navigation rule).
Read it before changing anything under `src/services/` or `src/store/`. Behaviour, constants
and wording belong to the code; the ADRs record why.

## Verification

Default to cheap checks — typecheck, unit tests, diff review — which catch most defects in a fraction of the time.

A visual pass (screenshot, browser session, manual UI run) earns its cost only when the change is itself visual: layout, styling, rendering. One pass settles that change; logic, data, config, and refactor changes need none.

## Release and packaging

The version number lives in five files and is written **only** by `scripts/version.mjs`
(`pnpm version:check` gates every CI run). `CHANGELOG.md` is generated from Conventional
Commits by `scripts/changelog.mjs` and must never be hand-edited. A release is
`pnpm release <version>`. Full process: `docs/releasing.md`.

<!--### Post-task Windows build

After completing each feature, fix, or delivery task:
1. Verify type safety and tests: `pnpm verify` (`tsc --noEmit && vitest run && next build`).
2. Build a fresh Windows installer: `pnpm build:installer` (or `pnpm --filter read-buddy-app tauri build`).
   - Installer output: `apps/read-buddy-app/src-tauri/target/release/bundle/nsis/read-buddy_<version>_x64-setup.exe`.-->

<!-- ASTRYX:START -->
Astryx v0.6.2 · 90+ components
CLI: run every command as `pnpm dlx @astryxdesign/cli <cmd>` (shown below as `astryx ...`).

SETUP (once, in your app entry e.g. main.tsx) — without these, components render unstyled:
  import "@astryxdesign/core/reset.css";
  import "@astryxdesign/core/astryx.css";

WORKFLOW — discover, don't guess. Before writing UI:
1. `astryx build "<idea>"` — START HERE: returns a kit (closest [page] + [block]s + [component]s). No args = full playbook.
2. `astryx template <name> [--skeleton]` — scaffold the [page]/[block]s it named, or study their layout. Templates are reference code.
3. `astryx component <Name>` — props + examples for every component you use.

RULES:
- No <div> — components do all layout/spacing, page frame included.
- Frame first: read `astryx docs layout` before writing any page or screen — page frame, region widths, breakpoint behavior.
- Dense data = rows (Table, List/Item), never Card-wrapped list items; Card is for standalone widgets. Status = StatusDot/Token; Badge = counts only.
- Custom styling: component props first; else style/className with tokens — var(--color-*|--spacing-*|--radius-*). No raw hex/px. (No StyleX/Tailwind compiler here — don't use xstyle/utility classes.)
- Tokens for every value (`astryx docs tokens`). Brand/accent belongs in the theme (`astryx theme list` / `theme add <slug>`, or `astryx theme template` for a custom one) — never override --color-* in :root.
- SELF-CHECK before you finish: re-read the file and replace any raw <div>/<span> layout, imported .css/@apply, or hardcoded value (#hex, 16px) with the component or a token (var(--color-*|--spacing-*|…)). If unsure a component/prop exists, run `astryx component <Name>` / `astryx search "<thing>"`; don't hand-roll CSS.

MORE CLI:
  search "<query>"   find any component / hook / doc / template / block
  component --list   90+ components by category
  template --list    page + block recipes
  docs <topic>       browser-support, cli-integrations, color, elevation, getting-started, icons, illustrations, internationalization, layout, migration, motion, principles, shape, spacing, styling-libraries, styling, theme, tokens, typography, working-with-ai
  swizzle <Name>     eject component source for deep customization
  upgrade --apply    run after any Astryx or integration dependency bump
<!-- ASTRYX:END -->

# ADR 0014: Store seam convention — inject what varies, don't wrap what doesn't

## Status
Accepted

## Context
1. **Three ways to reach a store had grown up**, with no rule saying which to use:
   a factory plus singleton (5 stores), a component prop (2 components), and a
   **mutable module global** that tests rewrote (`setSummaryStore`,
   `setSegmentationRepository`).
2. **The module globals were the actual defect.** `SummaryTab` called
   `getSummaryStore()` *inside render*, so it read a mutable global on every
   render; `setSegmentationRepository` let a test repoint the app singleton at an
   isolated database, which meant `libraryStore`'s dependency on the segmentation
   store was invisible in its own signature.
3. **A blanket "every store gets a factory" rule would be ceremony.** Three stores
   (`readerStore`, `readerSettingsStore`, `aiSidebarStore`) are pure state with no
   dependency to inject: their factory would take no arguments and return exactly
   what the singleton already is.
4. **Tracing the cost of the missing rule:** the `chatStore`'s own store, when built
   by a factory, still reached a *singleton* segmentation store through the Node
   View's app-edge binding — a coupling that only surfaced when a test tried to
   isolate it.

## Decision
1. **A store that has dependencies takes them as factory arguments.** All six such
   stores do: `aiSettings`, `bookIndex` (an ingestion module), `chat`, `library`
   (a database, an engine factory, a segmentation store), `segmentation` (a
   repository resolver), `summary`.
2. **A store with no dependencies stays a plain singleton.** Wrapping dependency-free
   pure state in a factory adds a layer and buys no isolation. The three stores in
   this class are named in this ADR so the difference reads as a rule rather than an
   oversight.
3. **No mutable module globals for swapping a store or its dependencies.** Both
   `setSummaryStore` and `setSegmentationRepository` are deleted; a test that wants
   an isolated store builds one and passes it in. Verified: no
   `setXStore`/`setXRepository` exports remain.
4. **A component that needs an injectable seam takes it as a prop defaulted to the
   singleton** (`Bookshelf`, `ChatTab`, `SummaryTab`). A component with no such need
   reads the singleton directly — that is not a third idiom, it is the unremarkable
   case.
5. **A repository resolver is a function, not a value**, where constructing it would
   open IndexedDB on module import.

## Consequences
### Positive
- `libraryStore`'s dependency on the segmentation store is in its type
  (`LibraryStoreDeps.segmentationStore`), so a reader of its signature sees it.
- `SummaryTab` no longer reads a mutable global during render.
- Tests stop depending on mutation order between files: an isolated store is a local
  value.
- The convention is compact enough to state in one line: *inject what varies, don't
  wrap what doesn't.*

### Negative / Trade-offs
- The rule needs judgement: "does this store have a dependency?" is a question a
  contributor answers, not a lint. This ADR is the record of the answer for the nine
  stores that exist today.
- `createLibraryStore({ segmentationStore })` must be threaded by any test that
  exercises the TXT open flow, which is more visible — and more honest — than the
  global it replaced.
- The Node View's app-edge binding still reads the singleton segmentation store by
  design (it is the app's edge), so a test that injects a *different* segmentation
  store will not see segmentation through the Node View. That is a real limit of the
  current seam, recorded here rather than papered over.
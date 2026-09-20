# ADR 0007: Integration of AI Selection Actions with Native Annotator Toolbar

## Status
Accepted

## Context
When a reader highlights text in the reader viewport, two interaction approaches exist for AI actions (Explain, Translate, Ask, Summarize):
1. **Isolated AI Floating Menu**: Spawns a completely separate popup adjacent to the cursor, leading to visual clutter, overlay collisions, and double-popup flickers when competing with the native reader annotation/highlight toolbar.
2. **Native Annotator Toolbar Extension**: Injects AI action triggers directly alongside existing reader actions (Highlight, Note, Copy) within the native floating selection toolbar.

## Decision
We choose **Native Annotator Toolbar Extension**:
- AI actions are appended as an extension group to the native Foliate/Readest selection toolbar.
- Actions dismiss automatically when clicking outside or clearing the selection.
- Clicking an AI action seamlessly opens or focuses the AI Companion sidebar.

## Consequences

### Positive
- **Visual Cleanliness**: Exactly one unified floating toolbar appears on text selection.
- **Natural Ergonomics**: Follows existing reading muscle memory without introducing floating overlay overlap.

### Negative / Trade-offs
- Tightly couples the action trigger to the upstream annotator component lifecycle.

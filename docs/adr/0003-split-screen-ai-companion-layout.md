# ADR 0003: Resizable Split-Screen Companion Layout Over Floating Modal

## Status
Accepted

## Context
When reading a book alongside an AI copilot, interaction designs typically fall into three patterns:
1. **Modal Dialog / Popup**: Centered overlay that occludes book text while active.
2. **Bottom Sheet / Floating Drawer**: Slides in over the text, requiring toggle to view underneath.
3. **Split-Screen Dual-Pane Layout**: Main reader window and AI sidebar side-by-side with a movable divider.

## Decision
We choose the **Resizable Split-Screen Dual-Pane Layout** as the primary reading interface for desktop environments, with adaptive drawer fallback on compact screens (< 768px).

## Consequences

### Positive
- **Simultaneous Immersion**: Readers can compare summary bullets or ask questions about text while the original text remains completely visible in the left pane.
- **Selection Ergonomics**: Selecting sentences on the left and dragging/quoting into the right panel is natural and unobstructed.
- **Customizable Screen Real Estate**: The split divider supports dragging between `320px` and `600px`, remembering user preference per display.

### Negative / Trade-offs
- **Horizontal Screen Demands**: Requires at least a reasonable window width (recommended >= 1024px) for optimal multi-column reader typography. On narrow windows, responsive logic must collapse the sidebar into an overlay drawer.

# ADR 0001: Container Architecture Selection: Tauri 2 Over Electron

## Status
Accepted

## Context
`readest-plus` requires a cross-platform desktop wrapper capable of hosting a modern React frontend, rendering EPUB/PDF electronic books via Foliate-js, and orchestrating streaming AI calls.

Two major desktop application container architectures were evaluated:
1. **Electron**: Chromium + Node.js bundled runtime.
2. **Tauri 2**: Rust core + OS-native WebView (WebView2 on Windows, WebKit on macOS/Linux).

## Decision
We select **Tauri 2** as the application container, aligning directly with the upstream `readest` project.

## Consequences

### Positive
- **Resource Efficiency**: Idle memory usage remains under 50MB (compared to 150MB~300MB in Electron).
- **Binary Footprint**: Installer bundle size is lightweight (< 15MB vs ~90MB+ for Electron).
- **Upstream Alignment**: Directly compatible with `apps/readest-app` and `src-tauri` from the upstream `readest` repository, preventing divergence in build pipelines and native hooks.
- **Security**: Granular permission scopes for filesystem and network access enforced at the Rust IPC boundary.

### Negative / Trade-offs
- **WebView Divergence**: Different platforms use different underlying web engines (WebKit on macOS vs WebView2 on Windows), requiring CSS/JS compatibility checks.
- **Rust Toolchain**: Building native installers requires a Rust compilation environment.

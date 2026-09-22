/**
 * Reader ⇄ agent link bus (reading-agent architecture doc §3.3 & §5.3):
 * `locate_in_reader` publishes jump payloads here; the reader panes
 * (TXT scroll pane / Foliate engine pane) subscribe and perform the smooth
 * jump + highlight breathing animation. Keeps the agent layer fully
 * decoupled from the rendering engines.
 */

/** Request to drive the reader viewport to an exact passage. */
export interface LocateRequest {
  bookHash: string;
  /** Target chapter ordinal in the agent's unified chapter space. */
  nodeIndex: number;
  /** Optional chapter-relative character offset. */
  charOffset?: number;
  /** Precise text fragment to highlight once there. */
  quoteSnippet: string;
}

export type LocateListener = (request: LocateRequest) => void;

const listeners = new Set<LocateListener>();

/** Publish a locate request to whichever reader pane is mounted. */
export function requestLocate(request: LocateRequest): void {
  for (const listener of listeners) {
    try {
      listener(request);
    } catch {
      // A broken listener must never break the agent turn.
    }
  }
}

/** Subscribe; returns the unsubscribe function. */
export function subscribeLocate(listener: LocateListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test helper: drop every listener. */
export function clearLocateListeners(): void {
  listeners.clear();
}

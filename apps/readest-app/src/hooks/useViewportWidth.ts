'use client';

import { useEffect, useState } from 'react';

export const COMPACT_MEDIA_QUERY = '(max-width: 767px)';

export interface ViewportWidth {
  /** True below 768px — the sidebar switches to overlay drawer mode. */
  isCompact: boolean;
}

/**
 * Responsive breakpoint hook (design doc 6: <768px drawer mode).
 * SSR-safe: starts at `false` and only updates after mount; stays `false`
 * when `matchMedia` is unavailable.
 */
export function useViewportWidth(): ViewportWidth {
  const [isCompact, setIsCompact] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;

    const query = window.matchMedia(COMPACT_MEDIA_QUERY);
    setIsCompact(query.matches);
    const onChange = (event: MediaQueryListEvent) => setIsCompact(event.matches);

    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', onChange);
      return () => query.removeEventListener('change', onChange);
    }
    // Legacy Safari (<14) fallback.
    if (typeof query.addListener === 'function') {
      query.addListener(onChange);
      return () => query.removeListener(onChange);
    }
    return undefined;
  }, []);

  return { isCompact };
}

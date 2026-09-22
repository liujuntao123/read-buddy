'use client';

import { useEffect } from 'react';

/**
 * Dismiss overlays when the reader clicks into a book iframe.
 *
 * Chapter content renders inside blob iframes; pointer events there never
 * reach the parent document, so an Astryx popover's light dismiss (which
 * listens on the parent) does not fire — with an EPUB open, nearly the
 * whole window is iframe and popovers would feel sticky. Clicking into an
 * iframe moves focus to the inner window, which blurs the top window: use
 * that as the "click landed elsewhere" signal and dismiss.
 *
 * (Window blur also fires on app switching — dismissing then is desirable.)
 */
export function useDismissOnWindowBlur(active: boolean, dismiss: () => void): void {
  useEffect(() => {
    if (!active) return;
    const onBlur = () => dismiss();
    window.addEventListener('blur', onBlur);
    return () => window.removeEventListener('blur', onBlur);
  }, [active, dismiss]);
}

'use client';

import { useEffect, useState } from 'react';

/** Storage key and event name shared by the toggle, the provider and the reader. */
export const THEME_STORAGE_KEY = 'read-buddy:theme';
export const READING_THEME_CHANGE_EVENT = 'read-buddy:reading-theme-change';

/** The three reading looks: 日间 / 护眼(羊皮纸) / 夜间. */
export type ReadingTheme = 'light' | 'sepia' | 'dark';

const isReadingTheme = (value: unknown): value is ReadingTheme =>
  value === 'light' || value === 'sepia' || value === 'dark';

/** Persisted reading theme, defaulting to `light`. */
export function readStoredTheme(): ReadingTheme {
  try {
    const stored =
      typeof window === 'undefined' ? null : window.localStorage.getItem(THEME_STORAGE_KEY);
    return isReadingTheme(stored) ? stored : 'light';
  } catch {
    return 'light';
  }
}

/**
 * Persist the reading theme and broadcast it. The Astryx `<Theme>` provider
 * (AppThemeProvider) and the Foliate engine pane both listen for the event;
 * the provider additionally owns the `data-theme` attribute on <html>.
 */
export function applyTheme(theme: ReadingTheme): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage may be unavailable (private mode); the event still fires.
  }
  window.dispatchEvent(
    new CustomEvent<ReadingTheme>(READING_THEME_CHANGE_EVENT, { detail: theme }),
  );
}

/** Current reading theme, kept in sync across the app via `applyTheme`. */
export function useReadingTheme(): ReadingTheme {
  const [theme, setTheme] = useState<ReadingTheme>('light');

  useEffect(() => {
    setTheme(readStoredTheme());
    const onChange = (event: Event) => {
      const detail = (event as CustomEvent<ReadingTheme>).detail;
      if (isReadingTheme(detail)) setTheme(detail);
    };
    window.addEventListener(READING_THEME_CHANGE_EVENT, onChange);
    return () => window.removeEventListener(READING_THEME_CHANGE_EVENT, onChange);
  }, []);

  return theme;
}

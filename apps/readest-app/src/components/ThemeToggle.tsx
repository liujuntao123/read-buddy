'use client';

import { useEffect, useState } from 'react';
import { BookOpen, Moon, Sun } from 'lucide-react';

export const THEME_STORAGE_KEY = 'readest-plus:theme';
export type AppTheme = 'light' | 'sepia' | 'dark';

const THEMES: ReadonlyArray<{ value: AppTheme; label: string; Icon: typeof Sun }> = [
  { value: 'light', label: '日间模式', Icon: Sun },
  { value: 'sepia', label: '护眼模式', Icon: BookOpen },
  { value: 'dark', label: '夜间模式', Icon: Moon },
];

const isAppTheme = (value: unknown): value is AppTheme =>
  value === 'light' || value === 'sepia' || value === 'dark';

/** Persisted theme, defaulting to `light` (layout.tsx's initial value). */
export function readStoredTheme(): AppTheme {
  try {
    const stored =
      typeof window === 'undefined' ? null : window.localStorage.getItem(THEME_STORAGE_KEY);
    return isAppTheme(stored) ? stored : 'light';
  } catch {
    return 'light';
  }
}

/** Apply to <html data-theme> and persist; both drive the daisyUI themes. */
export function applyTheme(theme: AppTheme): void {
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', theme);
  }
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage may be unavailable (private mode); the attribute still applies.
  }
}

/**
 * Day / sepia / night theme switch (design doc 3.1). Semantic daisyUI classes
 * downstream pick the palette up automatically via html[data-theme].
 */
export default function ThemeToggle() {
  const [theme, setTheme] = useState<AppTheme>('light');

  useEffect(() => {
    const stored = readStoredTheme();
    setTheme(stored);
    document.documentElement.setAttribute('data-theme', stored);
  }, []);

  const switchTo = (next: AppTheme) => {
    setTheme(next);
    applyTheme(next);
  };

  return (
    <div
      data-testid="theme-toggle"
      role="group"
      aria-label="主题切换"
      className="flex items-center gap-0.5"
    >
      {THEMES.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          className={`btn btn-ghost btn-xs btn-square ${theme === value ? 'btn-active' : ''}`}
          aria-label={label}
          aria-pressed={theme === value}
          title={label}
          onClick={() => switchTo(value)}
        >
          <Icon className="size-4" aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

'use client';

import { Theme, type DefinedTheme } from '@astryxdesign/core/theme';
import { readBuddyTheme } from '@/theme/read-buddy';
import { readBuddySepiaTheme } from '@/theme/read-buddy-sepia';
import { useReadingTheme, type ReadingTheme } from '@/theme/readingTheme';

/**
 * Maps each reading look onto an Astryx theme + color mode. 护眼 (sepia) is a
 * light-mode theme with its own warm palette, so only 日间/夜间 differ by mode.
 */
const RESOLVED: Record<ReadingTheme, { theme: DefinedTheme; mode: 'light' | 'dark' }> = {
  light: { theme: readBuddyTheme, mode: 'light' },
  sepia: { theme: readBuddySepiaTheme, mode: 'light' },
  dark: { theme: readBuddyTheme, mode: 'dark' },
};

/**
 * App-root Astryx theme provider. Renders the design-system Theme wrapper
 * (which syncs `data-theme`/`data-astryx-theme` onto <html>) and follows the
 * reading theme chosen in the header toggle.
 */
export default function AppThemeProvider({ children }: { children: React.ReactNode }) {
  const readingTheme = useReadingTheme();
  const { theme, mode } = RESOLVED[readingTheme];
  return (
    <Theme theme={theme} mode={mode}>
      {children}
    </Theme>
  );
}

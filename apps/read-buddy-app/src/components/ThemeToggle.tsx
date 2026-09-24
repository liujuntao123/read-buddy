'use client';

import { useEffect, useState } from 'react';
import { Eye, Moon, Sun } from 'lucide-react';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { applyTheme, readStoredTheme, type ReadingTheme } from '@/theme/readingTheme';

const THEMES: ReadonlyArray<{ value: ReadingTheme; label: string; Icon: typeof Sun }> = [
  { value: 'light', label: '日间模式', Icon: Sun },
  { value: 'sepia', label: '护眼模式', Icon: Eye },
  { value: 'dark', label: '夜间模式', Icon: Moon },
];

/**
 * 日间 / 护眼 / 夜间 segmented switch. Selection persists through
 * `applyTheme`, which notifies the app-root theme provider and the reader
 * engine; the html `data-theme` attribute itself is owned by the provider.
 */
export default function ThemeToggle() {
  const [theme, setTheme] = useState<ReadingTheme>('light');

  useEffect(() => {
    setTheme(readStoredTheme());
  }, []);

  const switchTo = (next: string) => {
    const reading = next as ReadingTheme;
    setTheme(reading);
    applyTheme(reading);
  };

  return (
    <SegmentedControl
      data-testid="theme-toggle"
      label="主题切换"
      value={theme}
      onChange={switchTo}
      size="sm"
    >
      {THEMES.map(({ value, label, Icon }) => (
        <SegmentedControlItem
          key={value}
          value={value}
          label={label}
          isLabelHidden
          icon={<Icon size={14} aria-hidden />}
        />
      ))}
    </SegmentedControl>
  );
}

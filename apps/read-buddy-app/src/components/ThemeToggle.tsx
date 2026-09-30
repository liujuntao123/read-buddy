'use client';

import { Eye, Moon, Sun } from 'lucide-react';
import { IconButton } from '@astryxdesign/core/IconButton';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { applyTheme, useReadingTheme, type ReadingTheme } from '@/theme/readingTheme';

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
export default function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const theme = useReadingTheme();

  const switchTo = (next: string) => {
    const reading = next as ReadingTheme;
    applyTheme(reading);
  };

  if (compact) {
    const index = THEMES.findIndex((item) => item.value === theme);
    const current = THEMES[index]!;
    const next = THEMES[(index + 1) % THEMES.length]!;
    // Same test seam as the wide switch: the header always owns a theme control.
    return <IconButton data-testid="theme-toggle" label={`${current.label}，切换到${next.label}`} tooltip={`切换到${next.label}`} size="sm" variant="ghost"
      icon={<current.Icon size={16} />} onClick={() => switchTo(next.value)} />;
  }

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

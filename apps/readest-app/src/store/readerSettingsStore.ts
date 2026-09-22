/**
 * Reader settings store: typography (font size / family / line height /
 * paragraph spacing) and layout (content width / page margin / column gap),
 * persisted to localStorage so choices survive restarts.
 *
 * The Foliate engine consumes the CSS produced by `typographyCss` via
 * `setTypography` (merged with the theme stylesheet); layout numbers map
 * onto paginator attributes through `setLayout`. The TXT reader
 * (ReaderPane) applies the same values to its scroll article.
 */
import { create } from 'zustand';
import {
  DEFAULT_READER_LAYOUT,
  type PageMode,
  type ReaderLayoutParams,
} from '@/services/library/foliateEngine';

export interface ReaderTypography {
  /** Content font size in px (12–28). */
  fontSize: number;
  /** Key into READER_FONT_OPTIONS ('system' leaves the book CSS untouched). */
  fontFamily: string;
  /** Line height multiplier (1.2–2.4). */
  lineHeight: number;
  /** Extra paragraph spacing in em (0–1.5). */
  paragraphSpacing: number;
}

export interface ReaderLayoutSettings {
  /** Page display mode ('single' or 'double'). */
  pageMode: PageMode;
  /** Content column width in px (480–1200) — the single-page width knob. */
  contentWidth: number;
  /** Paginated page top/bottom margin in px (24–96). */
  pageMargin: number;
  /** Column gap / side whitespace in percent (4–15). */
  columnGap: number;
}

export const DEFAULT_TYPOGRAPHY: ReaderTypography = {
  fontSize: 17,
  fontFamily: 'system',
  lineHeight: 1.7,
  paragraphSpacing: 0.4,
};

export const DEFAULT_LAYOUT_SETTINGS: ReaderLayoutSettings = {
  pageMode: DEFAULT_READER_LAYOUT.pageMode,
  contentWidth: DEFAULT_READER_LAYOUT.contentWidth,
  pageMargin: DEFAULT_READER_LAYOUT.pageMargin,
  columnGap: DEFAULT_READER_LAYOUT.columnGap,
};

export interface ReaderFontOption {
  key: string;
  label: string;
  /** CSS font stack; 'system' resolves to no override at all. */
  stack?: string;
}

/**
 * Curated stacks that render well for CJK + latin book text on Windows/macOS.
 * 霞鹜文楷 ships with the app (lxgw-wenkai-webfont, OFL licence); the rest
 * gracefully degrade through their fallback chains when absent.
 */
export const READER_FONT_OPTIONS: ReaderFontOption[] = [
  { key: 'system', label: '跟随书籍' },
  {
    key: 'wenkai',
    label: '霞鹜文楷 · 手写楷风',
    stack: '"LXGW WenKai", "Kaiti SC", KaiTi, STKaiti, serif',
  },
  {
    key: 'songti',
    label: '宋体 · Serif',
    stack: 'Georgia, "Times New Roman", "Songti SC", SimSun, serif',
  },
  {
    key: 'source-han-serif',
    label: '思源宋体 · Source Han Serif',
    stack: '"Source Han Serif SC", "Source Han Serif CN", "Noto Serif CJK SC", "Songti SC", SimSun, serif',
  },
  {
    key: 'kaiti',
    label: '楷体 · Kai',
    stack: '"Kaiti SC", KaiTi, STKaiti, "Noto Serif SC", serif',
  },
  {
    key: 'fangsong',
    label: '仿宋 · FangSong',
    stack: 'FangSong, "Fangsong SC", STFangsong, serif',
  },
  {
    key: 'heiti',
    label: '黑体 · Sans',
    stack: '-apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif',
  },
  {
    key: 'yuanti',
    label: '圆体 · Round',
    stack: 'YouYuan, "Yuanti SC", "Hiragino Maru Gothic ProN", "Microsoft YaHei", sans-serif',
  },
  {
    key: 'latin-serif',
    label: '西文衬线 · Palatino',
    stack: 'Palatino, "Palatino Linotype", "Book Antiqua", Georgia, "Songti SC", SimSun, serif',
  },
];

export const fontStackByKey = (key: string): string | undefined =>
  READER_FONT_OPTIONS.find((option) => option.key === key)?.stack;

const STORAGE_KEY = 'readest-plus:reader-settings';

interface PersistedSettings {
  typography: ReaderTypography;
  layout: ReaderLayoutSettings;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const clampTypography = (t: Partial<ReaderTypography>): ReaderTypography => ({
  fontSize: clamp(Number(t.fontSize ?? DEFAULT_TYPOGRAPHY.fontSize) || DEFAULT_TYPOGRAPHY.fontSize, 12, 28),
  fontFamily: READER_FONT_OPTIONS.some((o) => o.key === t.fontFamily)
    ? (t.fontFamily as string)
    : DEFAULT_TYPOGRAPHY.fontFamily,
  lineHeight: clamp(
    Number(t.lineHeight ?? DEFAULT_TYPOGRAPHY.lineHeight) || DEFAULT_TYPOGRAPHY.lineHeight,
    1.2,
    2.4,
  ),
  paragraphSpacing: clamp(
    Number(t.paragraphSpacing ?? DEFAULT_TYPOGRAPHY.paragraphSpacing) ||
      DEFAULT_TYPOGRAPHY.paragraphSpacing,
    0,
    1.5,
  ),
});

const clampLayout = (l: Partial<ReaderLayoutSettings>): ReaderLayoutSettings => {
  let mode: PageMode = 'double';
  if (l.pageMode === 'single' || l.pageMode === 'double') {
    mode = l.pageMode;
  } else if (typeof window !== 'undefined') {
    try {
      const legacy = window.localStorage.getItem('readest-plus:page-mode');
      if (legacy === 'single' || legacy === 'double') mode = legacy;
    } catch {
      /* ignore */
    }
  }
  return {
    pageMode: mode,
    contentWidth: clamp(
      Number(l.contentWidth ?? DEFAULT_LAYOUT_SETTINGS.contentWidth) ||
        DEFAULT_LAYOUT_SETTINGS.contentWidth,
      480,
      1200,
    ),
    pageMargin: clamp(
      Number(l.pageMargin ?? DEFAULT_LAYOUT_SETTINGS.pageMargin) || DEFAULT_LAYOUT_SETTINGS.pageMargin,
      24,
      96,
    ),
    columnGap: clamp(
      Number(l.columnGap ?? DEFAULT_LAYOUT_SETTINGS.columnGap) || DEFAULT_LAYOUT_SETTINGS.columnGap,
      4,
      15,
    ),
  };
};

export function readStoredSettings(): PersistedSettings {
  try {
    const raw =
      typeof window === 'undefined' ? null : window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { typography: DEFAULT_TYPOGRAPHY, layout: DEFAULT_LAYOUT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<PersistedSettings>;
    return {
      typography: clampTypography(parsed.typography ?? {}),
      layout: clampLayout(parsed.layout ?? {}),
    };
  } catch {
    return { typography: DEFAULT_TYPOGRAPHY, layout: DEFAULT_LAYOUT_SETTINGS };
  }
}

const writeStoredSettings = (settings: PersistedSettings): void => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* private mode: settings stay per-session only */
  }
};

export interface ReaderSettingsState {
  typography: ReaderTypography;
  layout: ReaderLayoutSettings;
  setTypography: (patch: Partial<ReaderTypography>) => void;
  /** Relative font-size stepper — computes against live state, so rapid clicks never lose increments. */
  adjustFontSize: (delta: number) => void;
  setLayoutSettings: (patch: Partial<ReaderLayoutSettings>) => void;
  setPageMode: (mode: PageMode) => void;
  reset: () => void;
}

export const useReaderSettingsStore = create<ReaderSettingsState>((set, get) => ({
  typography: readStoredSettings().typography,
  layout: readStoredSettings().layout,

  setTypography: (patch) => {
    const typography = clampTypography({ ...get().typography, ...patch });
    set({ typography });
    writeStoredSettings({ typography, layout: get().layout });
  },

  adjustFontSize: (delta) => {
    const current = get().typography.fontSize;
    const typography = clampTypography({ ...get().typography, fontSize: current + delta });
    set({ typography });
    writeStoredSettings({ typography, layout: get().layout });
  },

  setLayoutSettings: (patch) => {
    const layout = clampLayout({ ...get().layout, ...patch });
    set({ layout });
    writeStoredSettings({ typography: get().typography, layout });
  },

  setPageMode: (pageMode) => {
    const layout = clampLayout({ ...get().layout, pageMode });
    set({ layout });
    writeStoredSettings({ typography: get().typography, layout });
    try {
      window.localStorage.setItem('readest-plus:page-mode', pageMode);
    } catch {
      /* ignore */
    }
  },

  reset: () => {
    set({ typography: DEFAULT_TYPOGRAPHY, layout: DEFAULT_LAYOUT_SETTINGS });
    writeStoredSettings({ typography: DEFAULT_TYPOGRAPHY, layout: DEFAULT_LAYOUT_SETTINGS });
    try {
      window.localStorage.setItem('readest-plus:page-mode', DEFAULT_LAYOUT_SETTINGS.pageMode);
    } catch {
      /* ignore */
    }
  },
}));

/**
 * Build the CSS injected into engine-rendered chapters. Everything is
 * `!important` so book stylesheets cannot win over explicit reader choices;
 * `font-family` is omitted entirely for the 'system' key (follow the book).
 */
export function typographyCss(t: ReaderTypography): string {
  const stack = fontStackByKey(t.fontFamily);
  const lines = [
    `html { font-size: ${t.fontSize}px !important; }`,
    `body { line-height: ${t.lineHeight} !important; }`,
  ];
  if (stack) lines.push(`body { font-family: ${stack} !important; }`);
  if (t.paragraphSpacing > 0) {
    lines.push(
      `body p, body li { margin-top: ${t.paragraphSpacing}em; }`,
      `body h1, body h2, body h3, body h4, body h5, body h6 { line-height: ${t.lineHeight}; }`,
    );
  }
  return lines.join('\n');
}

/** ReaderLayoutParams payload for the engine's `setLayout`. */
export function toEngineLayout(
  settings: ReaderLayoutSettings,
  pageMode?: ReaderLayoutParams['pageMode'],
): ReaderLayoutParams {
  return { ...settings, pageMode: pageMode ?? settings.pageMode };
}

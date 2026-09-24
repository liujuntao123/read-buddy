import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_LAYOUT_SETTINGS,
  DEFAULT_TYPOGRAPHY,
  READER_FONT_OPTIONS,
  readStoredSettings,
  toEngineLayout,
  typographyCss,
  useReaderSettingsStore,
} from './readerSettingsStore';

beforeEach(() => {
  window.localStorage.clear();
  useReaderSettingsStore.getState().reset();
});

describe('readerSettingsStore', () => {
  it('serves defaults and produces engine layout + typography payloads', () => {
    const { typography, layout } = useReaderSettingsStore.getState();
    expect(typography).toEqual(DEFAULT_TYPOGRAPHY);
    expect(layout).toEqual(DEFAULT_LAYOUT_SETTINGS);

    expect(toEngineLayout(layout, 'single')).toEqual({
      ...DEFAULT_LAYOUT_SETTINGS,
      pageMode: 'single',
    });

    const css = typographyCss({ ...DEFAULT_TYPOGRAPHY, fontSize: 19, fontFamily: 'songti' });
    expect(css).toContain('font-size: 19px');
    expect(css).toContain('font-family');
    expect(css).toContain(`line-height: ${DEFAULT_TYPOGRAPHY.lineHeight}`);
    expect(css).toContain(`margin-top: ${DEFAULT_TYPOGRAPHY.paragraphSpacing}em`);
  });

  it('omits font-family for the 跟随书籍 (system) default', () => {
    const css = typographyCss(DEFAULT_TYPOGRAPHY);
    expect(css).not.toContain('font-family');
  });

  it('clamps patched values into the supported ranges', () => {
    const { setTypography, setLayoutSettings } = useReaderSettingsStore.getState();

    setTypography({ fontSize: 400, lineHeight: 99, paragraphSpacing: -5, fontFamily: 'nope' });
    let state = useReaderSettingsStore.getState();
    expect(state.typography.fontSize).toBe(28);
    expect(state.typography.lineHeight).toBe(2.4);
    expect(state.typography.paragraphSpacing).toBe(0);
    expect(state.typography.fontFamily).toBe('system'); // unknown key rejected

    setLayoutSettings({ contentWidth: 9999, pageMargin: 1, columnGap: 100 });
    const layoutState = useReaderSettingsStore.getState().layout;
    expect(layoutState.contentWidth).toBe(1200);
    expect(layoutState.pageMargin).toBe(24);
    expect(layoutState.columnGap).toBe(15);
  });

  it('persists settings to localStorage and restores them', () => {
    useReaderSettingsStore.getState().setTypography({ fontSize: 22, fontFamily: 'kaiti' });
    useReaderSettingsStore.getState().setLayoutSettings({ contentWidth: 880 });

    const stored = readStoredSettings();
    expect(stored.typography.fontSize).toBe(22);
    expect(stored.typography.fontFamily).toBe('kaiti');
    expect(stored.layout.contentWidth).toBe(880);

    expect(JSON.parse(window.localStorage.getItem('read-buddy:reader-settings')!)).toEqual(
      stored,
    );
  });

  it('adjustFontSize computes against live state (rapid clicks keep every increment)', () => {
    const { adjustFontSize } = useReaderSettingsStore.getState();
    // A synchronous burst must not collapse against a stale closure snapshot.
    for (let i = 0; i < 5; i++) adjustFontSize(1);
    expect(useReaderSettingsStore.getState().typography.fontSize).toBe(
      DEFAULT_TYPOGRAPHY.fontSize + 5,
    );
    for (let i = 0; i < 3; i++) adjustFontSize(-1);
    expect(useReaderSettingsStore.getState().typography.fontSize).toBe(
      DEFAULT_TYPOGRAPHY.fontSize + 2,
    );
  });

  it('reset restores defaults everywhere', () => {
    useReaderSettingsStore.getState().setTypography({ fontSize: 25 });
    useReaderSettingsStore.getState().reset();
    expect(useReaderSettingsStore.getState().typography).toEqual(DEFAULT_TYPOGRAPHY);
    expect(readStoredSettings().typography).toEqual(DEFAULT_TYPOGRAPHY);
  });

  it('ignores corrupted storage payloads', () => {
    window.localStorage.setItem('read-buddy:reader-settings', '{not json');
    expect(readStoredSettings().typography).toEqual(DEFAULT_TYPOGRAPHY);
  });

  it('offers a curated font catalogue with unique keys', () => {
    const keys = READER_FONT_OPTIONS.map((option) => option.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain('system');
    for (const option of READER_FONT_OPTIONS.slice(1)) {
      expect(option.stack).toBeTruthy();
    }
  });
});

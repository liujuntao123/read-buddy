import { defineTheme } from '@astryxdesign/core/theme';
import { neutralTheme } from '@astryxdesign/theme-neutral';

/**
 * readest 护眼（羊皮纸）主题（Astryx）。
 *
 * 只作为日间模式使用（应用层始终以 mode="light" 挂载它），
 * 明暗两组值保持一致，避免误用 dark 变体。
 */
export const readestSepiaTheme = defineTheme({
  name: 'readest-sepia',
  extends: neutralTheme,

  color: {
    accent: '#8A6D3B',
    neutralStyle: 'warm',
    contrast: 'standard',
  },

  typography: {
    scale: { base: 16, ratio: 1.2 },
    body: {
      family: '-apple-system',
      fallbacks:
        '"Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
    },
    heading: {
      family: 'Georgia',
      fallbacks: '"Songti SC", "STSong", SimSun, serif',
      weight: 'semibold',
    },
    code: {
      family: '"SF Mono"',
      fallbacks: 'ui-monospace, Consolas, "Cascadia Mono", monospace',
    },
  },

  radius: { base: 4, multiplier: 1 },

  tokens: {
    '--color-background-body': ['#F3ECDD', '#F3ECDD'],
    '--color-background-surface': ['#FAF5EA', '#FAF5EA'],
    '--color-background-card': ['#FAF5EA', '#FAF5EA'],
  },
});

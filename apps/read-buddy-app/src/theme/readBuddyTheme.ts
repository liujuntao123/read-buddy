import { defineTheme } from '@astryxdesign/core/theme';
import { neutralTheme } from '@astryxdesign/theme-neutral';

/**
 * read-buddy 日间/夜间主题（Astryx）。
 *
 * 基于内置 neutral 主题（克制的暖灰），把 accent 调成安静的墨蓝，
 * 正文背景是暖纸色、面板是纯白，夜间为深炭色。阅读器内容区
 * （foliate iframe）的主题由 foliateEngine 自己注入，与此处的
 * UI 主题相互独立。
 */
export const readBuddyTheme = defineTheme({
  name: 'read-buddy',
  extends: neutralTheme,

  color: {
    accent: ['#3D6B9E', '#7FA8D9'],
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
    '--color-background-body': ['#F7F6F3', '#131315'],
    '--color-background-surface': ['#FFFFFF', '#1D1D20'],
    '--color-background-card': ['#FFFFFF', '#1D1D20'],
  },
});

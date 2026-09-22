---
id: "11"
title: "UX 打磨：Icon 化、阅读悬浮工具条、字体扩充、浮层交互与书架卡片重设计"
status: "closed"
blocked_by: ["10"]
labels: ["ux", "ready-for-agent"]
---

### Problem

1. 工具类按钮/分段控件仍带文字（导入、AI 侧栏、历史话题、主题切换、视图切换），头部拥挤。
2. 阅读控件（章节导航、目录、单双页、排版设置）放在 Header，阅读时视觉负担大。
3. 可选字体少（5 个系统栈），缺少适合中文长文阅读的内置字体。
4. 浮层点击空白不消失：AISettings 弹窗 purpose=form 拦截背板点击；EPUB 章节在
   blob iframe 内，点击书页内容根本到不了父文档，Popover light-dismiss 失效。
5. 护眼/夜间模式下书页背景（#f4ecd8 / #1d232a）与 UI surface（#FAF5EA / #1D1D20）
   色调不一致，出现拼接缝。
6. 书架卡片信息平铺在封面下方、标题可换行、进度徽章过大；排序选择器无图标。

### Fix

- **Icon 化**：Header/ChatTab 工具按钮、主题切换与视图切换（SegmentedControlItem
  `isLabelHidden`）全部图标化（保留 aria-label/tooltip）；排序选择器 trigger 加
  startIcon，下拉选项各配图标。
- **ReaderDock**（新组件）：阅读控件收敛为阅读区右下角悬浮竖条，hover 区域命中才
  显现（opacity + pointer-events 过渡，`:focus-within` 可达，popover 打开时
  `data-open` 钉住）；图标与按钮加大（20px / md）。
- **字体**：READER_FONT_OPTIONS 扩至 9 项（霞鹜文楷 webfont、思源宋体、圆体、
  西文衬线等）；lxgw-wenkai-webfont 以 unicode-range 子集随应用分发，
  `services/reader/webfonts.ts` 从父文档 CSSOM 收集 @font-face 并把 url 绝对化
  注入章节 iframe（EPUB 内也能用上内置字体）。
- **浮层**：AISettings Dialog purpose=info（背板点击/ESC 关闭）；新增
  `useDismissOnWindowBlur` hook —— 点击 iframe 使顶层 window blur 时关闭
  ReaderDock/ChatTab 的 popover。
- **背景统一**：getReaderThemeStyles 的书页背景对齐主题 surface（light #ffffff、
  sepia #faf5ea、dark #1d1d20），护眼/夜间全页一体。
- **书架卡片**：封面即卡片；格式徽章移到封面左上；元信息（作者 · 导入时间 · 进度）
  以渐变蒙层覆盖封面底部（标题单行省略、排距放宽）；导入按钮变为网格末尾的
  虚线卡片（同封面比例）；卡片 hover 浮起 + 按压回落动效（respect
  prefers-reduced-motion）；进度徽章缩小。
- **Header**：阅读页书名改 maxWidth（不再固定宽度）、书架/阅读标题前斜杠移除。

### Acceptance Criteria

- [x] 主题/视图切换、导入、AI 侧栏、历史话题、阅读 dock 全部图标化且有可访问名称。
- [x] 阅读控件仅在鼠标移入右下角时出现；目录/设置 popover 打开期间不消失。
- [x] 阅读器字体选择含霞鹜文楷等 9 项；LXGW WenKai 在父文档与章节 iframe 内均
      可加载（fonts.check 验证）。
- [x] 点击书页（iframe）可关闭 dock popover；点击空白关闭 AISettings 弹窗。
- [x] 护眼/夜间模式书页背景与页面 surface 色值一致。
- [x] 书架网格卡片为蒙层设计 + 导入尾卡 + hover 动效；排序 trigger 与选项带图标。
- [x] `pnpm verify` 全绿（typecheck + 347 tests + next build）。

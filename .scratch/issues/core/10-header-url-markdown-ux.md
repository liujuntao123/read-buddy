---
id: "10"
title: "UX 整改：Header 分层整理、选中书籍 URL 持久化、文本 Markdown 渲染"
status: "closed"
blocked_by: ["07"]
labels: ["ux", "ready-for-agent"]
---

### Problem

1. **Header 分层混乱**：书架页同时存在 TopNav（品牌 + 我的书架 + 导入）
   与 Bookshelf 自带标题行（再次「我的书架」+ 藏书数 + 导入按钮）；
   阅读页除 TopNav 外 FoliatePane/ReaderPane 还各自携带一条 40px
   本地工具栏（目录/翻章/页面模式/排版设置重复实现），且
   FoliatePane 私有 `pageMode` state 与 `readerSettingsStore` 的
   pageMode 双源不同步（HeaderBar 切换后滚轮翻页仍按旧模式拦截）。
2. **选中书籍持久化**：仅靠 localStorage 指针，刷新/分享无法稳定恢复
   当前阅读的书籍；「继续阅读」按钮直接 `setState({view})` 绕过 URL。
3. **文本展示不支持 Markdown**：AI 对话气泡与章节总结按纯文本渲染，
   模型输出的标题/列表/代码块/表格全部糊成一行。

### Fix

- **单一 Header**：阅读控件（上一章/下一章、目录、单双页、排版设置）
  全部收敛到 HeaderBar；FoliatePane/ReaderPane 删除本地工具栏，
  pageMode 单一来源于 `readerSettingsStore`（store 变更 → pane 布局
  effect 应用到引擎）；Bookshelf 去掉重复标题行，仅保留搜索/排序栏。
- **URL 即状态**：`?book=<hash>` 为刷新时的唯一事实来源——`open`
  pushState、`closeToShelf` 清参并丢弃 localStorage 指针（刷新书架
  停留在书架）、`init` URL 优先（localStorage 仅冷启动回填，且用
  replaceState 不产生多余历史记录）、`resumeReading()` 同步视图与
  URL、Workspace 监听 popstate 支持浏览器前进/后退。
- **Markdown**：新增 `MarkdownView`（marked GFM + breaks，输出经
  `sanitizeSectionHtml` 白名单过滤），应用于对话气泡（含流式气泡）与
  章节总结正文；样式集中到 `globals.css` 的 `.markdown-content`
  （无 styled-jsx / 无实例级 <style>，气泡 textContent 保持纯文本）。

### Acceptance Criteria

- [x] 书架页仅一条顶栏（标题+藏书数+导入在 TopNav，Bookshelf 无重复行）；
      阅读页阅读控件仅存在于 HeaderBar，两个阅读 pane 无本地工具栏。
- [x] 阅读中刷新（URL 带 `?book=`）恢复该书阅读进度；书架页刷新停留在
      书架；浏览器后退/前进在书架与书之间正确切换。
- [x] 对话气泡与总结正文渲染 GFM（标题/粗体/列表/引用/代码块/表格），
      注入的 script/外链图片被过滤。
- [x] `pnpm verify` 全绿（typecheck + 342 tests + next build）。

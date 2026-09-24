---
id: "15"
title: "阅读体验增强：跨章无限滚动、划线点击工具条、双页边缘翻页"
status: "closed"
blocked_by: []
labels: ["reader", "ux", "ready-for-agent"]
---

### Problem

1. **单页模式的「无限滚动」不是真的无限滚动。** 现在的单页是 `flow="scrolled"` +
   单列：滚动容器里只有**当前章节**的那一个 iframe，读到本章末尾就撞墙——想继续读
   必须按翻页键或去右下角的 dock。真正的连续阅读应当让滚动自然跨过章节边界
   （下一章接在下面、上一章接在上面），而「跳到第 N 章」在这条连续的流里就只是
   **滚动到该章/锚点的位置**，不是重建整页。

2. **划过的文本是死的。** 划线（`mark.read-buddy-reader-highlight`）只能看，不能点。
   读者想让 AI 解释划过的句子、或者想取消这条划线，只能回到侧栏列表里找。
   选中文本会弹出工具条，划过文本却没有——两件事本该是同一个控件。

3. **双页模式没有鼠标翻页入口。** 双页是鼠标阅读的主场景，但现在只能靠滚轮
   （有 50px 阈值 + 250ms 冷却）或键盘。鼠标停在左右边缘时应当出现翻页按钮。

### Acceptance Criteria

- [x] 单页模式下滚到当前章末尾，**下一章的内容直接接在下面**，滚动不中断（滚动条
      连续增长，不跳回顶部）；往回滚到章首，上一章接在上面且视觉位置不跳。
- [x] 单页模式下点目录 / 上一章下一章，若目标章节已在连续流中则**滚动到锚点**，
      不重建文档；不在流中则加载到该章再定位。
- [x] 连续滚动时章节标题 / 进度 / 阅读位置随滚动实时更新（relocate）；
      进度条的 `goToFraction` 跳转在连续流中同样成立。
- [x] 双页模式：鼠标移到阅读区左/右边缘出现翻页按钮，点击翻到上/下一页（跨章）。
- [x] 点击一条划线弹出与选区**同一个**工具条（同样的四个 AI 动作，作用于该划线的
      文本），其中「划线」变成「取消划线」，点击即删除该划线。
- [x] 划线 hover 有可点击的光标提示；点空白处 / Esc / 翻章后工具条消失。
- [x] TXT 阅读器（ReaderPane）与引擎阅读器（FoliatePane）行为一致。
- [x] `pnpm typecheck && pnpm test && pnpm build` 全绿；单页跨章滚动经浏览器实测。

### 实现纪要

- **单页连续流**：`vendor/foliate-js/paginator.js` 新增 `continuous` 属性分支
  （在 `flow="scrolled"` 之上把若干章装进同一个 `#container` 里的 flex 列）：
  视口上下各留 1.5 屏，最多 5 章常驻，双向懒加载 + 淘汰；
  `#continuousGoTo` 把「跳章」实现为**滚动到该章/锚点的偏移**（已加载则纯滚动）；
  `linear="no"` 的辅助章节与分页模式一致地被跳过。
  `view.js` 转发 `unload`（shadow root 内的 CustomEvent 不会自行穿透），
  引擎据此释放章节文档上的选区捕获、划线目标与指针监听。
- **划线点击**：painter 给每个 `<mark>` 打上 `data-highlight-id`，
  `useReaderHighlights` 增加点击命中（`attachClicks`）与多文档重绘目标，
  `SelectionToolbar` 用同一套 UI 服务两种主体（选区 / 被点击的划线）。
- **双页边缘翻页**：`useEdgeHover` 按**指针坐标**判定（不是覆盖层，避免吃掉页边
  的划选），并绑定每个章节 iframe 的 `mousemove`；`PageTurnEdges` 负责呈现。
- **快捷键提示**：`ReaderShortcutsHint` 在阅读区底边给出「按键 → 做什么」，动词跟着
  阅读模式走（双页 翻页 / 单页·TXT 滚动）；进度条随即移到视窗**顶部**，两条细条分居
  正文两侧，彼此之间不再需要分割线（dock 的底部偏移也回到只让开一行）。

### 验证

- 单测：818 passed（新增 22 条：painter 标记与命中、工具条双态、TXT/引擎两支路点击
  划线、边缘 hover 坐标判定与揭示、快捷键提示的双模式文案与底边排布、引擎
  `continuous` 属性与 `unload` 契约）。
- 真实浏览器（agent-browser + CDP）：连续流 24 项断言、分页回归 9 项断言，均 0 失败
  （vendored 引擎独立工装，见 `.scratch/continuous-harness/`）。工装发现并修掉三个
  真实缺陷：`unload` 未转发、同一章并发加载两次产生重复 entry、章节文档已被移除后
  仍在 rAF / `fonts.ready` 里取样式（`getBackground(null)` 抛错）。
- 应用内实测（`pnpm build` 的静态导出 + 静态服务，1280×800）：导入 EPUB → 单页连续
  流（`flow=scrolled` + `continuous`，3 章同流，滚到底跨到「第 3 / 3 章」，进度 46% →
  72%）→ 双页右边缘悬停出现翻页按钮 → 底边快捷键提示随模式显示 滚动 / 下翻正确文案，
  截图见 `.scratch/shots/`。
- **环境问题（与本次改动无关）**：本机 3000 端口的 `next dev` 在自动化浏览器里始终
  不完成 hydration——SSR HTML 与 RSC payload 都正常下发、chunk 全 200、react-dom 已
  执行、控制台无报错，但 DOM 上没有 React 内部属性、点击无响应；而同一份代码
  `pnpm build` 出来的静态导出一切正常（主题切换、导入、划线、连续流均实测可用）。
  上面那条「应用内实测」因此走的是静态导出。dev 起不来 hydration 的原因待单独排查。

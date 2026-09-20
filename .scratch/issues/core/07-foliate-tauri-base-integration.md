---
id: "07"
title: "Foliate-js 分页渲染引擎与 Tauri 2 桌面壳接入（底座落地）"
status: "open"
blocked_by: []
labels: ["ready-for-agent"]
---

# 07: Foliate-js 分页渲染引擎与 Tauri 2 桌面壳接入（底座落地）

**What to build:**
把阅读视窗从「按章节滚动渲染」升级为 readest 同源的 Foliate-js 分页渲染引擎（web component），并套上 Tauri 2 (Rust + WebView) 桌面壳，完成 ADR 0001/0007 的原始决策。这是 ADR 0009 记录的结构性欠账：当前自研 EPUB/TXT 内核（工单 06）在服务层接缝上已就绪，本工单只替换渲染层与容器层。

**Blocked by:** None（可立即开工；建议在 06 之后）

**Status:** open

### Acceptance Criteria

- [ ] 接入 foliate-js `View` web component：EPUB/MOBI/AZW3/FB2/CBZ 经真实引擎分页渲染（翻页、字号、进度 CFI），替换 jszip+sanitize 的滚动渲染分支（contentRegistry 接缝保留，解析服务退为文本提取用途）。
- [ ] 章节文本提取改走 Foliate spine `section.load()`（chapterSource 的 Foliate 分支，替换注册表 EPUB 分支）。
- [ ] 划词工具栏按 ADR 0007 融合进原生 AnnotatorToolbar（高亮/笔记旁的 AI 动作组），替换独立浮动层。
- [ ] Tauri 2 壳：Windows/macOS 打包、窗口标题/图标、文件关联打开（双击 .epub 调起导入）。
- [ ] 书库迁移：保留 books 表字节存储与哈希键；渲染引擎切换不改变 bookHash/总结/对话的键空间。
- [ ] 回归：248+ 既有测试全绿（或按接缝替换最小更新），新增 Foliate 渲染/提取/选区的组件测试。

### Notes
- 来源：ADR 0009 复盘结论——「基于 X」的底座假设必须有显式落地工单；本工单即是那张工单。

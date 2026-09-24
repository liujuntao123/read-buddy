---
id: "07"
title: "Foliate-js 分页渲染引擎与 Tauri 2 桌面壳接入（底座落地）"
status: "closed"
blocked_by: []
labels: ["ready-for-agent"]
---

# 07: Foliate-js 分页渲染引擎与 Tauri 2 桌面壳接入（底座落地）

**What to build:**
把阅读视窗从「按章节滚动渲染」升级为 readest 同源的 Foliate-js 分页渲染引擎（web component），并套上 Tauri 2 (Rust + WebView) 桌面壳，完成 ADR 0001/0007 的原始决策。这是 ADR 0009 记录的结构性欠账：当前自研 EPUB/TXT 内核（工单 06）在服务层接缝上已就绪，本工单只替换渲染层与容器层。

**Blocked by:** None（可立即开工；建议在 06 之后）
**Status:** closed

### Acceptance Criteria

- [x] 接入 foliate-js `View` web component：EPUB/MOBI/AZW3/FB2/CBZ 经真实引擎分页渲染（翻页、目录跳转、进度 CFI 持久化恢复），替换 jszip+sanitize 的滚动渲染分支（contentRegistry 接缝保留，解析服务退为文本提取用途）。
- [x] 章节文本提取改走引擎 spine（`sections[i].createDocument()`，vendored 源码核实后的真实 API；`load()` 返回 blob URL，留作回退），经 engineToContent 注册进 contentRegistry，总结/对话零改动生效。
- [x] 划词工具栏融合：选区在引擎 iframe 文档内捕获（load 事件挂载监听、iframe 坐标→页面坐标换算），四个 AI 动作与滚动路径共用 useQuickActions。ADR 0007 字面上的「readest 原生 AnnotatorToolbar 旁」在本独立代码库无该组件可融合，留待未来真接 readest 底座时对齐；独立应用形态下已无双弹窗冲突。
- [x] Tauri 2 壳：Windows 下 `tauri build` 管线验证通过（read-buddy.exe 产出，含静态前端嵌入与文件关联配置 + 双击 .epub → book-file-opened → 自动导入）；macOS 打包需在 mac 上执行（本机为 Windows，未验证）。
- [x] 书库迁移：保留 books 表字节存储与 SHA-256 哈希键；渲染引擎切换不改变 bookHash/总结/对话的键空间。
- [x] 回归：287 个测试全绿（基线 252 + 净增 35；bookLibrary/Workspace 等既有断言按接缝替换最小更新），新增引擎/FoliatePane/iframe 选区/快捷动作组件测试。

### Notes
- 来源：ADR 0009 复盘结论——「基于 X」的底座假设必须有显式落地工单；本工单即是那张工单。

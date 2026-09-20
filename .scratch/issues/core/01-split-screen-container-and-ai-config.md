---
id: "01"
title: "双栏布局分屏容器与 AI Provider 配置中心"
status: "closed"
blocked_by: []
labels: ["ready-for-agent"]
---
# 01: 双栏布局分屏容器与 AI Provider 配置中心

**What to build:**
在阅读器界面集成左右双栏分屏工作区，提供可折叠、可拖拽调宽（320px~600px）的 AI 伴读侧边栏容器，并在侧边栏与设置面板提供通用的 OpenAI 兼容协议配置中心（Base URL、API Key、Model ID、Max Turns、测试连接按钮），配置信息明文持久化保存在本地 IndexedDB。

**Blocked by:** None (can start immediately)

**Status:** closed (commit: 见 git log feat(01))

### Acceptance Criteria

- [x] 在 `readerStore` 与全新 `aiSidebarStore` 中建立侧边栏状态（展开/折叠、当前宽度、激活 Tab：总结/对话）。
- [x] 顶部导航栏具备 AI 侧边栏切换按钮，并支持快捷键 `Ctrl+/`（Windows）与 `Cmd+/`（macOS）平滑展开/收起。
- [x] 侧边栏边缘具备拖拽手柄（Resize Handle），支持在 320px ~ 600px 之间拖拽调宽，松开后自动记住当前宽度。
- [x] 实现 `AISettingsPanel` 配置中心，支持配置 Provider、Base URL、API Key、Model ID 与轮数配额（默认 10 轮）。
- [x] API Key 在界面输入框中提供显示/隐藏眼睛图标（默认 `password` 掩码视觉呈现）。
- [x] 提供“测试连接”按钮，通过向 Base URL 发送轻量请求验证模型可用性并给出视觉 Toast 反馈。
- [x] 配置信息直接保存到本地 IndexedDB `AISettings` 表中，重启应用后自动加载。
- [x] 为配置有效性验证、保存以及拖拽边界限制编写自动化单元测试。

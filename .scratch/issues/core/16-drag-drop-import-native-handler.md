---
id: "16"
title: "拖拽导入在安装版失效：Tauri 原生拖放吞掉了 HTML5 drop 事件"
status: "open"
blocked_by: []
labels: ["bug", "desktop", "ready-for-agent"]
---

### Problem

「把文件拖进窗口任意位置即可导入」只实现了 Web 侧的一半：

- 唯一的实现是 `Workspace.tsx:183-197` 的 HTML5 DnD（`onDragOver` / `onDragLeave` / `onDrop`，
  `IMPORT_PATTERN` :29，浮层 :235-241），happy-dom 测试覆盖在 `Workspace.test.tsx:124-135`；
- `src-tauri/tauri.conf.json:13-21` 没有设 `dragDropEnabled: false`，仓库里也没有任何原生
  拖放处理器（grep `dragDropEnabled|onDragDropEvent|onDragDrop|getCurrentWebview|DragDropEvent`
  在 `apps/read-buddy-app` 下 0 命中）。

Tauri 2 的窗口默认由原生拖放处理器接管，Windows 上会吞掉文件 drop，WebView 收不到 HTML5
`drop` 事件（tauri-apps/tauri#14373）。因此在浏览器调试版（`pnpm dev`）里拖拽导入可用，
在 NSIS 安装版里不可用——而 README 把它当作已发布功能。

发现来源：2026-09 文档与代码核对（README 审计）。README 已同步改为只承诺标题栏导入按钮。

### Acceptance Criteria

- [ ] 安装版（`pnpm build:installer` 产物）里把 `.epub` 拖进窗口任意位置能导入成功。
- [ ] 拖拽悬停时浮层出现、离开/落下后消失（现有 `Workspace.test.tsx` 的断言继续通过）。
- [ ] 浏览器调试版行为不回归。

### 可选实现

1. `tauri.conf.json` 的窗口配置加 `"dragDropEnabled": false`，把拖放交回 WebView（改动最小）；
2. 或保留原生接管，改用 `onDragDropEvent` 把路径交给 `read_book_file`（可以同时拿到真实路径，
   对大于内存的文件更友好）。

### 顺带发现（同一轮审计，未单独开票）

- **双击打开扩展名窄于格式表**：`tauri.conf.json:30-36` 只注册 `epub/mobi/azw3/fb2/cbz`，
  而 `src-tauri/src/lib.rs:12` 接受 `azw/prc/fbz/txt`——后四个无法双击打开。
- **启动竞态**：`lib.rs:23-29` 用固定 800ms 睡眠等前端挂监听器，慢启动会丢事件；
  `Cargo.toml` 没有 single-instance 插件，运行中再双击一本书会开第二个实例。
- **书架「最近阅读」排序**：`updatedAt` 既被阅读更新，也被索引/总结写入更新
  （`bookLibrary.ts:271,296`），所以一本只是被索引过的书可能排在刚读过的书前面。

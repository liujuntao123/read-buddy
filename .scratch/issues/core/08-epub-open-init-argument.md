---
id: "08"
title: "EPUB 打开必现「打开书籍失败，请重试」（view.init() 缺参 TypeError）"
status: "closed"
blocked_by: ["07"]
labels: ["bug", "ready-for-agent"]
---

### Problem

导入 EPUB 后提示「打开书籍失败，请重试」，但目录能正常识别。

根因（真书复现，Edge/CDP 驱动 `next dev` + Gutenberg 真实 EPUB）：
`vendor/foliate-js/view.js` 的 `View.init({ lastLocation, showTextStart })`
**解构其入参**，而适配层 `foliateEngine.ts` 调用了无参的
`await view.init()` → 每次首开必抛
`TypeError: Cannot destructure property 'lastLocation' of 'undefined'`。
`view.open()` 在 init 之前已成功解析出 sections/TOC，故目录仍可识别。

伴随隐患：`openIn` 在 `await view.init()` **之前**置 `rendered = true`，
init 一旦失败该引擎句柄永久无法重试（dev 下 React StrictMode 双挂载时
表现为无声卡死而非报错横幅）。

### Fix

- `openIn`：`view.init({})` 传对象；`rendered` 仅在 init 成功后置位，
  并发调用共享 in-flight promise，失败后可重试。
- 回归测试：`FakeFoliateView.init` 改为与 vendored 契约一致（解构入参，
  无参调用即抛），回退该修复会导致 11/13 用例失败。

### Acceptance Criteria

- [x] 真实 EPUB 经真实 UI 导入后渲染成功：relocate 触发、CFI 落库
      （`epubcfi(...)`）、目录跳转/翻页正常、无错误横幅。
- [x] 单元回归：`init` 必须收到对象参数（模拟 vendor 解构契约）。
- [x] `pnpm test` 289 全绿（基线 287 + 净增 2）；`pnpm typecheck` 通过。

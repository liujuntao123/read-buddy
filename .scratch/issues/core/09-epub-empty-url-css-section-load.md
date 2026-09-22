---
id: "09"
title: "《何为良好生活》导入后卡死在目录页，正文章节全部无法加载（CSS 空 url() 自引用致 section 加载崩溃）"
status: "closed"
blocked_by: ["07"]
labels: ["bug"]
---

### Problem

导入《何为良好生活：行之于途而应于心》（Epubor Ultimate 从 Kindle 转出的 EPUB）后，
阅读器只渲染首个 spine 项（内嵌目录页 text00000.html）；「下一章」、目录下拉跳转、
键盘翻页全部无效——任何导航到正文章节的操作都无声失败。

根因（从用户 App 的 IndexedDB blob 中恢复出该书的 OPF/NCX/CSS，并用同构 fixture
在真实浏览器 + `next dev` 复现）：

1. 该书正文（text00003–text00010，第一~八章）链接的 `OEBPS/flow0002.css`
   含一个空 `url()`（CSS 规范允许，语义为无效引用）。
2. vendored `foliate-js/epub.js` 的 `replaceCSS` 把空 href 交给 `loadHref`；
   `resolveURL('', cssPath)` 按 WHATWG URL 语义解析为**基址文件自身**，
   于是 CSS 把自己当作嵌套资源再次 `loadItem`（parents 含自身）。
3. `loadItem` 的循环引用保护（`parents.every(p => p !== href)`）此时跳过替换、
   走 `loadBlob` 直通：`createURL` 发出 `{type:'text/css', data: Promise<Blob>}`。
4. vendored `paginator.js` 的 CSS 预处理监听器对 Blob 调 `data.replace(...)` →
   `TypeError: data.replace is not a function`，沿 promise 链令
   `sections[N].load()` 拒绝 → paginator 打出 `Failed to load section N`
   并把导航吞掉（页面停留在原地）。
5. 目录页链接的 `flow0001.css` 无空 `url()`，故目录页能正常渲染——这正是
   「只能看到目录页，无法跳转到正文」的症状；恢复出的 lastCfi
   （spine index 2、227 字符处）也印证用户从未进入过正文。

### Fix

- `vendor/foliate-js/epub.js` `loadHref`：空引用（`url()`）提前原样返回，
  不再按 WHATWG 语义解析成基址自身（根因修复）。
- `vendor/foliate-js/paginator.js` CSS 变换监听器：`typeof data === 'string'`
  才做文本替换，非字符串（Blob 直通）原样透传（防御纵深：真实自引用 CSS
  也不再炸）。
- 回归测试 `src/services/library/epubEmptyUrlCss.test.ts`：在真实 seam
  （vendored `makeBook` + 真实 `Paginator` CSS 变换监听器）上用含空 `url()`
  的最小 EPUB 驱动 `sections[0].load()`；回退任一修复即红
  （复现 `TypeError: data.replace is not a function`）。

### Acceptance Criteria

- [x] 真实浏览器端到端：导入同构 fixture（结构还原自用户书籍数据：
      OPF spine text00000–text00010、NCX 嵌套 navPoint、flow0002.css 含空
      url()）后，目录页正常渲染，且「下一章」/目录下拉/键盘翻页均可进入正文。
- [x] 单元回归：含空 `url()` 的书 sections 加载返回 blob: URL；
      无空 `url()` 的对照组不受影响。
- [x] `pnpm test` 302 全绿；`pnpm typecheck` 通过。
- [x] 用户以原始书籍手动验证通过。

# 单页跨章滚动 · 浏览器验证工装

`vendor/foliate-js/paginator.js` 的 **连续滚动**（continuous）分支无法用 happy-dom
验证——它依赖真实排版：iframe 高度、`scrollTop`、`getBoundingClientRect`、滚动事件。
这个工装把 vendored 引擎单独挂到一个静态页面上，用 CDP 驱动真实浏览器跑断言。

## 跑法

```powershell
# 1) 准备运行时输入（不入库，见 .gitignore）
$h = ".scratch\continuous-harness"
New-Item -ItemType Directory -Force -Path "$h\vendor" | Out-Null
Copy-Item "apps\read-buddy-app\vendor\foliate-js" "$h\vendor\" -Recurse -Force
Copy-Item ".scratch\fixtures\mist-city.epub" "$h\" -Force
node "$h\make-long-book.mjs" "$h\long-book.epub" 10 60   # 10 章 × 60 段的高书

# 2) 起静态服务（后台）
node "$h\serve.mjs" (Resolve-Path $h) 3999

# 3) 用 agent-browser 打开并跑断言（脚本内容 base64 后交给 eval -b）
#    见本目录 assert-continuous.js / assert-paginated.js 顶部注释
```

## 断言覆盖

- `assert-continuous.js`：单页 `flow=scrolled` + `continuous` 属性下，
  滚到底部**内容持续增长**（跨章）、窗口滑动且最多 5 章、**`linear="no"` 的辅助
  章节永不入流**（书末的附录）、目录跳转**等于滚动到锚点**（已加载的章节不重建、
  被淘汰的章节重新加载）、章内锚点落在中段、**向上补章时阅读位置不漂移**、
  翻页键是滚动而非跳章、退出/重回连续流。
- `assert-paginated.js`：双页（分页）模式未被 vendor 补丁破坏——章内翻页、
  跨章翻页、`goTo`、锚点跳转、`unload` 事件（补丁新增，view.js 转发）、`setStyles`。

两份断言在真实 Chromium 上均 0 失败（2026-09，见 `.scratch/issues/core/15-*.md`）。
工装本身发现并修掉了两个真实缺陷：`unload` 事件无法穿透 shadow root（view.js 未转发）、
以及同一章可能被并发加载两次（产生重复 entry，滚动条与实际内容长度不一致）。

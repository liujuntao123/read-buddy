---
id: "12"
title: "目录层级修复：章/节不再平铺（保留 EPUB 嵌套 + 识别「部分」容器 + 补齐碎片标题）"
status: "closed"
blocked_by: ["11"]
labels: ["reader", "toc", "ready-for-agent"]
---

### Problem

用户反馈「书籍导航目录里的章和节是平铺的同一层级」。逐本解析 E 盘真实书籍后确认是**两种成因并存**：

1. **应用把已有的层级拍平了。**《何为良好生活》的 `OEBPS/toc.ncx` 是**真两级**
   （11 个一级「章」+ 70 个二级「§节」，用 `text00003.html#sigil_toc_id_N` 锚点定位）。
   vendored foliate 的 `childGetter.$$` 只取直接子节点，`parseNCX` 也正确地建了
   `subitems` 树 —— 层级在解析层没丢，是 `foliateEngine.flattenToc()` 深度优先
   展平成 `{label, href}` 时把 level 扔了，`tocItems()` 也没有 depth 字段，
   `ReaderDock` 于是把 81 条渲染成一屏兄弟节点（标题写「共 81 节」）。

2. **书本身的目录就是平的。**
   - 《思考快与慢》NCX 48 条全部 depth=1、零嵌套；「第一部分 … 第N章」的层级只写在
     标题文字里。
   - 《看见孩子》NCX 34 条同样零嵌套；「第N部分 / 准则N / 实战N」只在标题里。

3. **附带缺陷 A：分级器认不出「第一部分」。** `CONTAINER_SUFFIXES` 是
   `['卷','部','篇']` 且以字符类 `[卷部篇]` 匹配，而「第一部**分**」结尾是「分」，
   永远匹配不上 → 返回 null。实测三本书所有「第N部分」都是 null，于是
   `buildSpineNodes` 找不到任何容器，**连 AI 全景大纲（PanoramaDialog「章节大纲」）
   也是全平铺 depth=0**。

4. **附带缺陷 B：《思考快与慢》134 个 spine 段没有标题。** 正文被按体积切成
   `part0006_split_000/001/…`，NCX 只锚 `_split_000`；182 个 spine 段里只有 48 个
   能拿到 TOC 标题，其余退化成「第 N 节」，污染阅读器章节标题与全书微大纲。

### Fix

**Layer 1 — 保留层级（引擎 + UI）**

- `foliateEngine.ts`：新增 `TocItem { label; href; depth }`；`flattenToc` 按
  pre-order 递归并**盖章 depth**（文档顺序恰好就是父在子前，消费者按 depth 缩进即可
  还原树）；`tocItems()` 返回 `TocItem[]`；接口类型同步。
- `ReaderDock.tsx`：目录 popover 按 depth 缩进（`--spacing-3 × depth`，depth 0 用原
  label，子级用 `Text type="supporting"`）；行上带 `data-depth` 便于观测；
  表头由固定「共 N 节」改为「N 章 · M 节」（扁平书仍保持旧文案）。

**Layer 2 — 让书的层级成立（纯规则，零模型成本）**

- `layeredSegmenter.ts`：
  - 容器后缀改为**多字符可选项** `['部分','卷','部','篇']` 并以 `(?:…)` 交替匹配，
    「第一部分 / 第1部分 xxx」成为容器；
  - 新增并导出 `FIXED_PART_PATTERN`：Level-3 合成标题「第 3 部分」（部分后无名字）
    仍返回 null，避免定长分段节点被误判成容器；
  - **层级归属改为位置判定**：`depth = !isContainer && lastContainerId ? 1 : 0`
    （原为必须 `level === 'leaf'`）。《看见孩子》的「准则2…」「实战2…」本身没有
    章/节后缀，靠后缀永远进不了二级。
- `sectionHierarchy.ts`：删掉重复的 `FIXED_PART_PATTERN`，改从 `layeredSegmenter` 导入。
- `foliateEngine.ts`：新增 `splitFragmentOf` + `inheritSplitFragmentTitles` ——
  `<base>_split_NNN`（NNN>0）且**紧邻的前一个有标题的段共享同一 base** 时才继承标题，
  普通 spine 的空档（《何为良好生活》无 TOC 条目的 text00002）绝不臆造。

### Acceptance Criteria

- [x] 《何为良好生活》（真实 EPUB）：81 条目录以 depth 0=11「章」/ depth 1=70「节」
      展开，§节保留各自 `#sigil_toc_id_N` 锚点，点击跳转到章内锚点而非章首。
- [x] 《思考快与慢》（真实 EPUB）：182 个节点中「第一部分 系统1，系统2」depth=0，
      「第1章 一张愤怒的脸和一道乘法题」depth=1 且 `parentChapterId` 指向第一部分；
      第二部分下的第10章同理。
- [x] 《看见孩子》（真实 EPUB）：36 个节点中「第1部分」depth=0、「准则2 真相不唯一」
      depth=1（无章/节后缀也能进二级）、「第2部分」depth=0、「实战2…」depth=1。
- [x] 《思考快与慢》：带标题的 spine 段由 48 → 177，未标题段由 134 → 5
      （只剩 TOC 之前的 titlepage + part0000..0003），不再出现「第 100 节」这类填充标题。
- [x] 「第 3 部分」仍判为 null（`FIXED_PART_PATTERN`），定长分段书籍不被误判成容器；
      「序言」出现在首个容器**之前**时保持 depth 0（《何为良好生活》前辅文不嵌套）。
- [x] `pnpm typecheck` 通过；`pnpm test` 464 tests 全绿；`pnpm build` 通过。

### Notes

- 本次只做 Layer 1 + Layer 2（规则可测、无模型调用）。**Layer 3（AI 校正章节表）**
  仍未做，用于规则够不到的情况：补《看见孩子》目录缺失的「准则1 / 实战1」、剔除误入
  目录的献词句、给破损标题重命名。落库/回滚方案待设计 —— 倾向**解析层覆写**
  （override 表优先于原文件），不建议改写 EPUB 字节流（会改 book hash、丢阅读进度）。
- 只读排查脚本保留在 `.scratch/tools/`：`inspect-toc.mjs`（NCX/nav 层级 + 深度直方图）、
  `spine-vs-toc.mjs`（spine 与目录覆盖率）、`classify-probe.mjs`（分级器探针）。

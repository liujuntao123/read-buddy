---
id: "13"
title: "统一书籍节点模型：章=第一层、节=第二层、最小节点为视角（含内部标识符重命名与落库）"
status: "closed"
blocked_by: ["12"]
labels: ["reader", "agent", "summary", "toc", "ready-for-agent"]
---

### Problem

用户反馈「章和节的概念以及叙述混乱、有歧义」，逐层排查确认是**两套并存的节点模型**加上**各界面各自措辞**：

1. **两套模型。** 阅读器目录（ReaderDock）用 EPUB 自带的 NCX/nav 嵌套算层级，而总结、伴读索引、全景画像、Agent prompt 全部用应用自己的分段结果（一个 spine 段 = 一个节点）。
   实测三本真实书籍，两者结论互不相同：
   - 《何为良好生活》：正文 **11 个文件**，目录 **81 条真两级**（11 章 + 70 节，节是同一文件内的 `#sigil_toc_id_N` 锚点）。索引因此只有 11 个「章」、一个「节」都没有；阅读器标题却显示「§3 伦理学与语言」——**总结说自己在总结「本节」，实际总结的是整个章文件**。
   - 《思考快与慢》：**182 个 spine 段** + **48 条平铺目录**，「第一部分 / 第N章」只写在标题里。目录 popover 把 48 条渲染成同级兄弟并称「共 48 节」。
   - 《看见孩子》：36 段 + 34 条平铺目录，「第N部分 / 准则N」同样只在标题里。
2. **措辞逐界面漂移。** 同一个节点，有的地方按全局序号叫「第 N 章」，有的地方叫「第 N 节」，有的地方叫「第 N 个节点」：`全书共 N 章`（IndexingStatusBar）、`书籍目录 · 共 N 节`（ReaderDock）、`《第 N 章 · 标题》`（CitationCard）、`读至第 N 节`（Bookshelf）、`第 N 章「标题」`（promptAssembly）……读者无法判断任何一个数字的含义，业务逻辑也随之分叉。
3. **内部标识符同样分叉**：`ChapterNode` / `sectionIndex` / `chapterTitle` / `ChapterSummary` / `chapter_nodes` 等把「章」硬编码进了本应中性的节点概念。

### Fix

**Layer 1 — 唯一节点模型（`src/services/bookNodes`）**

- 三个层词唯一出处：章（chapter，第一层）/ 节（section，第二层）/ 段（chunk，无结构书的定长分段）；`depth` 0/1。
- `shapeOfNodes()` 给出节点形状与**最小节点**；`formatNodeCounts / formatBookScale / formatOrdinal / formatNavLabel` 统一所有计数、序号、面包屑与导航文案。
- `buildNodeTree()` / `resolveNodeAtPosition()` / `resolveNodeHierarchy()`：节点树与「当前阅读位置 → 节点」的唯一入口。
- 层级 = `max(目录声明的层深, 标题分级补出的层深)`（`stampDepths`）：目录自带的嵌套永不丢弃，分级器只补目录漏掉的那一层。

**Layer 2 — 节点以目录条目为准（锚点级「节」）**

- `extractAnchoredNodeText(html, anchorIds)`：一次 DOM 遍历同时产出纯文本与每个锚点的**行首偏移**，偏移与文本天然对齐。
- `layeredSegmenter.buildTocNodes()`：目录条目 → 节点，锚点给出各自的 `[startOffset, endOffset)`；目录比正文文件更糙时（《思考快与慢》），相邻碎片段并回同一条目。
- `OpenedBookContent` 新增 `getTocEntries()` / `getSpineAnchors()`；引擎与 EPUB 解析器实现之。锚点定位不到的条目直接丢弃，不造幽灵节点。

**Layer 3 — 三个功能面统一到最小节点**

- **总结**：`nodeSource` 改为按节点全局范围切片，总结视角 = 当前最小节点；面板头部由机械 pills 改为「面包屑 + 标题 + 字数/更新时间」。
- **伴读索引**：微大纲只跑最小节点（容器章不消耗模型调用）；进度文案 `正在建立全书微大纲 (n/m 节)`。
- **全景画像 / Agent prompt / 工具**：全部改用节点形状与层词；`get_book_outline` 返回 `totalNodes` + `shape` + 每条的 `kind`。
- **阅读器目录与导航**：目录行按 `stampDepths` 的层深缩进（平铺 NCX 的书也能正确成两级），表头 `书籍目录 · 11 章 · 70 节`，按钮按最小节点显示「上一节/下一节」或「上一章/下一章」。

**Layer 4 — 词表与落库**

- 内部重命名：`ChapterNode→BookNode`、`chapterId→nodeId`、`parentChapterId→parentNodeId`、`sectionIndex→nodeIndex`、`chapterTitle→nodeTitle`、`ChapterSummary→NodeSummary`、`chapterSource→nodeSource`、`extractChapterText→extractNodeText` 等。
- `readerStore` 明确区分物理与逻辑：`nodeIndex→spineIndex`、`setSection→setPosition`（并新增段内 `anchor`）。
- Dexie v5：删除 `chapter_nodes` / `chapterSummaries`，新建 `book_nodes` / `node_summaries`（粒度变了，不迁移，重新索引即可；书架、进度、对话、设置不受影响）。
- 文档：`CONTEXT.md` 词表重写为「Book Node / Chapter / Section / Chunk / Minimal Node / Spine Section / Directory / Node Anchor / Reading Position」；新增 ADR 0010。

### Acceptance Criteria

- [x] 《何为良好生活》（真实 EPUB，`src/test/realBooks.test.ts` 走真实 vendored loader → 引擎目录/锚点 → 分段 → 节点模型）：节点为 **10 章 · 70 节**，最小节点 = 节；70 个节各自有互不重叠的文本范围且切片以其标题开头；每个节都挂在 8 个正文章之一上（目录把「第一章」和「§1」指向同一个锚点时，章退回段首保留自己的标题行）。
- [x] 微大纲只为最小节点生成：`briefTotal` = 最小节点数，容器章不产生模型调用（`bookIndexStore.test.ts` 的 `1 章 · 2 节` / 2 次模型调用用例）。
- [x] 全应用不再有写死的「章 / 节」文案：计数、序号、面包屑、导航、进度、引用卡片、Agent prompt 与工具输出全部经 `@/services/bookNodes` 生成（`nodeKindLabel` / `formatNodeCounts` / `formatBookScale` / `formatNodeOrdinal` / `formatNavLabel` / `formatProgress`）。
- [x] 阅读器目录与导航按节点模型：表头 `书籍目录 · 11 章 · 70 节`（单层书 `书籍目录 · 48 章`，不再是「共 N 节」），行缩进用 `stampDepths` 的层深（平铺 NCX 也能正确成两级），按钮按最小节点显示「上一节/下一节」或「上一章/下一章」。
- [x] 平铺目录按标题补齐层级：《思考快与慢》式「第一部分 / 第N章」→ 章 + 节；《看见孩子》式「第N部分 / 准则N（无后缀）」→ 章 + 节。单测覆盖（`layeredSegmenter.test.ts` 平铺目录用例、`ReaderDock.test.tsx` 平铺 NCX 用例、`nodeKind.test.ts` 的 `stampDepths`）。
- [x] Dexie v5 升级：旧 `chapter_nodes` / `chapterSummaries` 被丢弃，`book_nodes` / `node_summaries` 可用；书架、阅读进度、对话与 AI 设置不受影响（`database.migration.test.ts` 覆盖 v4→v5、v3→v5、全新安装三种路径）。
- [x] `pnpm typecheck` 通过；`pnpm test` 66 files / 528 tests 全绿；`pnpm build` 通过。

### Notes

- **同一锚点的章与节。** 《何为良好生活》的 NCX 把「第一章 伦理与伦理学」和「§1 伦理学这个名称」都指向 `text00003.html#sigil_toc_id_1`。同一位置、不同层的条目必须都保留：层深较深的那条拿走锚点与正文，较浅的那条退回物理段首（那里正是它自己的标题行）。否则 8 个章会只剩最后 1 个，70 个节全部挂到「序言」名下。同一层重复（「版权页」/「序言」指向同一文件）仍然合并为一条。
- **前置页算章。** 《何为良好生活》的 10 个第一层节点里有 3 条是前置页（目录/版权页合并后的序言/…）。节点模型只认层级，不判断文学意义上的「是不是真章」；issue 12 里写的「11 章」正是这 3 条 + 8 个正文章。
- **测试环境限制（非本次改动引入）。** happy-dom 的 XML 解析器（vendored foliate 与 `parseEpub` 都经由它）会拒绝《思考快与慢》的 `content.opf` 与《看见孩子》的 `toc.ncx`，报 `XML parsing error`，而两个文件本身都是良构的（真实浏览器可正常解析，《何为良好生活》的同结构 NCX 在同样环境下解析正常）。因此这两本书的「平铺目录 → 两级节点」规则由单测覆盖，真实书籍用例只断言目录不可读时诚实退回物理段节点（不臆造层级）。`epubParser` 的 OPF/spine 读取代码本次未被改动，已在 diff 中确认。
- **未做。** 「AI 校正章节表」（issue 12 的 Layer 3）仍未做，规则够不到的目录按现状处理。
- 本次改动的迁移守卫：`ReadBuddyDatabase` 的表属性名必须与 `stores()` 里的 store 名一致（Dexie 只在 store 名下挂载属性），否则类型通过而运行时是 `undefined`。

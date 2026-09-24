# 架构

本文只在**代码之外**补充说明：模块怎么分工、数据怎么流、哪些不变量跨模块。常量、类型、
schema、提示词措辞与界面文案一律以代码为准，本文不复制它们（复制就会漂移）。

| 想知道 | 去哪看 |
| --- | --- |
| 一个词在这个项目里是什么意思 | [`CONTEXT.md`](../CONTEXT.md)（词表，唯一语言契约） |
| 某个设计**为什么**是这样 | [`docs/adr/`](adr/) |
| 产品是什么、怎么用 | [`README.md`](../README.md) |
| 怎么发版 | [`releasing.md`](releasing.md) |
| 协作与工单约定 | [`docs/agents/`](agents/) |

---

## 1. 分层

```
Tauri 2 壳 (src-tauri)  ──  系统 WebView
  └─ Next.js App Router 静态导出 (src/app)          ← layout.tsx / page.tsx 只是壳
       └─ Workspace (components/Workspace.tsx)      ← 组合，无业务
            ├─ HeaderBar / ReaderDock / ReaderProgressBar
            ├─ ReaderPane（TXT 滚动）｜ FoliatePane（引擎分页）
            └─ AISidebar：SummaryTab / ChatTab / HighlightsTab
```

界面层用 Astryx 设计系统 + StyleX token（`src/app/globals.css`、`src/theme/`），
**没有** Tailwind / DaisyUI / Radix。图标用 lucide-react。

| 目录 | 职责 | 备注 |
| --- | --- | --- |
| `src/components/` | 呈现与交互 | 不直接调模型；不知道「第几章」，只问节点模型 |
| `src/store/` | Zustand 状态与编排 | 有依赖的 store 走工厂注入，纯状态用单例（ADR 0014） |
| `src/services/bookNodes/` | **节点模型**：层级词、层级判定、节点树、Node View、页面类别 | 「这是第几章第几节」的唯一答案（ADR 0010） |
| `src/services/segmentation/` | 三级切分引擎 | 纯函数，输入文本 → `BookNode[]` |
| `src/services/library/` | 解析、打开、书库、渲染引擎适配 | `contentRegistry` 是「当前这本书的内容」的唯一出处 |
| `src/services/reader/` | 阅读位置、章节导航、选区、划线、`readerLink` 总线 | 不依赖 store 的具体实现 |
| `src/services/summary/` | 三段式总结与 Map-Reduce | 结构/措辞在 `prompts.ts`，测试断言其唯一性 |
| `src/services/chat/` | 轮数配额、提示词装配、选区快捷动作 | |
| `src/services/agent/` | 伴读 Agent：上下文、编排、提示词金字塔、阅读工具、画像、微大纲 | |
| `src/services/ai/` | Provider 传输、错误分类、模型列表、连通性 | 只有这里知道 SDK |
| `src/services/db/` | Dexie 表与仓库 | 迁移史写在 `database.ts` 类注释里 |

## 2. 打开一本书

1. **导入**：文件字节进 IndexedDB（`services/library/bookLibrary`），书架行记 `bookHash`。
2. **解析**：`epubParser` / `txtParser` / `foliateEngine` 把书交给 `contentRegistry`，
   公布 `OpenedBookContent`（含 `kind: engine | monolithic | structured`、目录、段内锚点）。
3. **切分**（无模型，**每次打开书都跑**）：`agent/bookIngestion` → `layeredSegmenter` →
   `book_nodes`；同时记录产生它的分段规则与节点形状。TXT 的切分结果另外落一份
   `bookSegmentations.virtualSections` 供阅读器渲染——两份来自同一次切分，偏移量因此天然一致。
4. **索引**（有模型，**手动触发**：状态栏的「生成伴读索引」或画像对话框）：`agent/readingAgentIndex`
   先做全书画像（一次调用），再按优先级排队生成每个**最小节点**的微大纲（并发 2，逐节点落库，
   中断后下次接着跑）。**它不在导入时自动开跑**，这是 ADR 0004 的「AI 由人触发」策略在全书索引上的延续；
   没有配置模型时停在 `awaiting-key`，**是可见地跳过而不是静默跳过**。
5. **阅读**：`readerStore` 只记物理位置；界面通过 `bookNodes` 的 Node View 得到
   「第几章第几节」，总结 / 对话 / 目录 / 进度条共用这一个答案。

## 3. 跨模块不变量

改代码前值得先读这几条——它们每一条都对应过一次真实的 bug。

1. **偏移量索引的是拼接后的全文。** `[startOffset, endOffset)` 切开的必须是同一个
   连续字符空间，拼接方式由分段器持有（`SPINE_JOIN`），调用方不得另写一份。
2. **物理位置 ≠ 逻辑节点。** 视口位置是「物理段序号 + 段内锚点」（Reading Position），
   节点序号由节点模型推导（Node View）。持久化字段名必须说明自己装的是哪一种（ADR 0011）。
3. **层级词只有一个出处。** 章 / 节 / 段的文案、计数、面包屑、导航按钮、提示词里的
   层级词全部来自节点模型，任何地方都不许写死「章」「节」（ADR 0010）。
4. **最小节点是视角。** 总结、微大纲、伴读大纲都作用于这本书实际存在的最深一层；
   容器章（只用来分组的章）永远不消耗模型调用。
5. **导航只有一条规则**（`services/reader/chapterNavigation`）：按文档顺序走，
   跳过指向当前位置的行；引擎书与分段书只是两个 adapter（ADR 0013 / 0016）。
6. **划线是一个「引用」**，不是 DOM 偏移、Range 或 CFI：引擎每次换章都会重建文档，
   所以划线靠 引文 + 前后文 定位，重绘幂等（ADR 0018）。
7. **两套 id 不合并**：`book_nodes` 的 `${bookHash}:n_${nodeIndex}` 与
   `node_summaries` 的 `${bookHash}:${nodeIndex}` 有意不同（ADR 0015）。
8. **引擎句柄没有可选成员**；主题 / 排版 / 分页是一次 `applyPresentation`，
   引擎支不支持由引擎自己报告（ADR 0012）。
9. **AI 调用由人触发。** 总结、全书画像、对话都要读者按下按钮；唯一自动的是
   分段（不需要模型，见 ADR 0004 与 `store/segmentationStore.ts`）。

## 4. 伴读 Agent

四层上下文金字塔（`services/agent/promptPyramid.ts`）是一个**概念契约**，实际装配是：
系统提示词 = 全书画像 + 全书节点矩阵（L2）+ 当前节点标题/面包屑 + 引文（L0）；
用户轮 = 当前节点正文开头 1,500 字的节选（L1）+ **完整**历史 + 提问；工具结果（L3）由模型
自己调用后进入下一轮推理。历史消息不做静默滑窗（ADR 0006），也没有 token 预算/裁剪逻辑——
所有上限都是字符数上限。

四个第一方工具（`services/agent/readingTools.ts`）：

| 工具 | 作用 |
| --- | --- |
| `get_book_outline` | 目录 + 微大纲矩阵，分页 |
| `read_node_passage` | 任意节点的原文切片 |
| `search_book_text` | 全书关键词检索，带精确偏移 |
| `locate_in_reader` | 反向驱动阅读器跳转并高亮（经 `readerLink` 总线，产出证据卡片） |

Agent 与渲染引擎之间只有 `services/reader/readerLink` 一条总线：Agent 发 `LocateRequest`，
两个阅读面板订阅它，因此 Agent 层不需要认识任何引擎。

## 5. 错误与边界

- 所有面向读者的 AI 错误都经过 `services/ai/errorMessages.describeAIError` 分类
  （网络 / 鉴权 / 限流 / 模型不存在 / 上下文过长 / 服务端 / 未知），SDK 原文不外露；
  总结与对话都提供「重试」与「去设置」两个出口。
- 「这一页值不值得总结」是**离线规则**（`services/bookNodes/nodeContent`），不是模型调用；
  判错的方向永远是「多显示一个按钮」，不是「少显示一个」（ADR 0017）。
- 窄于 768px 时侧栏脱离为抽屉；`useViewportWidth` 是唯一断点出处。
- API Key 明文存本机（ADR 0008），界面只做掩码。

## 6. 已声明但未落地

代码里这些字段/表/常量目前**没有生产者或读者**。它们不是待办承诺，只是残留；看到它们时不要
以为有对应功能：

- `reading_entities` 表与 `ReadingEntityRepository`：全仓库没有写入方（只有删书时清理）。
- `BookNode.startCfi` / `endCfi`、`VirtualSection.startCfi`：只声明，没有生产者；引擎跳转走
  `href` / `spineIndex` / 目录锚点。
- `BookPanoramaRecord.isFullyIndexed`：永远写 `false`。
- `AgentTurnTraceRecord.reasoningText`：从不填充；`agent_turn_traces` 是只写表，
  界面上的轨迹用的是消息自带的 `toolCalls`。
- `LEVEL3_SNAP_WINDOW`：没有被读取的常量。


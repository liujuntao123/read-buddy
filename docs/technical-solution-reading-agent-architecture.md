# 基于阅读特化 Agent 的 AI 辅助栏重构技术方案设计文档

> **文档状态**：Ready for Implementation  
> **面向系统**：`readest-plus` 桌面端电子书阅读器  
> **核心定位**：纯客户端内嵌、全书维度认知、具备自主翻书与定位能力的阅读特化 Agent  

---

## 1. 架构演进背景与核心定位

### 1.1 背景与现状分析
在 `readest-plus` 既有的实现中（参见 `docs/readest-plus 桌面端应用设计文档.md` 与 ADR 0002），AI 辅助栏主要由两个静态面板构成：
1. **章节总结面板（Summary Tab）**：被动读取当前视口章节文本，向模型发起单向请求生成固定的三段式总结。
2. **伴读对话面板（Chat Tab）**：截取当前章节的有限文本片段，拼接最近几轮对话历史，以简单的硬编码提示词进行问答。

**当前架构的深层痛点**：
- **缺乏全书宏观认知**：模型仅能看到当前视口章节的局部切片，对整本书的架构、后续走向、核心主旨、伏笔埋设完全失明，无法回答读者提出的跨章节、人物全貌或全书宏观探讨。
- **书籍导入缺乏前置整理与索引**：非结构化书籍（如单体 TXT）仅靠简单的正则切分，未在导入期整理出结构化章节目录、章节偏移量（Offset）与章节简介，导致后续所有交互都缺乏结构化骨架支撑。
- **交互被动且能力单一**：AI 仅能被动回答文字，无法主动调用工具翻阅书籍其他章节、无法检索全书关键词、无法反向驱动阅读器滚动和高亮定位。

### 1.2 核心设计定位：具备“全书上帝视角”的特化伴读 Agent
我们确立将辅助栏全面重构为**高度特化的“全书维度阅读 Agent（Whole-Book Reading Specialist Agent）”**：
1. **全书宏观洞察（Whole-Book Holistic Perspective）**：
   Agent 具备全书维度的宏观视野，自第一章起即掌握全书的故事大纲、人物命运走向、核心论点架构与结局回响，自如地为读者串联伏笔、深度解析动机与脉络。
2. **Agent 驱动的导入期初始化整理**：
   在书籍导入时，由系统流水线与 Agent 协同完成：智能自适应章节切分、统一全局 Offset 坐标体系建立、全书全景画像提取，以及轻量化章节微摘要（Briefs）大纲生成，为后续全书对话提供坚实的骨架数据。
3. **自主阅读工具箱（Reading Tools）**：
   赋予 Agent 自主查阅指定章节原文、全书快速关键词搜索、沉淀角色/设定卡片，以及**反向驱动阅读器视窗精确跳转定位与高亮**的能力。
4. **纯客户端内嵌原生轻量架构**：
   基于现有的 Tauri 2 + Next.js/React 19 + Vercel AI SDK 构建，零外部运行时依赖，内存级毫秒响应，安装包极致精简（< 15MB）。

---

## 2. 系统总体架构与技术选型

本方案坚持**“高内聚、零依赖、高性能”**原则，整体架构分为数据层、索引层、Agent 核心编排层与阅读器联动交互层：

```
+-----------------------------------------------------------------------------------------+
|                                    readest-plus                                         |
|                                                                                         |
|  ┌───────────────────────────────────────────────────────────────────────────────────┐  |
|  │                             UI & 交互联动层                                       │  |
|  │  - 主阅读视窗 (Foliate Engine / TXT Scroll Pane)                                  │  |
|  │  - Agent 伴读工作台 (思考折叠流、工具调用可视化轨迹、原文定位高亮卡片)             │  |
|  └─────────────────────────────────────────▲─────────────────────────────────────────┘  |
|                                            │ 驱动跳转 / 传递选区与视口                  |
|  ┌─────────────────────────────────────────▼─────────────────────────────────────────┐  |
|  │                        阅读特化 Agent 核心编排引擎                                │  |
|  │  - 全书维度四层上下文金字塔 (Context Pyramid Assembler)                            │  |
|  │  - 专属阅读工具箱 (Outline, ReadPassage, SearchText, LocateInReader)             │  |
|  │  - 流式打字机驱动与状态机 (基于 Vercel AI SDK Tool Calling)                        │  |
|  └─────────────────────────────────────────▲─────────────────────────────────────────┘  |
|                                            │ 存取全书元信息与章节切片                   |
|  ┌─────────────────────────────────────────▼─────────────────────────────────────────┐  |
|  │                      导入期书籍整理与微索引流水线                                 │  |
|  │  - 多格式三级自适应章节切分引擎 (目录页过滤 + 启发式多正则 + 语义平滑定长)         │  |
|  │  - 统一全局 Offset 映射系统 (Global Char Offset <-> EPUB Spine/CFI)               │  |
|  │  - 异步微摘要 (Brief) 调度队列 (单次全景画像 + 50~100字全书章节微大纲矩阵)        │  |
|  └─────────────────────────────────────────▲─────────────────────────────────────────┘  |
|                                            │ 持久化存储                                 |
|  ┌─────────────────────────────────────────▼─────────────────────────────────────────┐  |
|  │                       本地数据库存储层 (Dexie / IndexedDB)                        │  |
|  │  - books / chapter_nodes / book_panoramas / reading_entities / conversations      │  |
|  └───────────────────────────────────────────────────────────────────────────────────┘  |
+-----------------------------------------------------------------------------------------+
```

---

## 3. 书籍章节切分引擎与统一 Offset 坐标体系设计

### 3.1 现实场景中的电子书格式挑战
电子书格式多样且制作质量参差不齐：
1. **标准规范 EPUB**：包含完整的 NCX/NAV 目录与规范的 Spine 脊项列表。
2. **畸形单脊 EPUB（Monolithic Spine EPUB）**：全书只封装进一个或两个巨大的 `content.html`（几万甚至几十万字），原生 TOC 缺失或仅有一项。
3. **单体纯文本 TXT**：无任何元数据标签，全凭作者书写习惯，排版混乱、标题格式不一。
4. **书籍前置目录页的伪装误判**：许多 TXT 或小说开头包含几千字的“全书目录列表”，其中密密麻麻包含“第一章”、“第二章”，如果直接正则匹配，会在正文开始前误切出上百个只有一句话的空假章节。

---

### 3.2 三级渐进式章节切分算法（Layered Segmentation Pipeline）

为确保书籍 100% 稳健切分，设计以下三级渐进式切分算法：

```
                           [ 原始输入文本 / 电子书 ]
                                      │
                                      ▼
                        ┌───────────────────────────┐
                        │ Level 1: 原生 TOC/Spine   │ 是
                        │ 结构是否完整且有效？      ├──────► 输出原生章节列表
                        └─────────────┬─────────────┘
                                      │ 否 (TXT / 畸形 EPUB)
                                      ▼
                        ┌───────────────────────────┐
                        │ Level 2: 启发式多模式扫描 │ 成功 (置信度 ≥ 0.75)
                        │ 目录页过滤 + 规则探测器   ├──────► 输出规范虚拟章节
                        └─────────────┬─────────────┘
                                      │ 失败 / 置信度不足
                                      ▼
                        ┌───────────────────────────┐
                        │ Level 3: 语义平滑定长分段 │ 截取段落边界 (\n\n)
                        │ 保底引擎                  ├──────► 输出规整切片章节
                        └───────────────────────────┘
```

#### Level 1：原生结构探测与畸形降级
- 对于 EPUB/MOBI/FB2，解析其 Navigation Document (`<nav epub:type="toc">`) 或 NCX (`toc.ncx`)。
- **单脊退化检测**：若全书 `sectionCount <= 2` 且单章节字数 $> 25,000$ 字符，判定为**单脊畸形电子书**，直接转入 Level 2 规则扫描器进行正文二次切分。

#### Level 2：启发式多规则扫描与前置目录页过滤
针对无目录书籍，重点攻克“误切前置目录页”与“多排版模式”两大难题：

1. **前置目录页过滤算法（TOC Page Filtering Algorithm）**：
   - 算法扫描前 12,000 字中的所有候选标题；
   - 若发现连续 5 个以上的候选标题之间的正文字符跨度 $< 100$ 字符，判定该区间为**书籍前置目录页（Table of Contents Manifest）**；
   - 记录目录页的终止偏移量 `tocEndOffset`，强制从 `tocEndOffset` 之后开始判定真正的正文章节起始点，彻底根除假章节！

2. **多模式正则表达式矩阵**：
   ```typescript
   export const HEADING_PATTERNS = [
     // 模式 A: 规范中文大章节 (第X章/回/节/卷/集/幕/篇/部 + 可选标题)
     /^[ \t]*(第[0-9一二三四五六七八九十百千零两]+[章回节卷集幕篇部])[ \t]+([^\n]{0,35})$/m,
     // 模式 B: 序号加标点 (如 "1. 风起之地"、"一、 绪论")
     /^[ \t]*([0-9一二三四五六七八九十百千]+[、. ])[ \t]*([^\n]{1,30})$/m,
     // 模式 C: 英文/标准学术章节 (Chapter 1 / Part I / Section 3)
     /^[ \t]*(Chapter|SECTION|Part|Book)[ \t]+([0-9IVXLCDM]+|[A-Z]+)\b[ \t]*([^\n]{0,40})$/im,
     // 模式 D: 特殊附属章节 (序言、尾声、后记等)
     /^[ \t]*(引子|序言|自序|前言|尾声|后记|番外|结语|附录)[ \t]*([^\n]{0,25})$/m,
   ];
   ```

3. **置信度评分机制（Confidence Scoring）**：
   - **序号单调递增性（40%）**：提取标题中的序号转为数字，检验是否连续递增；
   - **章节长度方差合理度（30%）**：每个章节的字数处于正常分布区间（1,500 ~ 12,000 字）；
   - **章节密度（30%）**：识别章节总数在合理区间（10 ~ 300 章）；
   - 综合得分 $\ge 0.75$ 直接采纳，低于 $0.75$ 则降级至 Level 3。

#### Level 3：语义平滑定长分段保底（Semantic Paragraph Boundary Snapping）
- 目标长度设定为 `7,000` 字符（介于 6,000 ~ 8,000 之间）；
- 从目标点向前回退搜索双换行段落分隔符 `\n\n` 或换行符 `\n`；
- 确保绝对不在句子或段落中途中断，章节统一命名为 `第 N 部分`。

---

### 3.3 统一 Offset 坐标体系设计（Unified Locating System）

设计一套跨格式统一的章节数据结构 `ChapterNode`，使得阅读器渲染、DOM 选区与 Agent 工具调用共享同一套坐标基准：

```typescript
/** 统一章节节点定义 */
export interface ChapterNode {
  /** 唯一全局 ID: `${bookHash}:ch_${sectionIndex}` */
  chapterId: string;
  bookHash: string;
  /** 逻辑章节序号 (0-based 连续序号) */
  sectionIndex: number;
  /** 章节规范标题 (如 "第一章 风起青萍") */
  title: string;

  /** 全书统一字符坐标系 (Global Continuous Character Space) */
  startOffset: number;       // 本章在全书纯文本流中的起始字符下标 (闭区间)
  endOffset: number;         // 本章在全书纯文本流中的结束字符下标 (开区间)
  charCount: number;         // 本章纯文字符总数

  /** 阅读引擎物理锚点 (针对 EPUB/Foliate 引擎) */
  spineIndex?: number;       // 原生 Spine 序号
  startCfi?: string;         // 起始段落的 EPUB CFI 锚点
  endCfi?: string;           // 结束段落的 EPUB CFI 锚点

  /** 树形层级扩展 */
  depth: number;             // 目录层级深度 (0: 顶层, 1: 卷, 2: 章)
  parentChapterId?: string;  // 父级章节 ID (支持分卷管理)

  /** Agent 初始化微摘要与实体 */
  brief?: string;            // 50~100字极简微摘要 (全书大纲用)
  keyEntities?: string[];    // 本章登场的关键人物/术语
  indexStatus: 'pending' | 'indexing' | 'ready' | 'failed';
}
```

#### 双向坐标映射原理（Bidirectional Locating）
1. **全书字符坐标连续化（Global Flattening）**：
   将各章节清洗后的纯文本在逻辑上拼接映射为一条连续字符流，各章记录 `[startOffset, endOffset)`。
2. **Agent 引用 $\rightarrow$ 阅读器视窗（Locate In Reader）**：
   - 当 Agent 在回答中指出关键事实并带有偏移量时：
     - **TXT 阅读器**：直接根据 `startOffset` 计算对应的虚拟章节并平滑滚动到字符段落；
     - **EPUB 阅读器**：通过 `spineIndex` 快速跳转对应 Spine，利用相对偏移量高亮对应 DOM 节点，触发高亮呼吸动画。
3. **选区划词 $\rightarrow$ 绝对 Offset（Selection Tracking）**：
   读者在正文中划词提问时，系统自动计算划词片段在全书中的全局字符偏移量，作为精准锚点注入 Agent 上下文。

---

## 4. 书籍导入期 Agent 初始化与全书微索引流水线

### 4.1 四阶段渐进式流水线（Progressive Readiness）

为了兼顾“导入即开即读（零等待）”与“全书 Agent 深度整理”，设计四阶段渐进式初始化流水线：

```
[ 用户选择文件导入 ]
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│ 【Phase 1: 物理提取与内容指纹】 (耗时 < 100ms)                │
│ - 计算 SHA-256 bookHash                                     │
│ - 提取基础元数据 (标题、作者、封面)                         │
│ - 原始字节存入 IndexedDB 'books' 表                          │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 【Phase 2: 章节切分与统一 Offset 映射】 (耗时 < 300ms)       │
│ - 运行三级渐进切分算法，构建 ChapterNode 列表与 Offset 映射 │
│ - 写入 'chapter_nodes' 表                                   │
│ - ★ 此时主阅读器已可立即秒开阅读，实现零等待！              │
└──────────────────────────────┬──────────────────────────────┘
                               │ (后台异步流式启动)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 【Phase 3: Agent 全景画像构建】 (耗时 ~ 2s, 单次模型请求)    │
│ - Agent 获取全书目录列表 + 前言/序章/末尾切片               │
│ - 生成《全书全景画像》(Book Panorama)                       │
│   (作品类型、核心主线纲要、主要角色库、主题思想)            │
│ - 写入 'book_panoramas' 表                                  │
└──────────────────────────────┬──────────────────────────────┘
                               │ (后台异步优先级队列)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 【Phase 4: 全书章节微摘要异步生成】 (Background Queue)       │
│ - 采用优先级调度算法 (Priority Queue)                        │
│   • Priority 0: 读者当前正在阅读的章节 (即时加速)           │
│   • Priority 1: 开篇前 3 章 (奠定全书核心基调)              │
│   • Priority 2: 其余章节后台批量并发提炼                    │
│ - 为每个章节生成：50~100 字 Brief 微摘要 + 核心实体          │
│ - 写入 'chapter_nodes.brief' 字段                           │
└─────────────────────────────────────────────────────────────┘
```

---

### 4.2 章节极简微摘要（Chapter Brief）生成规范与 Token 控制

导入期为各章节生成 **50 ~ 100 字的极简微摘要（Micro-brief）**：
- **目标长度**：严格限定在 **50 ~ 100 字（约 60 ~ 120 Tokens）**；
- **提取策略**：对章节正文只截取“前 2,000 字 + 后 1,000 字”（起因与转折结果），大幅降低输入 Token 消耗；
- **Prompt 模板**：
  ```markdown
  【任务】用极其简练客观的语言（不超过80字），提炼本章发生的核心事件进展、剧情转折及新出场人物。
  【要求】严禁寒暄与废话，直接输出单行陈述句。
  【本章标题】{chapterTitle}
  【正文切片】
  {chapterHeadAndTailText}
  ```
- **核心价值**：
  一本 100 章的长篇书籍，全书所有章节的 Brief 汇总仅需约 **8,000 Tokens**！
  这意味着在后续的所有伴读对话中，**Agent 能够将整本书所有章节的微大纲一次性装入 System Prompt**，从而真正建立起无死角的全书宏观大局观。

---

## 5. 阅读特化 Agent 架构与全书维度上下文组织

### 5.1 全书维度认知与上帝视角定位

Agent 拥有**全书维度的全局认知权限（God's-eye View）**：
- 掌握整部书的情节走向、伏笔归宿与人物终局；
- 能够站在全书高度剖析前后呼应、角色动机与主题脉络；
- 为读者提供兼具大局观与深度剖析能力的伴读支持。

---

### 5.2 四层上下文金字塔模型（Context Pyramid）

设计分层动态上下文装配引擎，兼顾局部微观细节与全书宏观脉络：

```
                                  ▲
                                 / \
                                / L0\     ◄── 焦点层 (300~800 Tokens)
                               /─────\        划选文本片段、光标所在段落与引文
                              /  L1   \   ◄── 局部层 (1,500~2,500 Tokens)
                             /─────────\      当前阅读章节标题、当前章完整微摘要
                            /    L2     \ ◄── 全书骨架层 (2,000~4,000 Tokens)
                           /─────────────\    全书画像 + 全书所有章节微大纲矩阵
                          /      L3       \◄── 动态外挂层 (按需工具调用)
                         /─────────────────\  自主检索到的任意章节原文详细切片
```

| 层次 | 包含内容 | 注入方式 | Token 开销 | 核心作用 |
| :--- | :--- | :--- | :--- | :--- |
| **L0: 焦点层 (Focus)** | 用户选中的文本片段 (`quoteText`)、所在段落的前后上下文。 | 划词提问时注入用户提示词 | ~300 - 800 | 提供微观精准语义，解答特定语句/词汇疑惑。 |
| **L1: 局部层 (Chapter)** | 当前读者打开的章节标题、当前章微摘要、当前章节正文关键段落。 | 每次伴读固定注入 | ~1,500 - 2,500 | 维持当前章节的阅读语境，感知读者当前位置。 |
| **L2: 全书骨架层 (Panorama)**| 书名、作者、全书题材主旨画像、**全书全部章节的 Micro-Briefs 目录矩阵**。 | 作为 System Prompt 核心骨架全量注入 | ~2,000 - 4,000 | 赋予 Agent 完整宏观脉络，掌握全书事件链与人物登场。 |
| **L3: 动态外挂层 (On-demand)**| 由 Agent 自主调用工具查询到的**全书任意章节原文详细切片**、关键词检索匹配列表。 | Agent 触发 Tool Call 时动态回传并参与下轮推理 | ~1,000 - 2,500 | 供 Agent 进行前文/后文原文考证，提供确凿依据。 |

---

### 5.3 专属阅读工具箱（Reading Tools）

Agent 拥有 4 个第一方特化阅读工具，通过标准 JSON Schema 挂载至模型调用流：

#### 1. `get_book_outline`（查询全书完整目录与章节微简介）
- **功能**：获取全书所有章节的目录列表及微简介（Briefs），支持按章节范围分页查阅。
- **参数**：`{ startSection?: number, limit?: number }`

#### 2. `read_chapter_passage`（调取全书任意章节详细原文切片）
- **功能**：当需要考证全书任何章节的详细原文（如伏笔、对话细节、结局描述）时调用。
- **参数**：
  ```typescript
  {
    sectionIndex: number;    // 目标章节序号 (0-based)
    charOffset?: number;     // 章节内起始偏移量 (可选，默认 0)
    length?: number;         // 提取字符长度 (默认 1,500，上限 3,000)
  }
  ```

#### 3. `search_book_text`（全书范围全文关键词检索）
- **功能**：在全书所有章节中进行关键词检索，快速定位特定人名、地名、线索物品出现的全部章节与精确 Offset。
- **参数**：
  ```typescript
  {
    query: string;           // 检索词或短语
    maxResults?: number;     // 最大返回条数 (默认 5)
  }
  ```
- **返回值**：`[{ sectionIndex, chapterTitle, matchSnippet, charOffset }]`

#### 4. `locate_in_reader`（反向驱动阅读器精确定位与高亮）
- **功能**：Agent 在回答中指出关键原文事实时，**主动调用该工具驱动阅读器视窗跳转至目标章节的对应段落**，并在正文中施加临时高亮呼吸动画！
- **参数**：
  ```typescript
  {
    sectionIndex: number;    // 目标章节序号
    charOffset?: number;     // 目标字符偏移量
    quoteSnippet: string;    // 需要高亮的精准文本片段
  }
  ```

---

### 5.4 动态提示词组装模板（System Prompt Specification）

```typescript
export function assembleAgentSystemPrompt({
  bookTitle,
  currentSectionIndex,
  currentChapterTitle,
  panorama,
  allChapterBriefs,
}: AssembleSystemPromptOptions): string {
  // 全书所有章节微大纲矩阵
  const fullTOC = allChapterBriefs
    .map((b) => `• 第 ${b.sectionIndex + 1} 章《${b.title}》：${b.brief || '（待生成微简介）'}`)
    .join('\n');

  return `你是一位专业、渊博且具备深刻洞察力的全书特化伴读智能体（Whole-Book Reading Specialist Agent）。
你正在陪伴读者阅读《${bookTitle}》。

【读者当前阅读视口】
- 读者目前停留在：第 ${currentSectionIndex + 1} 章《${currentChapterTitle}》

【全书宏观画像与主旨】
- 题材类型：${panorama?.genre ?? '未标注'}
- 全书主旨概要：${panorama?.summary ?? '暂无全景概要'}
- 核心人物库：${panorama?.mainCharacters?.join('、') ?? '未标注'}
- 世界观/架构背景：${panorama?.worldSetting ?? '无特定设定'}

【全书完整章节脉络大纲（共 ${allChapterBriefs.length} 章）】
${fullTOC}

【核心行为准则与能力】
1. **全书上帝视角洞察**：你拥有全书维度的完整认知。无论是探讨当前章节的细节，还是梳理全书主线伏笔、跨章节人物动机、结局呼应，你都应站在整部作品的高度给出深具启发性的解答。
2. **主动调用工具考证**：当需要引用全书某一处的精准对话或考证伏笔时，自主调用阅读工具（如 search_book_text、read_chapter_passage）查阅原文进行印证。
3. **驱动阅读器协同**：当你引用了有价值的原文时，可调用 locate_in_reader 工具，主动带领读者翻页跳转到该处原文，实现真正的沉浸式伴读。
4. **语言风格**：沉稳、典雅、富有启发性，条理清晰，观点明确。`;
}
```

---

## 6. 数据模型与存储架构设计（Schema Evolution）

基于现有的 Dexie 本地数据库（`apps/readest-app/src/services/db/database.ts`），进行向下兼容的扩展升级：

### 6.1 实体 Schema 扩展定义

```typescript
// ==================== 1. 章节节点表 (chapter_nodes) ====================
export interface ChapterNodeRecord {
  /** 主键: `${bookHash}:${sectionIndex}` */
  id: string;
  bookHash: string;
  sectionIndex: number;
  title: string;
  startOffset: number;        // 全书连续纯文本中的起始字符偏移量
  endOffset: number;          // 结束字符偏移量
  charCount: number;          // 章节字符数
  startCfi?: string;          // EPUB CFI 起始锚点
  spineIndex?: number;        // EPUB 原生 Spine 序号
  depth: number;              // 目录层级 (0: 顶层, 1: 卷, 2: 章)
  parentChapterId?: string;
  brief?: string;             // 50~100字极简微摘要
  keyEntities?: string[];     // 本章登场的关键人物/术语
  indexStatus: 'pending' | 'indexing' | 'ready' | 'failed';
  updatedAt: number;
}

// ==================== 2. 全书全景画像表 (book_panoramas) ====================
export interface BookPanoramaRecord {
  /** 主键: bookHash */
  bookHash: string;
  genre?: string;             // 题材分类 (如 "科幻/硬科幻", "历史专著")
  summary: string;            // 200~300字全书主旨概要
  worldSetting?: string;      // 世界观/历史背景设定
  mainCharacters?: string[];  // 核心人物列表
  totalChapters: number;
  isFullyIndexed: boolean;    // 是否全书微摘要全部索引完毕
  createdAt: number;
  updatedAt: number;
}

// ==================== 3. 实体笔记/词条表 (reading_entities) ====================
export interface ReadingEntityRecord {
  id: string;                 // `${bookHash}:${entityName}`
  bookHash: string;
  name: string;
  category: 'character' | 'location' | 'term' | 'clue';
  description: string;
  firstAppearedSection: number;
  relatedSections: number[];
  updatedAt: number;
}

// ==================== 4. Agent 步骤与轨迹表 (agent_turn_traces) ====================
export interface AgentTurnTraceRecord {
  id: string;                 // UUID
  conversationId: string;
  messageId: string;
  toolCalls: Array<{
    toolName: string;
    args: Record<string, unknown>;
    resultSnippet?: string;
    durationMs: number;
  }>;
  reasoningText?: string;     // 模型的思考推导过程
  createdAt: number;
}
```

### 6.2 Dexie 数据库版本迁移定义

```typescript
// 数据库平滑升级配置
this.version(2).stores({
  books: 'hash, title, importedAt, updatedAt',
  settings: 'id',
  summaries: 'id, bookHash, sectionIndex, updatedAt',
  conversations: 'id, bookHash, sectionIndex, updatedAt',
  messages: 'id, conversationId, createdAt',
  segmentations: 'bookHash',
  // 新增全书 Agent 特化索引表
  chapter_nodes: 'id, bookHash, sectionIndex, indexStatus',
  book_panoramas: 'bookHash',
  reading_entities: 'id, bookHash, category, name',
  agent_turn_traces: 'id, conversationId, messageId',
});
```

---

## 7. 辅助栏 UI/UX 伴读工作台重构

### 7.1 交互架构：全功能伴读工作台（Agent Workspace）

```
+-----------------------------------------------------------------------------+
|  顶部状态条: 《三体》  | 全书共 35 章 (已索引 35/35)  | [⚙️ 设定] [✕ 关闭] |
+-----------------------------------------------------------------------------+
|                                                                             |
|  ┌─── 对话流视窗 (Conversation Stream) ──────────────────────────────────┐  |
|  │                                                                       │  |
|  │ [👤 读者]                                                             │  |
|  │ 第一章里提到的“射手和农场主”假说，在整部书的后文是如何验证的？         │  |
|  │                                                                       │  |
|  │ [🤖 伴读 Agent]                                                       │  |
|  │ ┌── 🔍 Agent 思考与工具调用轨迹 (已折叠) ───────────────────────────┐  │  |
|  │ │ ⚙️ 调取全书脉络大纲 (第 1 ~ 35 章)...                             │  │  |
|  │ │ 📖 检索全书关键词 "农场主假说" 与 "黑暗森林"...                   │  │  |
|  │ │ 结果：在第 30 章与第 33 章中形成终极呼应。                        │  │  |
|  │ └───────────────────────────────────────────────────────────────────┘  │  |
|  │                                                                       │  |
|  │ “射手与农场主假说”表面上是开篇的科学悖论，但在全书的宏观架构中，它实  │  |
|  │ 际上构成了后续 **“黑暗森林法则”与宇宙社会学公理** 的微观哲学先导。    │  |
|  │                                                                       │  |
|  │ 在后文 **第 33 章《宇宙的农场》** 中，这一假说得到了终极映射...        │  |
|  │                                                                       │  |
|  │ 核心原文印证：                                                        │  |
|  │ ┌── 📜 全书证据卡片 ───────────────────────────────────────────────┐  │  |
|  │ │ 《第 33 章》 偏移量 24,180 字符                                  │  │  |
|  │ │ "...整个宇宙就是一片黑暗森林，每个文明都是带枪的猎人..."          │  │  |
|  │ │                                              [ 📍 跳转至该章节 ]  │  │
|  │ └──────────────────────────────────────────────────────────────────┘  │  |
|  └───────────────────────────────────────────────────────────────────────┘  |
|                                                                             |
+-----------------------------------------------------------------------------+
| 💬 话题进度: 2 / 10 轮  [ ➕ 开启新议题 ]                                   |
| [ > 引用正文选区: "物理学不存在了..."                               [✕] ]    |
| [ 输入你的疑问，或探讨全书剧情与伏笔...                           ] [ 🚀 发送 ]|
+-----------------------------------------------------------------------------+
```

### 7.2 核心交互亮点
1. **思考推导与工具轨迹折叠呈现（Reasoning & Tool Accordion）**：
   将大模型的思考过程（Thinking Block）与工具调用细节（“正在查阅第 33 章原文”、“正在检索全书关键词”）收纳在优雅的折叠容器中，兼顾结果的可读性与过程的可追溯性。
2. **全书原文定位卡片与高亮呼吸光效（Source Citation & Reader Sync）**：
   Agent 在回答中引用任意章节的段落时，自动渲染为结构化卡片；读者点击 **[ 📍 跳转至该章节 ]**，主阅读器瞬间平滑翻页至该位置，并对目标句子触发持续 2 秒的高亮呼吸动画，实现无缝联动。
3. **导入索引进度指示（Silent Background Indexing）**：
   书籍导入后，阅读器直接打开可读，顶部仅显示微小的点状进度条（如 `● 正在建立全书微大纲 (15/100 章)`），完全不阻塞读者当前阅读。

---

## 8. 实施规划与分阶段落地路线图（Roadmap）

推荐采用 **4 个阶段有序推进落地**：

```
 Phase 1: 基础设施与章节切分引擎
 ├── 升级 Dexie 数据库 Schema (新增 chapter_nodes, book_panoramas 等)
 ├── 重构书籍切分引擎：实现目录页过滤、启发式正则矩阵与全局字符 Offset 映射
 └── 编写单元测试验证 TXT/EPUB 坐标计算正确性
       │
       ▼
 Phase 2: 导入期 Agent 初始化流水线
 ├── 实现 BookPanorama 全书全景画像生成器
 ├── 实现后台异步章节微摘要 (Brief) 调度队列 (单章节限 50~100 字)
 └── 支持断点续传与本地持久化
       │
       ▼
 Phase 3: 全书阅读特化 Agent 编排引擎
 ├── 实现四层上下文金字塔组装器 (assembleAgentSystemPrompt)
 ├── 挂载 4 个核心 Reading Tools (大纲、读取章节切片、全书关键词检索、阅读器反向跳转)
 └── 完善 Tool Calling 流式交互与轨迹记录
       │
       ▼
 Phase 4: UI/UX 伴读工作台重构与端到端验证
 ├── 重构 AISidebar/ChatTab：增加工具调用卡、原文定位卡与跳转事件
 ├── 与阅读器视窗 (Foliate/TXT Scroll) 建立高亮呼吸联动通信
 └── 整体功能验证与自动化测试验收
```

---

## 9. 结论

本技术方案确立了轻量、敏捷、全书维度的阅读特化 Agent 架构：
1. **全书宏观认知**：Agent 具备全书维度的全局视野，自开篇起即可串联全书伏笔与脉络，提供高屋建瓴的伴读体验。
2. **切分与 Offset 统一**：通过“前置目录页过滤 + 多正则启发式 + 平滑定长”的三级自适应切分机制，建立跨格式的全局连续字符 Offset 映射。
3. **秒级导入与极简微大纲**：通过异步调度队列与 50~100 字微摘要规范，实现全书章节大纲高效装入上下文，保持极低的 Token 开销与流畅的导入体验。
4. **自主翻书与阅读器双向联动**：通过专属阅读工具集，实现查阅全书原文、证据精确定位与反向驱动阅读器翻页的高效协同。

# readest-plus 桌面端应用设计文档

## 1. 产品定位与核心价值

`readest-plus` 是一款基于开源电子书阅读器 **[readest](https://github.com/readest/readest)** 打造的 **AI 增强型桌面端深度阅读客户端**。

### 1.1 背景与差异化定位
- **readest 原生现状**：`readest` 基于 Tauri 2 + Next.js/React 19 + Foliate-js 构建，具备极佳的排版与电子书渲染能力。但其内置的 AI 体验偏重于全书向量化索引（RAG/Indexing 模式），对普通读者存在门槛：长书需经历较长的预处理与嵌入（Embedding）耗时、消耗大量 Token，且缺乏“进入章节即获脉络”的即时性。
- **readest-plus 核心定位**：**零门槛、零预处理、即开即读的沉浸式 AI 阅读伴侣**。
  - **即时感知**：用户翻至任意章节，无需全书向量化，按需提取当前章节正文并提供结构化摘要。
  - **伴读探讨**：主阅读区与 AI 辅助区双栏并列，支持“划词精准追问”与“基于当前章节的上下文自由探讨”。
  - **开箱即用**：支持兼容 OpenAI 协议的任意主流/本地大模型（DeepSeek、OpenAI、Claude、Ollama 等）。

---

## 2. 系统架构与技术选型

经过对开源底座 `readest` 源码架构的深度对齐，确立以下技术选型与集成方案：

| 模块 / 层次 | 技术选型 | 方案决策与关键考量 |
| :--- | :--- | :--- |
| **应用容器** | **Tauri 2 (Rust + WebView)** | 保持与 `readest` 既有工程完全一致，安装包体积小（< 15MB）、内存开销极低（< 50MB）、跨平台（Windows / macOS / Linux）。 |
| **前端基底** | **Next.js 16 + React 19 + TypeScript** | 与 `readest-app` 前端体系原生兼容，支持现代 React 响应式渲染与 Hook 体系。 |
| **阅读渲染引擎** | **Foliate-js (Web Components / Iframe)** | 利用其成熟的 EPUB/MOBI/PDF 流式与分页渲染能力，提取章节与选区文本。 |
| **状态管理** | **Zustand 5** | 继承 `readest` 的 `readerStore` 与 `bookDataStore`，新增 `aiSidebarStore` 管理侧边栏与总结状态。 |
| **AI 交互协议** | **Vercel AI SDK (`ai` + `@ai-sdk/openai-compatible`)** | 统一大模型请求标准，开箱即支持流式打字机（ReadableStream）、终止请求（AbortController）及错误重试。 |
| **UI 组件与样式** | **Tailwind CSS v4 + DaisyUI + Radix UI + Lucide React** | 保证双栏视觉语言统一，支持自适应暗黑/浅色模式与主题色跟随。 |
| **本地持久化** | **IndexedDB (Dexie / Turso libSQL WASM)** | 本地存储 AI 配置、章节总结缓存与对话历史，保障完全离线可查、隐私安全。 |

---

## 3. 界面布局与交互架构 (UI/UX)

应用采用 **可调节双栏分屏（Split-Pane Layout）** 交互架构：

```
+-----------------------------------------------------------------------------+
|  顶部状态/导航栏 (HeaderBar: 书名、章节进度、字体/排版设置、AI 侧边栏开关)        |
+------------------------------------------------------+----------------------+
|                                                      |  AI 辅助工作区       |
|                                                      |  (固定/可拖拽侧边栏) |
|               主阅读视窗 (左侧)                       |                      |
|                                                      |  [ Tab 1: 章节总结 ] |
|  - Foliate 阅读引擎渲染 EPUB/TXT/PDF 正文             |  [ Tab 2: 伴读对话 ] |
|  - 支持鼠标滚轮 / 键盘方向键翻页                      |                      |
|  - 正文选区划词呼出 AI 快捷操作浮窗                   |  - 结构化总结卡片    |
|    [ 💡 解释 ] [ 📝 总结 ] [ 🌐 翻译 ] [ 💬 追问 ]    |  - 流式打字对话流    |
|                                                      |  - 对话轮数进度胶囊  |
|                                                      |  - 对话输入框与引用  |
|                                                      |                      |
+------------------------------------------------------+----------------------+
|  底部进度栏 (FooterBar: 章节名称、百分比、快速跳转滑块)                         |
+-----------------------------------------------------------------------------+
```

### 3.1 侧边栏交互规范
1. **展开/折叠控制**：
   - 顶部工具栏设有专门的 `AI 侧栏切换` 按钮；
   - 支持全局快捷键：`Cmd + /` (macOS) 或 `Ctrl + /` (Windows) 快速切换侧边栏状态；
   - 侧边栏支持通过边缘拖拽把手（Resize Handle）在 `320px ~ 600px` 之间自由调节宽度，宽度状态本地记忆。
2. **主题跟随**：
   - AI 侧边栏背景色、文字对比度与正文阅读器完全保持同调（跟随日间白、羊皮纸护眼黄、夜间深色等主题）。

---

## 4. 核心功能规范与实现方案

### 4.1 初始就绪态（AI Provider 配置中心）
- **功能目标**：允许用户零依赖接入任意 LLM。
- **配置项**：
  - `Provider Type`：OpenAI Compatible（通用兼容）、DeepSeek、Claude、Ollama（本地模型）等；
  - `API Key`：鉴权秘钥（前端输入，以明文安全保存在客户端本地 IndexedDB，界面视觉掩码展示）；
  - `Model ID`：支持下拉预设或自由输入（如 `deepseek-chat`、`gpt-4o-mini`、`claude-3-5-sonnet`）；
  - `Temperature` 与 `Max Tokens`：默认 `0.6`，支持进阶微调；
  - `Turn Quota`：单话题对话轮数上限（默认 10 轮，可调整 5 ~ 20 轮）。
  - `Turn Quota`：单话题对话轮数上限（默认 10 轮，可调整 5 ~ 20 轮）。
- **健康检测**：提供“测试连接”按钮，发送轻量级 ping 请求验证连通性与余额状态。

---

### 4.2 书籍章节自适应定义与分段机制 (Chapter Segmentation)

考虑到并非所有电子书都有清晰规范的目录（如大单卷 TXT、转换后单页 HTML、未切分 EPUB）：

1. **结构化书籍（标准 EPUB / 含完整 TOC 目录）**：
   - 直接读取原生 TOC 导航节点及 spine `sectionIndex` 作为章节边界。
2. **非结构化 / 无目录单体书籍（如大单卷 TXT、无 TOC 电子书）**：
   - **智能正则探测**：客户端加载书籍时检测目录有效性，若目录为空或仅单一单体节点，运行正则启发式扫描器：
     `/(第[0-9一二三四五六七八九十百千]+[章回节卷]|Chapter\s+\d+|SECTION\s+\d+)/i`
   - **交互式询问提示**：
     - 若成功匹配出若干章节锚点，顶部弹出轻量横幅：*“检测到本书无目录，已自动识别并生成 {N} 个章节，是否应用？”*
     - 用户点击“应用”，系统生成**虚拟章节（Virtual Sections）**并映射进阅读进度；
   - **保底分段策略**：
     - 若正则未匹配成功或用户选择取消，提供**固定字数分段**方案（默认约每 6,000 ~ 8,000 字自动划分为一个虚拟章节），确保长篇单文件也能获得精确的局部提炼。

---

### 4.3 功能一：当前章节结构化总结 (Chapter Summarization)

#### 4.3.1 严格手动触发机制 (Explicit Manual Trigger)
- **触发逻辑**：翻至新章节时，系统**绝不自动发起模型调用**，防止用户翻页/选章时无效消耗 Token。
- **界面行为**：
  - 监听当前章节索引；
  - 检查 IndexedDB 本地缓存：
    - **若已缓存**：立即呈现总结卡片，并在右上角提供“🔄 重新生成”按钮；
    - **若未缓存**：侧边栏呈现清晰的空状态操作卡：展示当前章节标题与字数，提供一个明显的 **“⚡ 生成本章总结”** 按钮。
  - 用户点击后开始流式生成，并提供“⏹ 停止生成”按钮。

#### 4.3.2 超长章节两阶段分块汇总 (Map-Reduce Pipeline)
针对篇幅超过 12,000 字的大章节：
1. **Map 阶段（分块摘要）**：
   - 将章节拆分为若干逻辑块（每块约 6,000 ~ 8,000 字，块间 500 字重叠）；
   - 并行或流水线提炼每个分块的关键要点；
   - UI 阶段性反馈：*“正在提炼第 1/2 部分...”*。
2. **Reduce 阶段（整合提炼）**：
   - 将各子块摘要合并送入总控 Prompt，提炼为统一权威的三段式 Markdown 总结；
   - UI 阶段性反馈：*“正在合成整章脉络...”*。

#### 4.3.3 总结结构规范（Prompt Engineering）
AI 输出需强制遵循以下三段式结构化 Markdown：
```markdown
### 📌 章节核心要义
（用 2~3 句话高度概括本章核心事件或主要论点）

### 🗺️ 关键内容脉络
1. **[阶段/论点一]**：具体事实或阐述推导...
2. **[阶段/论点二]**：转折或深化...
3. **[阶段/论点三]**：结论或留下的悬念...

### 💡 核心概念与关键术语
- **[概念/术语名]**：在书中的具体含义与作用
```

---

### 4.4 功能二：AI 伴读智能对话与轮数上限机制 (Turn Quota)

#### 4.4.1 章节级上下文与防剧透设定
- **系统预设（System Prompt）**：
  - 角色设定：“你是一位渊博、敏锐且富有启发性的伴读助手。当前用户正在阅读《{bookTitle}》第 {chapterIndex} 章《{chapterTitle}》。”
  - 边界防剧透：“请主要围绕当前章节的内容展开解答与剖析。除非用户明确要求透露后续情节，否则严禁主动剧透后续章节内容。”
- **上下文拼装**：将当前章节核心文本、书本基础元数据以及本话题内的历史对话消息注入请求列表。

#### 4.4.2 显式轮数上限机制 (Turn Quota)
- **拒绝隐蔽滑动窗口**：不采用后端静默截断历史消息的机制，避免用户看到屏幕上有某句话但模型却“失忆”。
- **显式配额管理**：
  - 每个 Conversation 话题设定明确的**轮数上限**（默认 10 轮问答）；
  - 界面输入框上方展示轮数进度指示器（如胶囊角标：`💬 3 / 10 轮`）；
  - 话题内的所有问答 100% 完整作为上下文送入模型，保持思维连贯；
  - **配额耗尽处理**：
    - 当达到 10/10 轮时，输入框禁用，转为提示：*“本轮话题探讨已达上限（10/10），建议开启新话题以保持解答精准度”*；
    - 界面提供快捷按钮：`[ ➕ 开启新话题 ]`、`[ 📋 导出/复制本轮对话 ]`；
    - 历史话题永久归档在对话记录列表，可随时翻阅回顾。

#### 4.4.3 划词/选区快捷交互（Selection Actions）
1. **选区监听与原生标注栏融合**：监听正文阅读视窗的选区事件（Text Selection），直接在 Foliate 原生标注工具栏（Highlight/Note）旁扩展 AI 快捷操作组，点击页面空白处自动关闭，杜绝双弹窗视觉冲突。
2. **快捷操作项**：
   - **💡 解释**：简明扼要解析该语句或词汇的背景涵义；
   - **🌐 翻译**：对照翻译选中段落；
   - **💬 追问**：将选中文本作为 `> 引用` 自动填入 AI 对话框，聚焦光标等待用户输入个性化问题；
   - **📝 提炼**：针对选中长段落进行要点提炼。
3. **流式交互**：对话采用 SSE 流式打字机渲染，支持中途“停止响应（Stop）”及“重新生成（Regenerate）”。

---

## 5. 数据模型与存储设计

采用本地存储（IndexedDB / SQLite），设计以下实体表结构：

### 5.1 数据实体 Schema

#### 1. `AISettings` (配置表)
```typescript
interface AISettings {
  provider: 'openai' | 'deepseek' | 'claude' | 'ollama' | 'custom';
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTurnsPerTopic: number; // 单话题对话轮数上限，默认 10
}
```

#### 2. `BookSegmentation` (章节自定义分段规则表)
```typescript
interface BookSegmentation {
  bookHash: string;
  strategy: 'native' | 'regex' | 'fixed-length';
  regexPattern?: string;
  chunkLength?: number;
  virtualSections: Array<{
    virtualIndex: number;
    title: string;
    startCfi?: string;
    charOffset: number;
  }>;
}
```

#### 3. `ChapterSummary` (章节总结缓存表)
```typescript
interface ChapterSummary {
  id: string;             // 主键: `${bookHash}_${sectionIndex}`
  bookHash: string;       // 书籍哈希标识
  sectionIndex: number;   // 章节（或虚拟章节）索引
  chapterTitle: string;   // 章节标题
  modelUsed: string;      // 生成该总结的模型
  summaryContent: string; // Markdown 格式的总结正文
  pipeline: 'single' | 'map-reduce'; // 提炼管道类型
  createdAt: number;      // 创建时间戳
  updatedAt: number;      // 更新时间戳
}
```

#### 4. `Conversation` & `Message` (对话历史表)
```typescript
interface Conversation {
  id: string;             // 对话 UUID
  bookHash: string;       // 关联书籍
  sectionIndex?: number;  // 关联章节（可选）
  title: string;          // 对话标题（默认取首句提问）
  turnCount: number;      // 当前轮数 (0 ~ maxTurnsPerTopic)
  isClosed: boolean;      // 是否已达轮数上限关闭
  createdAt: number;
  updatedAt: number;
}

interface Message {
  id: string;             // 消息 UUID
  conversationId: string; // 关联对话 ID
  role: 'user' | 'assistant' | 'system';
  content: string;        // 消息正文（Markdown）
  quoteText?: string;     // 划词引用的正文片段
  createdAt: number;
}
```

---

## 6. 异常处理与边界情况设计

1. **网络超时与 API 报错**：
   - 显式给出具体错误类型（网络连通失败、API Key 无效、配额用尽/429、模型不存在）；
   - 卡片内提供“重试（Retry）”与“快速修改配置（Go to Settings）”入口。
2. **纯图片/扫描型书籍（如扫描 PDF/漫画）**：
   - 当章节正文字符数 $< 50$ 且存在非文本元素时，提示：“当前章节正文为图像或字数极少，无法提取纯文本总结。”
3. **窗口最小化或窄屏适配**：
   - 视窗宽度 $< 768px$ 时，双栏自动转为可滑出式抽屉（Drawer/Sheet）模式，优先保障正文排版不被挤压。

---

## 7. 实施路线图 (Implementation Roadmap)

- **Phase 1: 基础设施与双栏容器集成**
  - 在 `readest` 阅读器视图中打通左右双栏布局容器与拖拽把手；
  - 实现基于 Zustand 的 `aiSidebarStore` 与侧边栏状态控制；
  - 构建通用的 AI Provider 配置界面与连通性验证组件。
- **Phase 2: 章节识别与实时总结链路**
  - 实现非结构化书籍的正则/定长章节探测与虚拟章节划分；
  - 实现 `FoliateViewer` 当前章节文本提取与严格手动触发界面；
  - 接入单步提炼与超长章节 Map-Reduce 流水线；
  - 完成 `ChapterSummary` 本地持久化与重生成能力。
- **Phase 3: 伴读对话与轮数配额管理**
  - 接入基于 `@assistant-ui/react` 或轻量流式对话组件；
  - 实现显式 Turn Quota 轮数胶囊指示器与满额换话题交互；
  - 实现阅读视窗选区浮动工具栏及“一键引用追问”功能；
  - 对话记录的多话题切换与本地持久化。
- **Phase 4: 体验打磨与发布**
  - 适配主题色同步、快捷键绑定；
  - 桌面端打包（Windows / macOS）与跨平台兼容性验证。

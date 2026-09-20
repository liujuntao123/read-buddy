---
id: "06"
title: "真实书籍导入、本地书库与打开阅读"
status: "closed"
blocked_by: ["01", "02", "03", "04", "05"]
labels: ["ready-for-agent"]
---

# 06: 真实书籍导入、本地书库与打开阅读

**What to build:**
为阅读器补上真实书籍能力：从本地文件导入（EPUB / TXT），持久化到本地书库（IndexedDB 保存原始文件字节），提供书架界面（打开 / 删除 / 导入按钮 + 拖拽导入），打开后由解析器提供章节（EPUB spine / TXT 单体+虚拟分段），并与既有 AI 链路（章节提取、总结、对话、划词）全量打通。

**Blocked by:** 01–05（AI 链路与阅读视窗已就绪）
**Status:** closed
**Status:** in-progress

### Acceptance Criteria
- [x] 顶部栏提供「导入书籍」按钮与「书库」按钮；支持把 .epub/.txt 文件拖拽到窗口导入。
- [x] 导入即持久化：文件字节存入 IndexedDB `books` 表（key=内容 SHA-256 截断哈希），重启应用后书架仍列出全部书籍。
- [x] 书架视图：书籍卡片（书名/作者/格式/导入时间），点击打开，可删除；删除同时清理该书缓存（可选提示）。
- [x] EPUB 解析：jszip 解包 container.xml → OPF → spine 顺序 + Dublin Core 元数据（书名/作者），章节标题优先取 TOC（nav/NCX），缺失时回退「第 N 节」。
- [x] EPUB 展示安全过滤：白名单标签/属性（剥离 script/style/iframe/on* 事件与外部资源引用）。
- [x] TXT 解析：UTF-8 解码（乱码率高时回退 GBK），注册为单体文本；打开时自动走既有正则探测/定长分段横幅流程（复用 segmentationStore）。
- [x] 打开书籍后：阅读视窗按章节渲染真实内容，上一章/下一章切换，章节标题进 readerStore，总结/对话/划词工具栏对真实书籍生效（经 contentRegistry）。
- [x] 记忆阅读进度（lastSectionIndex 持久化），重新打开回到上次章节；启动时自动恢复上次打开的书。
- [x] 不支持格式（mobi/azw3/fb2/pdf）导入时给出友好提示「暂不支持该格式（待 Foliate 引擎接入）」。
- [x] 单元/组件测试：EPUB 解析（内存构造 epub）、TXT 编码回退、HTML 过滤、导入-打开-删除流程、书架交互、进度恢复。

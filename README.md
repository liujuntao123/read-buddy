<div align="center">

# Readest+

**零嵌入 · 章节优先的桌面 AI 阅读伴侣**

左边读书，右边总结、提问、划线 —— 读懂一本书需要的一切都在同一个窗口里。

[![CI](https://github.com/liujuntao123/readest-plus/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/liujuntao123/readest-plus/actions/workflows/ci.yml)
[![Release](https://github.com/liujuntao123/readest-plus/actions/workflows/release.yml/badge.svg)](https://github.com/liujuntao123/readest-plus/actions/workflows/release.yml)
[![最新版本](https://img.shields.io/github/v/release/liujuntao123/readest-plus?label=%E6%9C%80%E6%96%B0%E7%89%88%E6%9C%AC&color=blue)](https://github.com/liujuntao123/readest-plus/releases)
[![许可证](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![平台](https://img.shields.io/badge/platform-Windows-0078D4.svg)](#-下载安装)

**简体中文** · [English](README.en.md)

</div>

---

## 这是什么

Readest+ 是一款 Windows 桌面电子书阅读器，把 AI 伴读做进了阅读界面本身。

它不为整本书预先建立向量索引，也不在后台偷偷消耗 token：**你翻到哪一节，它就懂哪一节；要不要总结、要不要提问，由你按下按钮。**

如果你读书时习惯随手查证、梳理脉络、记下划线，又受够了在阅读器和浏览器标签页之间来回复制粘贴，那它就是为你做的。

## 和「阅读器 + 外挂 AI」有什么不同

| | 常见做法 | Readest+ |
| --- | --- | --- |
| **开始用** | 先为全书做向量嵌入，几十万字要等上几分钟 | 打开就能读，翻到哪讲到哪，没有全书预计算 |
| **花不花 token** | 后台自动预生成，快速翻页也在烧钱 | 总结、画像、对话全部手动触发，一次点击一次请求 |
| **AI 放哪** | 弹窗盖住正文，或切到另一个应用 | 左右并排、可拖拽调宽；窄屏自动收成抽屉 |
| **聊到哪了** | 悄悄截断历史，你不知道它还记得什么 | 每个话题有明确轮数上限，剩余轮数实时可见 |
| **数据在哪** | 上传云端 | 书库、进度、划线、总结、对话全部留在本机 |

## ✨ 功能特性

### 📚 阅读

- **多种格式**：EPUB、MOBI/AZW3、FB2、CBZ 漫画、TXT 纯文本（PDF 暂不支持，见[支持格式](#-支持格式)）
- **真实目录**：解析书籍自带目录（EPUB NCX / nav），层级折叠、点击跳转；没有目录的 TXT 会按 `第X章` 之类的规则自动切分
- **两种读法**：单页 / 双页切换，单页支持连续滚动，鼠标移到边缘即可翻页
- **三种主题**：日间、护眼（羊皮纸）、夜间 —— 伴读侧栏的颜色跟着一起变
- **排版随心**：字号、字体（霞鹜文楷 / 宋体 / 思源宋体 / 楷体 / 仿宋 / 黑体 / 圆体 / 西文衬线）、行距、段距、内容宽度、页边距、页间距，改动即时生效并自动保存
- **书架管理**：封面、搜索、按最近阅读 / 添加时间 / 名称 / 大小排序、网格与列表两种视图、阅读进度
- **桌面集成**：双击 `.epub` 等文件直接用 Readest+ 打开；把文件拖进窗口任意位置即可导入

### ✨ AI 伴读

- **三段式章节总结**：核心要义 · 关键内容脉络 · 核心概念与关键术语 —— 结构固定，便于横向对照
- **长节自动分块汇总**：超过 12,000 字的节走 Map-Reduce 两阶段汇总，而不是硬塞进上下文
- **本地缓存**：总结按「书籍 + 节点」缓存，重读同一节不再请求模型；想换模型重跑就点「重新生成」
- **全书画像与伴读索引**：一键生成全书全景画像（体裁、主题、世界观、主要人物）与每个最小节点的微大纲
- **有全局视野的对话**：上下文由四层组成 —— 全书画像、目录微大纲、当前节点正文、你的引用；回答标注原文出处，可点击跳回正文
- **明确的轮数上限**：默认每话题 10 轮（可设 5~20），剩余轮数实时显示，到量时提示开启新话题，而不是无声丢弃历史
- **历史话题**：随时切换旧话题、复制整段对话

### 🖍 划线与笔记

- 选中正文即可划线，划线永久保存，并在每次重新渲染该章节时重新画出
- **划线侧栏**：按正文顺序列出全书划线，标注「章 › 节」位置，点击跳回原文
- **误删可撤销**：删除后有 5 秒撤销窗口
- **一键导出**：把全书划线按位置分组复制为 Markdown，直接贴进你的笔记软件
- 单条划线可「问 AI」，引用会直接进入对话输入框

### 🔌 AI 接入

- 任何 **OpenAI 兼容**的 Chat Completions 接口：DeepSeek、OpenAI、Ollama、vLLM、自建网关
- 服务商预设一键填好 Base URL；可拉取模型列表搜索选择，也可手填 Model ID
- 保存前可先「测试连接」

## 📦 支持格式

| 格式 | 扩展名 | 渲染方式 |
| --- | :--- | --- |
| EPUB | `.epub` | Foliate 引擎，支持分页与滚动 |
| Kindle | `.mobi` `.azw` `.azw3` `.prc` | Foliate 引擎 |
| FictionBook | `.fb2` `.fbz` | Foliate 引擎 |
| 漫画 | `.cbz` | Foliate 引擎 |
| 纯文本 | `.txt` | 内置阅读器，自动或定长切分章节 |
| PDF | `.pdf` | 暂不支持 |

## 🚀 下载安装

**Windows 10 / 11（x64）**

1. 到 [Releases](https://github.com/liujuntao123/readest-plus/releases/latest) 下载最新的 `readest-plus_x.y.z_x64-setup.exe`；
2. 运行安装程序；
3. 首次启动时 Windows SmartScreen 可能提示「未知发布者」—— 安装包目前未做代码签名，选择「更多信息」→「仍要运行」即可。

> 想跟进每一次提交？CI 会把每次推送到 `master` 构建出的安装包作为 artifact 上传，见 [Actions](https://github.com/liujuntao123/readest-plus/actions/workflows/ci.yml)。

## 🏁 快速上手

**1. 导入一本书**
点标题栏的导入按钮，或把 `.epub` / `.txt` 直接拖进窗口。

**2. 配置模型**
按 `Ctrl + /` 打开 AI 伴读侧栏，点右上角 ⚙️ 填写服务商、Base URL、API Key 与 Model ID，先「测试连接」再保存。常用组合：

| 服务商 | Base URL | Model ID |
| --- | --- | --- |
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |
| 本地 Ollama | `http://localhost:11434/v1` | `qwen2.5:7b` |

**3. 生成章节总结**
翻到想读的章节，在「总结」页点「总结当前节」，三段式总结会流式写入。

**4. 提问**
切到「伴读」页直接提问；也可以选中正文，在浮动工具条上点「问 AI」。

**5. 划线**
选中文字点「划线」，之后在「划线」页统一查看、复制或跳回原文。

## ⌨️ 快捷键

| 按键 | 作用 |
| --- | --- |
| `←` `→` | 双页模式翻页 / 单页模式滚动 |
| `空格` | 下翻 / 向下滚动 |
| `Esc` | 关闭选区工具条 |
| `Ctrl + /` | 开合 AI 伴读侧栏 |
| `Enter` / `Shift + Enter` | 对话中发送 / 换行 |

## 🔒 数据与隐私

- 书库、阅读进度、划线、总结缓存与对话记录**全部保存在本机 IndexedDB**，不上传、不跨设备同步。
- **API Key 以明文保存在本地**（设置界面里做掩码显示）。这是刻意的取舍：不依赖系统钥匙串，代价是共用电脑时请自行斟酌。
- 只有你**主动触发**的总结、画像与对话会把对应文本发给你配置的模型服务商。除此之外没有任何遥测、没有账号、没有联网检查更新。

## ❓ 常见问题

**为什么每次都要我点「总结」？**
因为预生成意味着你在快速翻页时读过的每一节都要付一次 token。触发权交给你，是刻意的设计。

**模型说当前节点没有可用文本？**
部分 EPUB 的章节正文是异步加载的，稍等片刻或翻一页再试。如果这本书是扫描件（图片版），则本身没有可提取的文本。

**AI 会剧透我还没读到的内容吗？**
对话的上下文里包含全书画像与全书微大纲，所以模型对整本书有整体把握 —— 这也是它能回答「这一节在全书里处于什么位置」的原因。如果你不希望它提到后面的情节，在提问时说明一下即可。

**换了模型，旧总结怎么不更新？**
总结按书籍与节点缓存，换模型不会自动失效。想用新模型重跑，点「重新生成」。

**支持 macOS / Linux 吗？**
目前只发布 Windows 安装包。底层用的是 Tauri 2，跨平台构建在计划中但尚无时间表。

**AI 功能是必需的吗？**
不是。不配置模型时，它是一个完整的本地阅读器：书库、目录、排版、主题、划线全部可用。

## 🛠 开发

需要 **Node.js 24+**、**pnpm 12+**，以及构建桌面壳所需的 **Rust stable**。

```bash
pnpm install          # 安装依赖
pnpm dev              # 启动 Next.js 开发服务器（可在浏览器里调试阅读器与伴读）

pnpm typecheck        # tsc --noEmit
pnpm test             # vitest run
pnpm build            # Next.js 静态导出
pnpm build:installer  # 构建 Windows NSIS 安装包
pnpm verify           # 版本号 + 类型 + 测试 + 构建（提交前的完整闸门）
```

**技术栈**

| 层 | 选型 |
| --- | --- |
| 桌面容器 | Tauri 2（Rust + 系统 WebView） |
| 前端 | Next.js 16（静态导出）+ React 19 + TypeScript |
| 状态 | Zustand 5 |
| 渲染引擎 | Foliate-js（已 vendored） |
| AI | Vercel AI SDK + `@ai-sdk/openai-compatible` |
| 持久化 | IndexedDB（Dexie） |
| 测试 | Vitest 5 + happy-dom + Testing Library |

**目录结构**

```
apps/readest-app/
  src/app/          Next.js App Router 外壳
  src/components/   界面组件（书架 / 阅读器 / 伴读侧栏 / 设置）
  src/services/     核心逻辑：解析、分段、总结、对话、AI 接入、存储
  src/store/        Zustand 状态仓库
  src/types/        领域类型（单一来源）
  src-tauri/        Tauri 桌面壳与打包配置
scripts/            版本号与变更日志工具
docs/               设计文档、ADR、发布流程
```

想深入代码之前，建议先读 [`CONTEXT.md`](CONTEXT.md)（领域词汇表，规定了这个项目怎么说话）、[`docs/adr/`](docs/adr/)（架构决策记录）与 [`docs/agents/`](docs/agents/)（协作约定）。

## 📝 变更日志

每个版本的变更见 **[CHANGELOG.md](CHANGELOG.md)** 或 [Releases](https://github.com/liujuntao123/readest-plus/releases) 页面。

变更日志依据[约定式提交](https://www.conventionalcommits.org/zh-hans/v1.0.0/)从 git 历史自动生成，发布流程见 [`docs/releasing.md`](docs/releasing.md)。

## 🗺 计划中

以下方向已列入考虑，但**没有时间表、也不构成承诺**：

- 更多内置主题与自定义主题
- 划线导出为 HTML / 富文本
- macOS 与 Linux 构建
- PDF 支持
- 安装包代码签名

## 🤝 贡献

- **提交信息遵循[约定式提交](https://www.conventionalcommits.org/zh-hans/v1.0.0/)**（`feat(reader): …`、`fix(app): …`）。变更日志直接由提交历史生成，写好提交信息就是写好更新说明。
- 提交前跑一遍 `pnpm verify`（版本号一致性 + 类型检查 + 测试 + 构建）。
- 改动前请先读相关的 `docs/adr/` 与 `CONTEXT.md`：这个项目对领域词汇有明确约定，代码与文档都要遵守。
- 发布由维护者执行，步骤见 [`docs/releasing.md`](docs/releasing.md)。

## 📄 许可证

[MIT](LICENSE)。

随本项目分发的第三方组件保留各自的许可证，见 [LICENSE](LICENSE) 末尾（vendored 的 [foliate-js](https://github.com/johnfactotum/foliate-js) 为 MIT）。

## 🙏 致谢

- [readest](https://github.com/readest/readest) —— 本项目的架构与交互设计从中受益良多
- [foliate-js](https://github.com/johnfactotum/foliate-js) —— 分页渲染引擎
- [Tauri](https://tauri.app/) · [Next.js](https://nextjs.org/) · [Vercel AI SDK](https://sdk.vercel.ai/)

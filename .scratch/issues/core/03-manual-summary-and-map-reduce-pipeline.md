---
id: "03"
title: "严格手动触发与超长章节 Map-Reduce 结构化总结"
status: "in-progress"
blocked_by: ["01", "02"]
labels: ["ready-for-agent"]
---
# 03: 严格手动触发与超长章节 Map-Reduce 结构化总结

**What to build:**
在 AI 伴读侧边栏的“章节总结”Tab 中实现严格手动触发的摘要提炼功能。未缓存章节展示清晰的操作卡片，点击后触发流式生成；篇幅 $\le 12,000$ 字符执行单步提炼，超过 12,000 字符执行两阶段 Map-Reduce 流水线并在 UI 显示阶段进度。总结结果强制按“核心要义、关键脉络、核心概念”三段式呈现并本地持久化。

**Blocked by:** 01 (双栏布局分屏容器与 AI Provider 配置中心), 02 (章节文本提取与非结构化书籍自适应分段)

**Status:** ready-for-agent

### Acceptance Criteria

- [ ] 切换章节时，不自动发起模型请求。未缓存章节在侧栏显示空状态卡片，包含章节名、预估字数与 **“⚡ 生成本章总结”** 按钮。
- [ ] 若本章节已缓存（IndexedDB `ChapterSummary` 表中存在），切章后毫秒级直接呈现已缓存总结，并提供右上角“🔄 重新生成”按钮。
- [ ] 篇幅 $\le 12,000$ 字符时调用 `SinglePassSummarizer`，通过 Vercel AI SDK 开启流式 SSE 打字机渲染，提供“⏹ 停止生成”按钮。
- [ ] 篇幅 $> 12,000$ 字符时自动启动 `MapReduceSummarizer`：分块进行子块摘要（Map），随后合并子摘要送入 Reduce 阶段输出最终三段式总结。
- [ ] Map-Reduce 运行期间，UI 呈现动态进度状态指示（如：*“正在分块提炼 (1/2)...”* $\rightarrow$ *“正在合成整章脉络...”*）。
- [ ] 输出严格符合三段式 Markdown 结构规范（📌 章节核心要义、🗺️ 关键内容脉络、💡 核心概念与关键术语）。
- [ ] 总结完成即时写入本地 IndexedDB，Key 格式为 `${bookHash}:${sectionIndex}`。
- [ ] 单元测试覆盖单步提炼流程、Map-Reduce 拆分与聚合逻辑、Abort 终止及缓存命中/刷新逻辑。

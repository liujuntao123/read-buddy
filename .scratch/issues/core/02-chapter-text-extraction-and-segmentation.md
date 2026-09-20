# 02: 章节文本提取与非结构化书籍自适应分段

**What to build:**
构建从 Foliate 阅读引擎中按需提取当前章节纯文本的服务，并针对无目录、大单卷 TXT 或单体未切分书籍，实现正则启发式章节扫描与弹窗询问机制，向用户确认后建立“虚拟章节（Virtual Section）”，若无匹配则提供 6,000~8,000 字定长分段保底，将分段结果持久化至本地数据库。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

### Acceptance Criteria

- [ ] 实现 `ChapterTextExtractor` 服务，从 Foliate 渲染引擎的 spine `sectionIndex` 获取 HTML 并利用 DOMParser 剥离非文本标签，输出规范的 Markdown/Plaintext。
- [ ] 针对无目录/单节单体书籍，实现正则扫描探测器（匹配 `/(第[0-9一二三四五六七八九十百千]+[章回节卷]|Chapter\s+\d+|SECTION\s+\d+)/i`）。
- [ ] 探测出候选章节时，在阅读界面顶部触发提示横幅：*“检测到本书无目录，已自动识别 {N} 个章节，是否应用？”*。
- [ ] 用户确认后生成 `VirtualSection` 映射列表并持久化保存在 `BookSegmentation` 表中。
- [ ] 用户拒绝或无匹配时，自动以 6,000 ~ 8,000 字符为颗粒度构建保底虚拟章节列表。
- [ ] 编写单元测试覆盖标准章节提取、各类复杂正则章节标题匹配、以及定长边界切分逻辑。

/**
 * Node Content（节点内容类别）——「这一个节点值不值得总结」的唯一答案。
 *
 * 结论来自两类信号，**先标题后正文**，全程离线、零模型调用：
 *
 * 1. **标题**：版权页 / 目录页 / 封面扉页这类页面自己的名字就说清了它是什么
 *    （《说理》的 NCX 里就是「版权信息」「目录」两个条目）；
 * 2. **正文形状**：标题不可信时（未命名物理段的合成标题「第 3 节」，或压根没有
 *    目录条目指向的前附页）由正文自己说话——版权页是一串出版著录字段，目录页是
 *    一串条目行，两者都与「成段的论述」在行长、行数、标点密度上截然不同。
 *
 * 门限不是拍出来的：`.scratch/REPORT-frontmatter-classifier.md` 用 14 本真实
 * EPUB（自解 OPF/NCX 的 1295 个节点 + 走真实 foliate 管线的 818 个节点）逐一
 * 量过。真实语料里前附页只有 20 个，本规则在 1295 节点上命中 20 个、**零假阳性
 * 零漏判**；在真管线上命中 10 个、全部为真（其中 2 个只能靠内容规则认出，因为
 * 标题是占位符）。
 *
 * 之所以不用模型判断：这个问题在**每次翻页时**都要回答一次，而答案对一个文件
 * 是不变的——交给模型意味着读者每移动一次就可能多一次调用与一次等待，换来的
 * 只是同一句话。规则可测、即时，且失效方向是「多显示一个按钮」而不是「功能
 * 不可用」——判不出来一律按正文处理。
 */
/** 节点正文的类别。除 `prose` 外都不值得总结。 */
export type NodeContentKind = 'prose' | 'cover' | 'copyright' | 'toc' | 'blurb';

/** 类别词（界面文案的唯一出处）。 */
export const NODE_CONTENT_LABEL: Record<NodeContentKind, string> = {
  prose: '正文',
  cover: '封面',
  copyright: '版权页',
  toc: '目录页',
  blurb: '内容简介',
};

/**
 * 结构性页面的标题。**整串**匹配（先归一化：去空白、去书名号类包裹、去尾随
 * 标点），因为真实语料里这 20 个前附页的标题全部是这样一个干净的词，而「目录」
 * 「版权」这样的词出现在**正文标题**里的情形（例如「论版权」）必须保持正文。
 */
const STRUCTURAL_TITLE_KINDS: ReadonlyArray<{ titles: readonly string[]; kind: NodeContentKind }> = [
  { titles: ['版权', '版权信息', '版权页', '版权声明', '图书在版编目', '出版信息'], kind: 'copyright' },
  { titles: ['目录', '目次', 'contents', 'tableofcontents'], kind: 'toc' },
  { titles: ['封面', '书封', '封底', '护封', '扉页', '书名页', '插页', '彩插'], kind: 'cover' },
  { titles: ['内容简介', '内容提要'], kind: 'blurb' },
];

/**
 * 版权 / 出版著录页的字段标记。
 *
 * 刻意剔除 `出版社` / `印刷` / `定价` / `字数`：它们在中文**正文**里是常用词
 * （真实反例：《人类的必然无知》讲商品定价，1133 字里「定价」出现 6 次）。
 * `CIP` 单独保留会误伤，因此只留 `CIP数据`。
 */
const COPYRIGHT_MARKERS: readonly string[] = [
  '图书在版编目',
  'CIP数据',
  '版权所有',
  '侵权必究',
  'ISBN',
  '出版发行',
  '责任编辑',
  '封面设计',
  '装帧设计',
  '开本',
  '印张',
  '印次',
  '版次',
  '经销',
  '书号',
];

/**
 * 只看开头多少字。
 *
 * 长节点会把**尾部**的版权页吞进来（真实反例：《刘擎西方现代思想讲义》的「人名
 * 索引」4605 字，标记全在 76% 处）。只数开头就不受这个影响。
 */
const COPYRIGHT_HEAD_CHARS = 500;

/** 命中多少种**互不相同**的 head 标记才算版权页（真实版权页 2~7 种，正文最多 1 种）。 */
const COPYRIGHT_MARKER_MIN = 2;

/**
 * 版权页的字数上限（真实版权页 112~533 字）。
 *
 * 这条不是形状条件而是**排除条件**：真实反例《何为良好生活》的「序言」节点
 * 1059 字，其头部就是版权页（NCX 把「版权页」和「序言」指向同一个锚点，同层
 * 去重后标题留了「序言」）。没有字数上限，那一页会被误判、真序言就读不到总结。
 */
const COPYRIGHT_MAX_CHARS = 1000;

/**
 * 目录条目行的行首形状：「第N章 / §1.2 / Chapter 7 / Part 2 / 12. 标题」。
 *
 * 它对《说理》很准（227 行里 222 行命中），但**真实目录页差异极大**：《2000 年
 * 以来的西方》153 行里 0 行带「第N章」前缀，《北平无战事》49 行每行只有「一」
 * 「二」…三个字。所以它是并列分支之一，不是唯一判据。
 */
const TOC_LINE =
  /^(第\s*[0-9一二三四五六七八九十百千零两]+\s*[章回节卷部篇集幕]|[§＄]|Chapter\s|Part\s|\d+([.、．)）]|\s)|contents?$|目\s*次)/i;

/** 目录页：行首形状分支的门槛（并列分支二选一即可）。 */
const TOC_PREFIX_MIN_LINES = 6;
const TOC_PREFIX_MIN_RATIO = 0.5;
const TOC_PREFIX_MAX_MEDIAN_LINE = 32;

/**
 * 目录页：**行形状**分支的门槛——很多短行、没有段落长行、几乎不以句末标点结尾。
 *
 * 真实目录页实测：行数 10~227、行长中位 3~19、最长行 3~44、句末标点行占比
 * 0~0.167；最近的正文节点是《想象的共同体》的 83 字/行、句末标点占比 0.5。
 */
const TOC_SHAPE_MIN_LINES = 8;
const TOC_SHAPE_MAX_MEDIAN_LINE = 25;
const TOC_SHAPE_MAX_LINE = 120;
const TOC_SHAPE_MAX_SENTENCE_END_RATIO = 0.3;

/** 句末标点：以这些字符结尾的行读起来是「句子」，目录行不会。 */
const SENTENCE_END = /[。！？…”」』：；!?]$/;

export interface NodeContentAssessment {
  kind: NodeContentKind;
  /** 值得（也因此才可以）生成节点总结。 */
  summarizable: boolean;
  /** 命中的信号，供界面说明、诊断与测试断言。 */
  signals: string[];
}

/** 标题归一化：去空白与包裹符号、去尾随标点，再整串比对。 */
const normalizeTitle = (title: string): string =>
  title
    .replace(/[\s\u3000]/g, '')
    .replace(/^[《【［（(\[]+/, '')
    .replace(/[》】］）)\]:：、.。·\-—]+$/, '')
    .toLowerCase();

const nonEmptyLines = (text: string): string[] =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

const median = (values: readonly number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[middle - 1]! + sorted[middle]!) / 2)
    : sorted[middle]!;
};

const structuralKindOf = (title: string): NodeContentKind | undefined => {
  const normalized = normalizeTitle(title);
  if (!normalized) return undefined;
  for (const { titles, kind } of STRUCTURAL_TITLE_KINDS) {
    if (titles.includes(normalized)) return kind;
  }
  return undefined;
};

/** 版权页：标记集中在开头，且这一页本来就短。 */
const looksLikeCopyright = (text: string): string[] | undefined => {
  if (text.length > COPYRIGHT_MAX_CHARS) return undefined;
  const head = text.slice(0, COPYRIGHT_HEAD_CHARS);
  const hits = COPYRIGHT_MARKERS.filter((marker) => head.includes(marker));
  if (hits.length < COPYRIGHT_MARKER_MIN) return undefined;
  return hits.map((hit) => `marker:${hit}`);
};

/** 目录页：条目行形状，或「第N章 / §」行首形状占多数。 */
const looksLikeToc = (lines: readonly string[]): string[] | undefined => {
  if (lines.length === 0) return undefined;
  const lengths = lines.map((line) => line.length);
  const medianLength = median(lengths);

  // 分支一：行首形状占多数（《说理》的 222/227）。先判它，因为它更具体：它认的是
  // 「这一行是一个章节条目」，《2000 年以来的西方》那种一行一个词组的目录骗不过
  // 它，但骗得过下面的行形状分支——而 6~7 行的短目录只有这一条能拦（行形状分支
  // 要求至少 8 行）。
  if (lines.length >= TOC_PREFIX_MIN_LINES) {
    const prefixed = lines.filter((line) => TOC_LINE.test(line)).length;
    if (
      prefixed / lines.length >= TOC_PREFIX_MIN_RATIO &&
      medianLength <= TOC_PREFIX_MAX_MEDIAN_LINE
    ) {
      return [`toc-lines:${prefixed}/${lines.length}`];
    }
  }

  // 分支二：行形状。很多短行、无长段落行、几乎不以句末标点结尾。
  if (lines.length >= TOC_SHAPE_MIN_LINES) {
    const sentenceEnds = lines.filter((line) => SENTENCE_END.test(line)).length / lines.length;
    if (
      medianLength <= TOC_SHAPE_MAX_MEDIAN_LINE &&
      Math.max(...lengths) <= TOC_SHAPE_MAX_LINE &&
      sentenceEnds <= TOC_SHAPE_MAX_SENTENCE_END_RATIO
    ) {
      return [
        `toc-shape:${lines.length}lines,median=${medianLength},max=${Math.max(...lengths)},end=${sentenceEnds.toFixed(2)}`,
      ];
    }
  }

  return undefined;
};

/**
 * 纯核：标题 + 正文 → 内容类别。不读 store，不看数据库，可普通值直接测试。
 *
 * 判定顺序（第一个命中者胜出）：结构性标题 → 版权页 → 目录页 → 正文。
 * 标题优先于形状，是因为「目录」这两个字比该页正文的任何统计都更确定；形状兜住
 * 标题不可信的情况（占位标题「第 3 节」、目录没收录的前附页），两者都不命中就按
 * 正文处理——**保守方向永远是「多给一个按钮」**。
 */
export function assessNodeContent(input: { title: string; text: string }): NodeContentAssessment {
  const text = input.text.trim();

  const structural = structuralKindOf(input.title);
  if (structural) {
    return {
      kind: structural,
      summarizable: false,
      signals: [`title:${input.title.trim()}`],
    };
  }

  const copyright = looksLikeCopyright(text);
  if (copyright) {
    return { kind: 'copyright', summarizable: false, signals: copyright };
  }

  const toc = looksLikeToc(nonEmptyLines(text));
  if (toc) {
    return { kind: 'toc', summarizable: false, signals: toc };
  }

  return { kind: 'prose', summarizable: true, signals: [] };
}

/** 「本页是版权页，没有可提炼的正文内容，无需总结。」——界面说明的唯一出处。 */
export const describeNonSummarizable = (kind: NodeContentKind): string =>
  kind === 'prose' ? '' : `本页是${NODE_CONTENT_LABEL[kind]}，没有可提炼的正文内容，无需总结。`;

import { describe, expect, it } from 'vitest';
import {
  NODE_CONTENT_LABEL,
  assessNodeContent,
  describeNonSummarizable,
} from './nodeContent';

/**
 * The classifier that decides whether a node is worth summarizing.
 *
 * Fixtures are shaped like the real pages the rule was calibrated on
 * (`.scratch/REPORT-frontmatter-classifier.md`: 14 EPUBs, 1295 nodes read
 * straight from the EPUBs plus 818 through the real foliate pipeline). Where a
 * case has a measured real counterpart, the numbers are quoted next to it — they
 * are the reason the thresholds sit where they do. Book *prose* is never copied
 * in; the shapes are reproduced instead.
 */

/** 《说理》's real 版权信息 page (164 chars, bibliographic fields only). */
const SHUOLI_COLOPHON = `版权信息
书　　名　说理
作　　者　陈嘉映
责任编辑　肖海鸥
出版发行　上海文艺出版社
ISBN 　　9787532175499
关注我们的微博： @上海文艺出版社
关注我们的微信：shanghaiwenyi
意见反馈：@你好小巴鱼`;

/** A printed 目录 page whose entries carry 第N章 / § prefixes (《说理》shape). */
const PREFIXED_TOC = `目录

CONTENTS

新版说明

序言

第1章 哲学之为穷理

§1.1 哲学是什么

§1.2 好道与说理

第2章 哲学为什么关注语言？

§2.1 语言转向

§2.2 语言或概念 vs. 事质

第3章 “哲学语法”`;

/**
 * A 目录 page with no structural prefixes at all — 《2000年以来的西方》 is 153
 * such lines (median 10, max 21, 0/153 prefixed with 第N章), which is exactly why
 * the rule needs a line-shape branch beside the prefix branch.
 */
const UNPREFIXED_TOC = [
  '目录',
  '我们如何想象世界（代序）',
  '近身的世界',
  '脆弱的新共识',
  '美国对华战略的分歧',
  '弹劾总统与政治分裂',
  '新的雄心与危险',
  '面对全球气候紧急状态',
  '技术的边界',
  '货币与信任',
  '帝国的余晖',
  '尾声',
  '后记',
].join('\n');

/** 《北平无战事》's 目录 is 49 lines of 「一」「二」…「四十九」 (median 3). */
const NUMERAL_TOC = ['目录', ...Array.from({ length: 20 }, (_, i) => `${'一二三四五六七八九十'[i % 10] ?? ''}`)]
  .filter(Boolean)
  .join('\n');

/** Real prose: long sentences, no bibliographic fields. */
const PROSE = `哲学通过穷理达乎道。所谓穷理，并不是把道理一条条摆出来，而是追索我们已经在用的那些道理的根。
日常语言里凝结着根本的道理，哲学家检视我们怎样说到世界，也检视我们在说世界时预设了什么。
语言转向并不是把哲学变成语言学，它只是把注意力从事质移到我们谈论事质的方式上。
维特根斯坦说，哲学语法与普通语法的区别，不在于研究对象，而在于我们追问的方向。
一个道理说得通，我们才说它有道理；说得通本身就是道理在言说中成形的过程。`;

describe('assessNodeContent', () => {
  it('blocks a page whose own name says it has nothing to summarize', () => {
    const expected: Array<[string, string]> = [
      ['版权', 'copyright'],
      ['版权信息', 'copyright'],
      ['版权页', 'copyright'],
      ['版权声明', 'copyright'],
      ['图书在版编目', 'copyright'],
      ['出版信息', 'copyright'],
      ['目录', 'toc'],
      ['目次', 'toc'],
      ['Contents', 'toc'],
      ['封面', 'cover'],
      ['封底', 'cover'],
      ['扉页', 'cover'],
      ['书名页', 'cover'],
      ['内容简介', 'blurb'],
      ['内容提要', 'blurb'],
    ];
    for (const [title, kind] of expected) {
      const result = assessNodeContent({ title, text: '' });
      expect(result.summarizable, title).toBe(false);
      expect(result.kind, title).toBe(kind);
    }
    // Wrapping and trailing punctuation are normalized away, but a title that
    // merely *mentions* the word is not a structural page.
    expect(assessNodeContent({ title: '《目录》', text: '' }).kind).toBe('toc');
    expect(assessNodeContent({ title: '目录。', text: '' }).kind).toBe('toc');
    expect(assessNodeContent({ title: '论版权', text: PROSE }).kind).toBe('prose');
    expect(assessNodeContent({ title: '目录学导论', text: PROSE }).kind).toBe('prose');
  });

  it('reads the 版权页 out of the text when the title is a placeholder', () => {
    // 《说理》 node #0 of the real pipeline is titled 「第 2 节」 and IS the
    // copyright page — the exact page the user reported. The title rule cannot
    // see it; the content rule is the only net (placeholder titles come from
    // `placeholderTitle` whenever the directory has no label for a spine).
    const result = assessNodeContent({ title: '第 2 节', text: SHUOLI_COLOPHON });
    expect(result.kind).toBe('copyright');
    expect(result.summarizable).toBe(false);
    expect(result.signals).toContain('marker:ISBN');
    // 《毛泽东选集》's page carries only two strong markers, so the minimum is 2.
    expect(
      assessNodeContent({
        title: '第 4 节',
        text: `版权信息\nISBN 978-7-01-000000-0\n版权所有 侵权必究`,
      }).kind,
    ).toBe('copyright');
  });

  it('reads a 目录 page out of the text when the title is a placeholder', () => {
    for (const [name, body] of [
      ['prefixed (说理)', PREFIXED_TOC],
      ['unprefixed (2000年以来的西方)', UNPREFIXED_TOC],
      ['numerals (北平无战事)', NUMERAL_TOC],
    ] as const) {
      const result = assessNodeContent({ title: '第 3 节', text: body });
      expect(result.kind, name).toBe('toc');
      expect(result.summarizable, name).toBe(false);
    }
    // The two branches are distinguishable in the evidence trail, and each covers
    // what the other cannot: a 6~7 line prefixed page is under the line-shape
    // branch's 8-line floor, while a page of unprefixed fragments is 0% prefixed.
    expect(assessNodeContent({ title: '第 3 节', text: PREFIXED_TOC }).signals[0]).toMatch(
      /^toc-lines:/,
    );
    expect(assessNodeContent({ title: '第 3 节', text: UNPREFIXED_TOC }).signals[0]).toMatch(
      /^toc-shape:/,
    );
    const shortPrefixed = ['目录', '第一章 迷雾之城', '第二章 图书馆的密语', '第三章 长夜漫漫', '第四章 星图', '第五章 密语', '第六章 尾声'].join(
      '\n',
    );
    expect(assessNodeContent({ title: '第 3 节', text: shortPrefixed }).signals[0]).toMatch(
      /^toc-lines:6\/7$/,
    );
  });

  it('keeps a node that merely STARTS with the colophon as prose (the expensive false positive)', () => {
    // 《何为良好生活》's 「序言」 node is 1059 chars whose first 533 are the
    // copyright page — the NCX points 「版权页」 and 「序言」 at the same anchor, so
    // same-level de-duplication left the title 「序言」 on a page that opens with
    // the colophon. Only the character cap saves it; without it, real 序言 loses
    // its button.
    const mixed = [SHUOLI_COLOPHON, PROSE, PROSE, PROSE, PROSE, PROSE].join('\n');
    expect(mixed.length).toBeGreaterThan(1000);
    const result = assessNodeContent({ title: '序言', text: mixed });
    expect(result.summarizable).toBe(true);
    expect(result.kind).toBe('prose');
  });

  it('does not turn a long listing into a 版权页 when the colophon sits in its tail', () => {
    // 《刘擎西方现代思想讲义》's 「人名索引」 is 202 lines / 4605 chars whose markers
    // sit at 76% — the whole node swallowed the book's back colophon. The head
    // window is what keeps it prose, and its 147-char longest line is what keeps
    // the 目录 line-shape branch (max ≤ 120) away from it.
    const indexLines = Array.from(
      { length: 202 },
      (_, i) =>
        `阿尔都塞${i}（Althusser, Louis），1918—1990，法国哲学家，见第 ${i} 页、第 ${i + 12} 页`,
    );
    const index = `${indexLines.join('\n')}\n${SHUOLI_COLOPHON}`;
    const result = assessNodeContent({ title: '人名索引', text: index });
    expect(result.kind).toBe('prose');
    expect(result.summarizable).toBe(true);

    // References: long lines (median 43 in the real book), 出版社 in most of them.
    const references = Array.from(
      { length: 111 },
      (_, i) => `[${i}] 作者. 书名[M]. 北京：商务印书馆，20${10 + (i % 10)}：${i}–${i + 20}.`,
    ).join('\n');
    expect(assessNodeContent({ title: '参考文献', text: references }).summarizable).toBe(true);
  });

  it('keeps prose summarizable, including prose that talks about publishing', () => {
    expect(assessNodeContent({ title: '第一章 哲学之为穷理', text: PROSE }).summarizable).toBe(true);
    expect(assessNodeContent({ title: '第 2 节', text: PROSE }).kind).toBe('prose');
    // 《人类的必然无知》 discusses 商品定价 six times — 定价 / 印刷 / 出版社 are
    // therefore NOT markers, and the marker minimum is 「kinds」, not occurrences.
    const economics = `${PROSE}\n商品的定价取决于供需，而印刷成本与出版社的议价能力同样影响定价。我们发现定价并不只是数字。`;
    expect(assessNodeContent({ title: '第 9 节', text: economics }).summarizable).toBe(true);
  });

  it('never blocks the prose front/back matter that IS worth summarizing', () => {
    for (const title of [
      '序言',
      '前言',
      '引言',
      '自序',
      '代序',
      '新版说明',
      '后记',
      '译后记',
      '跋',
      '致谢',
      '结语',
      '尾声',
      '导论',
      '绪论',
      '出版说明',
      '凡例',
      '献词',
      '题记',
      '附录',
      '附录A 不确定性下的判断：启发法和偏见',
      '参考文献',
      '人名索引',
    ]) {
      expect(assessNodeContent({ title, text: PROSE }).summarizable, title).toBe(true);
    }
  });

  it('does not treat a node titled like the book as structural', () => {
    // 《走出唯一真理观》 has a node whose title equals the book's and is 21709
    // chars of real prose — any 「title == book title → skip」 rule would be wrong.
    const longProse = `${PROSE}\n${PROSE}\n${PROSE}\n${PROSE}`;
    expect(assessNodeContent({ title: '走出唯一真理观', text: longProse }).summarizable).toBe(true);
  });

  it('treats an undecidable node as prose — the safe direction is a visible button', () => {
    expect(assessNodeContent({ title: '', text: '' }).summarizable).toBe(true);
    expect(assessNodeContent({ title: '第 7 节', text: '这一节很短。' }).kind).toBe('prose');
    // Six TOC-looking lines are below both thresholds: a short placeholder-titled
    // contents page is a known gap, and it stays on the safe side of it.
    expect(assessNodeContent({ title: '第 5 节', text: '目次\n一\n二\n三\n四\n五\n六' }).kind).toBe(
      'prose',
    );
  });

  it('names each kind for the UI, and explains why the button is absent', () => {
    expect(NODE_CONTENT_LABEL.copyright).toBe('版权页');
    expect(NODE_CONTENT_LABEL.toc).toBe('目录页');
    expect(describeNonSummarizable('copyright')).toBe(
      '本页是版权页，没有可提炼的正文内容，无需总结。',
    );
    expect(describeNonSummarizable('toc')).toContain('目录页');
    expect(describeNonSummarizable('cover')).toContain('封面');
    expect(describeNonSummarizable('blurb')).toContain('内容简介');
    expect(describeNonSummarizable('prose')).toBe('');
  });
});

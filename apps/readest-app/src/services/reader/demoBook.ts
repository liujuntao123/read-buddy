/**
 * Demo book fixture rendered by the placeholder reader pane.
 *
 * In the full readest integration the reader text comes from the Foliate
 * engine spine (each section's `load()` yields an HTML document string,
 * exactly the input shape consumed by ChapterTextExtractor). This demo
 * book mirrors that shape so services and UI can be developed and tested
 * before the Foliate web components are wired in.
 */

export interface DemoSection {
  index: number;
  title: string;
  /** XHTML fragment as it would come out of a Foliate spine section. */
  html: string;
}

export interface DemoBook {
  bookHash: string;
  title: string;
  sections: DemoSection[];
}

const sentence =
  '灯火在雾中摇曳，古老的钟楼敲响了第三声，城里的人们都说，午夜之后不要靠近图书馆。';

const chapterOneHtml = `
<h1>第一章 迷雾之城</h1>
<style>.unused { color: red; }</style>
<p>${sentence}</p>
<p>年轻的图书管理员林晚背着油灯走进南门，她手里攥着一封没有署名的信，信纸上只有一句话：答案在第三章的注释里。</p>
<p>街道空无一人，只有面包房的老猫跟了她两条巷子，又在一堵爬满常春藤的墙前停下了脚步。</p>
<img src="fog-city.png" alt="迷雾之城插画" />
<p>她记得父亲说过，这座城市的雾从来不是为了遮住什么，而是为了让人习惯看不见。</p>
`;

const chapterTwoHtml = `
<h1>第二章 图书馆的密语</h1>
<p>图书馆的木门在她身后合上时，穹顶上的星图亮了起来，一行行微光顺着书架流淌，像有人在低声读书。</p>
<p>“你在找第三章的注释？”一个声音从书架深处传来，“那你得先回答，你愿意付出什么。”</p>
<p>林晚握紧了信纸。她想起城门口告示上的悬赏，想起父亲失踪前留下的最后一页手稿，想起母亲常说的那句话：知识是有重量的。</p>
<p>“我愿意付出一个真相。”她说。</p>
`;

/** A long chapter (>12,000 chars) exercising the Map-Reduce pipeline. */
const chapterThreeHtml = `
<h1>第三章 长夜漫漫</h1>
${Array.from(
  { length: 120 },
  (_, i) =>
    `<p>长夜第${i + 1}节：${sentence}守夜人在第${i + 1}次巡逻时发现，星图上的第${((i % 12) + 1)}颗星悄悄移动了位置，而手稿的页脚多出一行陌生的批注。</p>`,
).join('\n')}
`;

export const DEMO_BOOK: DemoBook = {
  bookHash: 'demo-fog-city-0001',
  title: '迷雾之城（演示书）',
  sections: [
    { index: 0, title: '第一章 迷雾之城', html: chapterOneHtml },
    { index: 1, title: '第二章 图书馆的密语', html: chapterTwoHtml },
    { index: 2, title: '第三章 长夜漫漫', html: chapterThreeHtml },
  ],
};

/**
 * Monolithic TXT fixture with NO TOC: used by segmentation tests and demos
 * (regex chapter detection: 第一章...第五章, each ~2,000 chars).
 */
export const DEMO_MONOLITHIC_TXT: string = Array.from(
  { length: 5 },
  (_, i) => {
    const numerals = ['一', '二', '三', '四', '五'];
    const paragraphs = Array.from(
      { length: 40 },
      (_, j) => `第${j + 1}段：${sentence}港口的船夫在第${j + 1}次涨潮时说起过这件事。`,
    ).join('\n');
    return `第${numerals[i]}章 风起之地${i + 1}\n\n${paragraphs}`;
  },
).join('\n\n');

/** Monolithic TXT with NO recognizable chapter headings (fixed-length fallback). */
export const DEMO_UNSTRUCTURED_TXT: string = Array.from(
  { length: 120 },
  (_, j) => `第${j + 1}段：${sentence}有人在废墟的墙上刻下第${j + 1}个名字。`,
).join('\n');

/**
 * Mirror of `classifyHeadingLevel` (layeredSegmenter.ts) applied to the real
 * TOC labels of the three books, to show what the existing hierarchy
 * classifier produces for them.
 */
const CONTAINER_SUFFIXES = ['卷', '部', '篇'];
const LEAF_SUFFIXES = ['章', '回', '节', '集', '幕'];

function classifyHeadingLevel(title) {
  const trimmed = title.trim();
  const numerals = '[0-9一二三四五六七八九十百千零两]+';
  const boundary = '(?:\\s|\\u3000|:：、.。|\\s*$)';
  if (
    new RegExp(`第${numerals}[${CONTAINER_SUFFIXES.join('')}]${boundary}`).test(trimmed) ||
    new RegExp(`[${CONTAINER_SUFFIXES.join('')}]\\s*$`).test(trimmed) ||
    /^(Part|Book)\b/i.test(trimmed)
  ) {
    return 'container';
  }
  if (
    new RegExp(`第${numerals}[${LEAF_SUFFIXES.join('')}]${boundary}`).test(trimmed) ||
    new RegExp(`[${LEAF_SUFFIXES.join('')}]\\s*$`).test(trimmed) ||
    /^(Chapter|Section)\b/i.test(trimmed)
  ) {
    return 'leaf';
  }
  return null;
}

const samples = [
  '第一部分 系统1，系统2',
  '第二部分 启发法与偏见',
  '第1章 一张愤怒的脸和一道乘法题',
  '第10章 大数法则与小数定律',
  '结语',
  '附录A 不确定性下的判断：启发法和偏见',
  '第1部分 贝姬医生的育儿准则',
  '第2部分 建立亲密感，改善行为',
  '准则2 真相不唯一',
  '准则10 不要忘记自我关照',
  '实战2 孩子不听话（或者说，不合作）怎么办？',
  '总结',
  '第一章 伦理与伦理学',
  '第七章 性善与向善',
  '§1 伦理学这个名称',
  '§10 实践传统的式微',
  '序言',
  '版权页',
];

const pad = (s, n) => s + ' '.repeat(Math.max(0, n - [...s].length));
console.log(pad('title', 46), '=> level');
console.log('-'.repeat(64));
for (const s of samples) {
  const level = classifyHeadingLevel(s);
  console.log(pad(s, 46), '=>', level === null ? 'null（无结构信号）' : level);
}

/**
 * THROWAWAY evidence harness (lives in .scratch/, never committed).
 *
 * Runs the app's REAL pipeline — vendored foliate loader → engine extraction →
 * `segmentSpineBook` — over the real EPUBs in E:\书籍, then applies the
 * candidate "not worth summarizing" classifier to every node and dumps the
 * verdicts to .scratch/out/app-nodes.json.
 *
 * Run: pnpm --filter read-buddy-app exec vitest run --config ../../.scratch/vitest.config.mts
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { createFoliateEngine, engineToContent, type FoliateViewModule } from '@/services/library/foliateEngine';
import { segmentSpineBook, type SpineSectionInput } from '@/services/segmentation/layeredSegmenter';
import type { NodeAnchor } from '@/types/readingAgent';

// ---- happy-dom shims the vendored foliate loader needs (copied verbatim from
// ---- src/test/realBooks.test.ts, which drives the same seam)
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
}
for (const proto of [
  Document.prototype,
  (globalThis as { XMLDocument?: { prototype?: object } }).XMLDocument?.prototype,
]) {
  if (!proto) continue;
  const anyProto = proto as Record<string, unknown>;
  if (typeof anyProto.lookupNamespaceURI !== 'function') anyProto.lookupNamespaceURI = () => null;
  if (typeof anyProto.lookupPrefix !== 'function') anyProto.lookupPrefix = () => null;
}
{
  const wrapOwner = (start: object): void => {
    let proto: object | null = Object.getPrototypeOf(start);
    while (proto) {
      const desc = Object.getOwnPropertyDescriptor(proto, 'querySelectorAll');
      if (desc && typeof desc.value === 'function') {
        const orig = desc.value;
        Object.defineProperty(proto, 'querySelectorAll', {
          configurable: true,
          writable: true,
          value: function (this: unknown, sel: string) {
            try {
              return orig.call(this, sel);
            } catch {
              return [] as unknown as NodeListOf<Element>;
            }
          },
        });
        return;
      }
      proto = Object.getPrototypeOf(proto);
    }
  };
  wrapOwner(new DOMParser().parseFromString('<a/>', 'application/xml'));
  wrapOwner(document.createElement('div'));
}
{
  const happy = (window as unknown as { happyDOM?: { settings?: { disableCSSFileLoading?: boolean } } })
    .happyDOM;
  if (happy?.settings) happy.settings.disableCSSFileLoading = true;
}
const loadViewModule = async (): Promise<FoliateViewModule> =>
  (await import('../apps/read-buddy-app/vendor/foliate-js/view.js')) as unknown as FoliateViewModule;

const BOOKS_DIR = 'E:\\书籍';
const BOOKS = [
  '说理-陈嘉映.epub',
  '走出唯一真理观-陈嘉映.epub',
  '何为良好生活-陈嘉映.epub',
  '哲学·科学·常识-陈嘉映.epub',
  '价值的理由-陈嘉映.epub',
  '从惊奇开始-刘擎等.epub',
  '2000年以来的西方-刘擎.epub',
  '刘擎西方现代思想讲义-刘擎.epub',
  '看见孩子-贝姬·肯尼迪.epub',
  '思考快与慢-丹尼尔·卡尼曼.epub',
  '清醒思考的艺术-罗尔夫·多贝里.epub',
  '毛泽东选集(全四卷)-毛泽东.epub',
  '大明王朝1566-刘和平.epub',
  '北平无战事(上下册)-刘和平.epub',
];

// ------------------------------------------------------- candidate rule set --

const SKIP_TITLES = new Set([
  '版权', '版权信息', '版权页', '版权声明', '目录', '目次', '扉页', '封面', '封底',
  '书名页', '内容简介', '内容提要', '出版信息', '图书在版编目',
]);
const normalizeTitle = (t: string): string =>
  t
    .replace(/[\s\u3000]/g, '')
    .replace(/^[《【［（(\[]+/, '')
    .replace(/[》】］）)\]:：、.。·\-—]+$/, '');
const titleHit = (title: string): boolean => SKIP_TITLES.has(normalizeTitle(title));

const STRONG_MARKERS = [
  '图书在版编目', 'CIP数据', '版权所有', '出版发行', '责任编辑', '封面设计',
  '装帧设计', '开本', '印张', '印次', '版次', '经销', '书号', '定价', 'ISBN',
];
const MARKER_HEAD_CHARS = 500;
const headMarkerKinds = (text: string): number =>
  STRONG_MARKERS.filter((m) => text.slice(0, MARKER_HEAD_CHARS).includes(m)).length;
const contentHit = (text: string): boolean => headMarkerKinds(text) >= 2;

interface LineShape {
  lineCount: number;
  medianLineLen: number;
  maxLineLen: number;
  sentenceEndFraction: number;
}
const shapeOf = (text: string): LineShape => {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  const lens = lines.map((l) => l.length).sort((a, b) => a - b);
  const endPunct = lines.filter((l) => /[。！？…”」』：；!?]$/.test(l)).length;
  return {
    lineCount: lines.length,
    medianLineLen: lens.length ? lens[Math.floor(lens.length / 2)]! : 0,
    maxLineLen: lens.length ? lens[lens.length - 1]! : 0,
    sentenceEndFraction: lines.length ? +(endPunct / lines.length).toFixed(3) : 0,
  };
};
const shapeHit = (s: LineShape): boolean =>
  s.lineCount >= 12 && s.medianLineLen <= 25 && s.maxLineLen <= 120 && s.sentenceEndFraction <= 0.2;

interface Verdict {
  book: string;
  nodeIndex: number;
  title: string;
  depth: number;
  charCount: number;
  reasons: string[];
  shape: LineShape;
  headMarkerKinds: number;
}

const out: Verdict[] = [];

async function run(bookFile: string): Promise<void> {
  const buffer = readFileSync(`${BOOKS_DIR}\\${bookFile}`);
  const file = new File([new Uint8Array(buffer)], bookFile, { type: 'application/epub+zip' });
  const engine = createFoliateEngine(file, { loadViewModule });
  try {
    await engine.prepare();
  } catch (error) {
    console.warn(`[skip] ${bookFile}: ${error instanceof Error ? error.message : String(error)}`);
    engine.close();
    return;
  }
  const content = engineToContent(engine, bookFile);
  const sections: SpineSectionInput[] = [];
  for (let index = 0; index < content.spineCount; index += 1) {
    const text = await content.getSpineText(index);
    const anchors: NodeAnchor[] = content.getSpineAnchors(index);
    sections.push({ title: content.getSpineTitle(index), text, spineIndex: index, anchors });
  }
  const entries = content.getTocEntries();
  const result = segmentSpineBook(bookFile, sections, entries);
  engine.close();

  for (const node of result.nodes) {
    const text = result.fullText.slice(node.startOffset, node.endOffset);
    const reasons: string[] = [];
    if (node.charCount < 50) reasons.push('short');
    if (titleHit(node.title)) reasons.push('title');
    if (contentHit(text)) reasons.push('content');
    const shape = shapeOf(text);
    if (shapeHit(shape)) reasons.push('shape');
    out.push({
      book: bookFile,
      nodeIndex: node.nodeIndex,
      title: node.title,
      depth: node.depth,
      charCount: node.charCount,
      reasons,
      shape,
      headMarkerKinds: headMarkerKinds(text),
      text: text.length > 6000 ? text.slice(0, 6000) : text,
    });
  }
  console.log(
    `[book] ${bookFile}: spine=${content.spineCount} entries=${entries.length} nodes=${result.nodes.length}`,
  );
}

describe('real-book classifier evidence', () => {
  it('collects verdicts for every book', async () => {
    for (const book of BOOKS) {
      if (!existsSync(`${BOOKS_DIR}\\${book}`)) continue;
      await run(book);
    }
    mkdirSync(path.join(import.meta.dirname, 'out'), { recursive: true });
    writeFileSync(path.join(import.meta.dirname, 'out/app-nodes.json'), JSON.stringify(out, null, 1));
    console.log(`[total] ${out.length} nodes`);
    expect(out.length).toBeGreaterThan(0);
  });
});

/**
 * Regression（真实书籍《何为良好生活：行之于途而应于心》复现）：
 *
 * Epubor 导出的 flow0002.css 含有空 `url()`。foliate epub.js 的 replaceCSS
 * 把空 href 交给 loadHref → resolveURL('', cssPath) 按 WHATWG 规范解析为
 * 基址文件自身 → CSS 把自己当嵌套资源再加载 → loadItem 的循环引用保护
 * （parents.every(p => p !== href)）失效走 loadBlob 直通 → createURL 发出
 * {type:'text/css', data: Blob} 事件 → paginator 的 CSS 预处理对 Blob 调
 * `.replace` 抛 `TypeError: data.replace is not a function` → section 加载
 * 拒绝 → 所有正文章节（第一章~第八章均链接 flow0002.css）无法渲染，阅读
 * 器卡死在目录页（目录页链接的 flow0001.css 无空 url()，故能正常显示）。
 *
 * 测试在真实 seam（vendored makeBook + 真实 Paginator CSS 变换监听器）上
 * 驱动该书的致险结构：正文 xhtml → link 引用含空 url() 的 css。
 */
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';

// paginator.js 的类字段在构造时创建 ResizeObserver；happy-dom 未必提供。
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
}

// happy-dom 的 XML Document 缺 lookupNamespaceURI/lookupPrefix；返回 null
// 让 foliate 的 childGetter 退回 localName 匹配（对本测试的文档等价）。
for (const proto of [
  Document.prototype,
  (globalThis as { XMLDocument?: { prototype?: object } }).XMLDocument?.prototype,
]) {
  if (!proto) continue;
  const anyProto = proto as Record<string, unknown>;
  if (typeof anyProto.lookupNamespaceURI !== 'function') {
    anyProto.lookupNamespaceURI = () => null;
  }
  if (typeof anyProto.lookupPrefix !== 'function') {
    anyProto.lookupPrefix = () => null;
  }
}

// happy-dom 不支持 `[*|href]:not([href])`（命名空间属性选择器）；
// 本 fixture 不含 SVG/xlink 引用，该查询等价于空结果。
// 沿原型链找到 querySelectorAll 的实际定义处再包装（Document/Element 分属不同原型）。
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

// happy-dom 会异步拉取解析中出现的样式表（含 blob: 与相对地址），
// 既产生网络噪音也与用例判定形成竞态；本测试只关心加载链本身。
{
  const happy = (window as unknown as {
    happyDOM?: { settings?: { disableCSSFileLoading?: boolean } };
  }).happyDOM;
  if (happy?.settings) happy.settings.disableCSSFileLoading = true;
}

const CONTAINER_XML = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

const CONTENT_OPF = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="bookid" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:test-empty-url</dc:identifier>
    <dc:title>空 url() 复现书</dc:title>
    <dc:language>zh</dc:language>
  </metadata>
  <manifest>
    <item href="text00001.html" id="id_1" media-type="application/xhtml+xml"/>
    <item href="style.css" id="id_2" media-type="text/css"/>
    <item href="toc.ncx" id="ncx" media-type="application/x-dtbncx+xml"/>
  </manifest>
  <spine toc="ncx">
    <itemref idref="id_1"/>
  </spine>
</package>`;

const TOC_NCX = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head/>
  <docTitle><text>正文</text></docTitle>
  <navMap>
    <navPoint id="id1" playOrder="1">
      <navLabel><text>正文</text></navLabel>
      <content src="text00001.html"/>
    </navPoint>
  </navMap>
</ncx>`;

/** 与故障书同构：正文页通过 <link> 引用一个含空 url() 的样式表。 */
const SECTION_HTML = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>正文</title><link href="style.css" rel="stylesheet" type="text/css"/></head>
<body><h1>第一章</h1><p>伦理与伦理学。</p></body>
</html>`;

/** 触发点：空 `url()`（CSS 规范允许，语义为无效引用/无引用）。 */
const STYLE_CSS = `body { margin: 5px; }
.calibre { background-image: url(); }
`;

async function buildFixture(): Promise<File> {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip');
  zip.file('META-INF/container.xml', CONTAINER_XML);
  zip.file('OEBPS/content.opf', CONTENT_OPF);
  zip.file('OEBPS/toc.ncx', TOC_NCX);
  zip.file('OEBPS/text00001.html', SECTION_HTML);
  zip.file('OEBPS/style.css', STYLE_CSS);
  const data = await zip.generateAsync({ type: 'arraybuffer' });
  return new File([data], 'fixture.epub', { type: 'application/epub+zip' });
}

/** makeBook 返回多格式联合；本测试只需要 sections[].load()。 */
interface LoadableSection {
  load(): Promise<unknown>;
}
type LoadableBook = { sections: LoadableSection[] } & object;

async function openEpub(file: File): Promise<LoadableBook> {
  const { makeBook } = await import('../../../vendor/foliate-js/view.js');
  return (await makeBook(file)) as unknown as LoadableBook;
}

async function attachPaginator(book: LoadableBook): Promise<void> {
  const { Paginator } = await import('../../../vendor/foliate-js/paginator.js');
  const paginator = new Paginator();
  paginator.open(book as unknown as Parameters<typeof paginator.open>[0]);
}

describe('vendored foliate epub loader × paginator CSS transform（空 url() 回归）', () => {
  it('正文 section 在其样式表含空 url() 时仍能加载（修复前 sections[0].load() 拒绝）', async () => {
    const book = await openEpub(await buildFixture());
    expect(book.sections.length).toBe(1);

    // 挂上真实 Paginator 的 CSS 变换监听器 —— 崩溃发生地。
    await attachPaginator(book);

    const src = await book.sections[0]!.load();
    expect(typeof src).toBe('string');
    expect(src).toMatch(/^blob:/);
  });

  it('无空 url() 的同构书（对照组）本来就能加载', async () => {
    const zip = new JSZip();
    zip.file('mimetype', 'application/epub+zip');
    zip.file('META-INF/container.xml', CONTAINER_XML);
    zip.file('OEBPS/content.opf', CONTENT_OPF);
    zip.file('OEBPS/toc.ncx', TOC_NCX);
    zip.file('OEBPS/text00001.html', SECTION_HTML);
    zip.file('OEBPS/style.css', 'body { margin: 5px; }\n');
    const data = await zip.generateAsync({ type: 'arraybuffer' });
    const book = await openEpub(new File([data], 'control.epub', { type: 'application/epub+zip' }));

    await attachPaginator(book);

    const src = await book.sections[0]!.load();
    expect(typeof src).toBe('string');
    expect(src).toMatch(/^blob:/);
  });
});

import { describe, expect, it } from 'vitest';
import { sanitizeSectionHtml } from './sanitize';

describe('sanitizeSectionHtml', () => {
  it('removes <script> elements together with their content', () => {
    const out = sanitizeSectionHtml('<p>正文段落</p><script>alert(1)</script>');
    expect(out).toContain('正文段落');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('alert');
  });

  it('strips inline event handler attributes but keeps the element and safe attrs', () => {
    const out = sanitizeSectionHtml('<p onclick="steal()" title="提示">文本</p>');
    expect(out).toContain('文本');
    expect(out).toContain('title="提示"');
    expect(out).not.toContain('onclick');
  });

  it('removes <iframe> with its src entirely', () => {
    const out = sanitizeSectionHtml(
      '<p>前文</p><iframe src="https://evil.example/x"></iframe><p>后文</p>',
    );
    expect(out).toContain('前文');
    expect(out).toContain('后文');
    expect(out).not.toContain('iframe');
    expect(out).not.toContain('evil.example');
  });

  it('keeps whitelisted inline semantics such as <em>', () => {
    const out = sanitizeSectionHtml('<p>雾中<em>灯火</em>摇曳</p>');
    expect(out).toContain('<em>灯火</em>');
  });

  it('unwraps non-whitelisted tags but keeps their inner text', () => {
    const out = sanitizeSectionHtml('<form><input value="x"><p>表单里的正文</p></form>');
    expect(out).toContain('表单里的正文');
    expect(out).toContain('<p>');
    expect(out).not.toContain('<form');
    expect(out).not.toContain('<input');
  });

  it('deletes external http images but keeps data: and relative ones', () => {
    const out = sanitizeSectionHtml(
      '<p><img src="https://cdn.example.com/a.png" alt="外链"></p>' +
        '<p><img src="images/pic.png" alt="本地图"></p>' +
        '<p><img src="data:image/png;base64,AAAA" alt="内嵌"></p>',
    );
    expect(out).not.toContain('cdn.example.com');
    expect(out).not.toContain('外链');
    expect(out).toContain('images/pic.png');
    expect(out).toContain('data:image/png;base64,AAAA');
  });

  it('removes javascript: hrefs and non-whitelisted attributes', () => {
    const out = sanitizeSectionHtml(
      '<p><a href="javascript:alert(1)" target="_blank" class="link" title="注">链接</a></p>',
    );
    expect(out).toContain('链接');
    expect(out).toContain('title="注"');
    expect(out).not.toContain('javascript:');
    expect(out).not.toContain('target');
    expect(out).not.toContain('class');
  });

  it('drops style blocks while keeping surrounding content', () => {
    const out = sanitizeSectionHtml('<style>.x { color: red; }</style><p>内容</p>');
    expect(out).toContain('内容');
    expect(out).not.toContain('color');
    expect(out).not.toContain('<style');
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { engineWebfontCss, resetWebfontCacheForTests } from './webfonts';

describe('engineWebfontCss', () => {
  afterEach(() => {
    document.querySelectorAll('style[data-webfont-test]').forEach((el) => el.remove());
    resetWebfontCacheForTests();
  });

  it('collects LXGW WenKai @font-face rules with absolutized urls', () => {
    const style = document.createElement('style');
    style.setAttribute('data-webfont-test', '');
    style.textContent = [
      "@font-face { font-family: 'LXGW WenKai'; src: url(/_next/static/media/lxgw-4.woff2) format('woff2'); }",
      "@font-face { font-family: 'Something Else'; src: url(/other.woff2) format('woff2'); }",
    ].join('\n');
    document.head.appendChild(style);
    resetWebfontCacheForTests();

    const css = engineWebfontCss();

    // happy-dom exposes CSSFontFaceRule through the CSSOM, so the bridge
    // must actually produce absolutized rules (no silent empty fallback).
    expect(css).toContain('LXGW WenKai');
    expect(css).toContain(`url("${window.location.origin}/_next/static/media/lxgw-4.woff2")`);
    expect(css).not.toContain('Something Else');
  });

  it('returns empty (not a throw) when no webfont rules exist', () => {
    resetWebfontCacheForTests();
    expect(engineWebfontCss()).toBe('');
  });
});

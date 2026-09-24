/**
 * App-shipped web fonts (globals.css, e.g. LXGW WenKai) live in the parent
 * document; engine chapters render inside blob iframes, which do NOT
 * inherit parent fonts. This helper re-collects their @font-face rules from
 * the parent CSSOM and rewrites every font url to an absolute URL resolved
 * against the owning stylesheet (Turbopack emits `../media/...`-style
 * relative urls, which resolve against the CSS chunk in the parent but
 * against the blob base inside chapter iframes), so the very same files
 * also load inside engine iframes.
 */

/** Font families that ship with the app and must reach the engine iframes. */
const WEBFONT_FAMILIES = new Set(['LXGW WenKai']);

/** `scheme:` prefix — http(s)/data/blob urls are already absolute. */
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

let cached: string | null = null;

/** Resolve one url() payload against the stylesheet it came from. */
function absolutizeUrl(raw: string, baseUrl: string | null): string {
  const trimmed = raw.trim().replace(/^["']|["']$/g, '');
  if (HAS_SCHEME.test(trimmed) || trimmed.startsWith('#')) return `url("${trimmed}")`;
  try {
    return `url("${new URL(trimmed, baseUrl ?? window.location.href).toString()}")`;
  } catch {
    return `url("${trimmed}")`;
  }
}

export function engineWebfontCss(): string {
  if (typeof document === 'undefined') return '';
  if (cached !== null) return cached;

  const rules: string[] = [];
  try {
    const hasFontFaceRule = typeof CSSFontFaceRule !== 'undefined';
    for (const sheet of Array.from(document.styleSheets)) {
      let cssRules: CSSRuleList;
      try {
        cssRules = sheet.cssRules;
      } catch {
        continue; // cross-origin stylesheet: unreadable, skip
      }
      for (const rule of Array.from(cssRules)) {
        if (!hasFontFaceRule || !(rule instanceof CSSFontFaceRule)) continue;
        const family = rule.style
          .getPropertyValue('font-family')
          .trim()
          .replace(/^["']|["']$/g, '');
        if (!WEBFONT_FAMILIES.has(family)) continue;
        const baseUrl = rule.parentStyleSheet?.href ?? sheet.href ?? null;
        rules.push(
          // Rewrite every url() in the rule (src may list woff2 + woff).
          rule.cssText.replace(/url\((['"]?)([^'")]+)\1\)/g, (_m, _q, raw) =>
            absolutizeUrl(raw, baseUrl),
          ),
        );
      }
    }
  } catch {
    /* CSSOM unavailable (restricted env): system fallbacks still apply */
  }
  cached = rules.join('\n');
  return cached;
}

/** Test seam: forget the memoized rules (stylesheets may change in tests). */
export function resetWebfontCacheForTests(): void {
  cached = null;
}

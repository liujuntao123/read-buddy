/**
 * HTML sanitizer for imported EPUB spine sections (ticket 06, design doc
 * "EPUB 展示安全过滤").
 *
 * Imported markup is untrusted: everything outside a tag/attribute
 * whitelist is dropped or unwrapped before the reader renders it via
 * `dangerouslySetInnerHTML`. Specifically:
 * - script/style/iframe/... nodes are removed together with their content;
 * - unknown tags are unwrapped (children kept) so text never disappears;
 * - attributes are limited to href/title/alt/src, no `on*` handlers, no
 *   `javascript:` URLs, and `src` may only be a `data:` URL or a relative
 *   path — external http(s) images are deleted outright (offline-first).
 */

/** Elements removed together with their entire subtree. */
const DROP_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'IFRAME',
  'FRAME',
  'OBJECT',
  'EMBED',
  'LINK',
  'META',
  'NOSCRIPT',
]);

/** Element whitelist; anything else is unwrapped while keeping its children. */
const ALLOWED_TAGS = new Set([
  'P',
  'DIV',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'EM',
  'STRONG',
  'I',
  'B',
  'U',
  'S',
  'BLOCKQUOTE',
  'UL',
  'OL',
  'LI',
  'A',
  'IMG',
  'CODE',
  'PRE',
  'BR',
  'HR',
  'SPAN',
  'SECTION',
  'ARTICLE',
  'FIGURE',
  'FIGCAPTION',
  'TABLE',
  'THEAD',
  'TBODY',
  'TR',
  'TH',
  'TD',
  'SUP',
  'SUB',
]);

/** Attribute whitelist (permitted names only; values are validated below). */
const ALLOWED_ATTRS = new Set(['href', 'title', 'alt', 'src']);

/** `scheme:` prefix — used to reject absolute URLs except `data:`. */
const ABSOLUTE_URL = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Filter the element's attributes in place.
 * Returns `false` when the element itself must be dropped (an image whose
 * `src` points at an external absolute URL).
 */
function sanitizeAttributes(el: Element): boolean {
  const tag = el.tagName.toUpperCase();
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name.toLowerCase();
    const value = (attr.value ?? '').trim();

    if (name.startsWith('on')) {
      el.removeAttribute(attr.name);
      continue;
    }
    if (!ALLOWED_ATTRS.has(name)) {
      el.removeAttribute(attr.name);
      continue;
    }
    if (name === 'href' && value.toLowerCase().startsWith('javascript:')) {
      el.removeAttribute(attr.name);
      continue;
    }
    if (name === 'src') {
      const isSafe = value.toLowerCase().startsWith('data:') || !ABSOLUTE_URL.test(value);
      if (tag === 'IMG') {
        if (!isSafe) return false; // external image: remove the whole <img>
      } else if (!isSafe) {
        el.removeAttribute(attr.name);
      }
    }
  }
  return true;
}

/** Depth-first sanitize: drop dangerous nodes, filter attributes, unwrap shells. */
function sanitizeNode(el: Element): void {
  const tag = el.tagName.toUpperCase();
  if (DROP_TAGS.has(tag)) {
    el.remove();
    return;
  }

  // Children first: a dropped external <img> removes itself here.
  for (const child of Array.from(el.children)) sanitizeNode(child);

  if (!sanitizeAttributes(el)) {
    el.remove();
    return;
  }

  if (!ALLOWED_TAGS.has(tag)) {
    // Unwrap: hoist the already-sanitized children, drop the shell element.
    const parent = el.parentNode;
    if (parent) {
      while (el.firstChild) parent.insertBefore(el.firstChild, el);
      el.remove();
    }
  }
}

/**
 * Sanitize an untrusted XHTML/HTML fragment and return safe body markup.
 */
export function sanitizeSectionHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (const child of Array.from(doc.body.children)) sanitizeNode(child);
  return doc.body.innerHTML;
}

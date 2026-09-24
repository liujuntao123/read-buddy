/**
 * Cover extraction through the vendored Foliate engine (original readest
 * approach): `makeBook(file)` parses any engine format (EPUB / MOBI / FB2 /
 * CBZ) without creating a `<foliate-view>`, `book.getCover()` resolves the
 * cover image as a Blob, and the book is destroyed right after so blob URLs
 * and cached sections are released.
 *
 * The zip-heuristic cover reader in `epubParser.ts` stays as the EPUB-only
 * fallback (it also feeds title/author); this service covers every engine
 * format plus EPUBs whose cover is only declared via `<guide>` (foliate
 * resolves all three declarations: properties="cover-image", EPUB2
 * `<meta name="cover">` and guide references).
 */
import { toBase64 } from './epubParser';
import type { FoliateBook, FoliateViewModule } from './foliateEngine';

export interface CoverExtractionDeps {
  /** Lazy loader seam for the vendored view module (tests inject a fake). */
  loadViewModule?: () => Promise<FoliateViewModule>;
}

const defaultLoadViewModule = (): Promise<FoliateViewModule> =>
  import('../../../vendor/foliate-js/view.js') as unknown as Promise<FoliateViewModule>;

/** Blob → data URL (base64), so covers persist in IndexedDB as plain strings. */
export async function blobToDataUrl(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  return `data:${blob.type || 'image/jpeg'};base64,${toBase64(new Uint8Array(buffer))}`;
}

/**
 * Extract the cover of an engine-format book file via Foliate. Resolves
 * `undefined` whenever anything is missing or fails — a cover must never
 * break the import flow.
 */
export async function extractCover(
  file: File,
  deps: CoverExtractionDeps = {},
): Promise<string | undefined> {
  const loadViewModule = deps.loadViewModule ?? defaultLoadViewModule;
  let book: FoliateBook | null = null;
  try {
    const mod = await loadViewModule();
    if (typeof mod.makeBook !== 'function') return undefined;
    book = await mod.makeBook(file);
    const getCover = (book as { getCover?: () => Promise<Blob | null> }).getCover;
    if (typeof getCover !== 'function') return undefined;
    const blob = await getCover.call(book);
    if (!(blob instanceof Blob) || blob.size === 0) return undefined;
    return await blobToDataUrl(blob);
  } catch {
    return undefined;
  } finally {
    try {
      book?.destroy?.();
    } catch {
      /* best-effort blob URL release */
    }
  }
}

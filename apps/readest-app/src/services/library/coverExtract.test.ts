import { describe, expect, it, vi } from 'vitest';
import { blobToDataUrl, extractCover } from './coverExtract';
import type { FoliateViewModule } from './foliateEngine';

const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const moduleWithBook = (book: Record<string, unknown>): FoliateViewModule => ({
  makeBook: vi.fn(async () => book as never),
});

describe('extractCover', () => {
  it('resolves the cover blob as a data URL and destroys the book', async () => {
    const destroy = vi.fn();
    const mod = moduleWithBook({
      getCover: async () => new Blob([pngBytes], { type: 'image/png' }),
      destroy,
    });

    const cover = await extractCover(new File([pngBytes], '书.epub'), {
      loadViewModule: () => Promise.resolve(mod),
    });

    expect(cover).toMatch(/^data:image\/png;base64,/);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('returns undefined when the book has no cover or no makeBook export', async () => {
    expect(
      await extractCover(new File([pngBytes], '书.epub'), {
        loadViewModule: () => Promise.resolve({}),
      }),
    ).toBeUndefined();

    expect(
      await extractCover(new File([pngBytes], '书.epub'), {
        loadViewModule: () => Promise.resolve(moduleWithBook({ getCover: async () => null })),
      }),
    ).toBeUndefined();
  });

  it('never throws — parse failures resolve undefined and still destroy', async () => {
    const destroy = vi.fn();
    const mod = moduleWithBook({
      getCover: async () => {
        throw new Error('cover blew up');
      },
      destroy,
    });

    const cover = await extractCover(new File([pngBytes], '书.epub'), {
      loadViewModule: () => Promise.resolve(mod),
    });
    expect(cover).toBeUndefined();
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});

describe('blobToDataUrl', () => {
  it('encodes arbitrary blobs with their mime type', async () => {
    const url = await blobToDataUrl(new Blob([new Uint8Array([65, 66, 67])], { type: 'image/jpeg' }));
    expect(url).toBe(`data:image/jpeg;base64,${btoa('ABC')}`);
  });
});

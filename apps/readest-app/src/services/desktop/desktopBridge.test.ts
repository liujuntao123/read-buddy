import { describe, expect, it, vi } from 'vitest';
import { initDesktopFileOpen, isDesktop } from './desktopBridge';

describe('desktopBridge', () => {
  it('reports non-desktop in plain web (happy-dom) builds', () => {
    expect(isDesktop()).toBe(false);
  });

  it('returns null without wiring when not desktop and no injected listener', async () => {
    await expect(initDesktopFileOpen()).resolves.toBeNull();
  });

  it('listens for book-file-opened, reads bytes and routes into importFiles', async () => {
    const received: { event: string }[] = [];
    const importFiles = vi.fn().mockResolvedValue(undefined);
    let handler: (payload: unknown) => void = () => {};

    const unlisten = await initDesktopFileOpen({
      listen: async (event, h) => {
        received.push({ event });
        handler = h;
        return () => {};
      },
      invoke: async (cmd, args) => {
        expect(cmd).toBe('read_book_file');
        expect((args as { path: string }).path).toBe('C:\\books\\三体.epub');
        return [104, 105]; // "hi"
      },
      importFiles,
    });

    expect(unlisten).toBeTypeOf('function');
    expect(received.map((r) => r.event)).toEqual(['book-file-opened']);

    await handler('C:\\books\\三体.epub');
    expect(importFiles).toHaveBeenCalledTimes(1);
    const [files] = importFiles.mock.calls[0] as unknown as [File[]];
    expect(files[0].name).toBe('三体.epub');
    expect(files[0].size).toBe(2);
  });

  it('swallows command errors instead of throwing into the event loop', async () => {
    const importFiles = vi.fn();
    let handler: (payload: unknown) => void = () => {};
    await initDesktopFileOpen({
      listen: async (_event, h) => {
        handler = h;
        return () => {};
      },
      invoke: async () => {
        throw new Error('file locked');
      },
      importFiles,
    });
    await expect(handler('/missing.epub')).resolves.toBeUndefined();
    expect(importFiles).not.toHaveBeenCalled();
  });
});

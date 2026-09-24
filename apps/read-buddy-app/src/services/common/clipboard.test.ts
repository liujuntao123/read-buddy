import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyToClipboard } from './clipboard';

const setClipboard = (value: unknown) => {
  Object.defineProperty(navigator, 'clipboard', {
    value,
    configurable: true,
    writable: true,
  });
};

const textareasInBody = () => document.querySelectorAll('textarea').length;

afterEach(() => {
  setClipboard(undefined);
  vi.restoreAllMocks();
});

describe('copyToClipboard', () => {
  it('uses the async Clipboard API when it is available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });

    await expect(copyToClipboard('要复制的文本')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('要复制的文本');
    expect(textareasInBody()).toBe(0);
  });

  it('falls back to the off-screen textarea when writeText rejects', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('NotAllowedError'));
    setClipboard({ writeText });
    const execCommand = vi.fn().mockReturnValue(true);
    document.execCommand = execCommand;

    await expect(copyToClipboard('降级路径')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(execCommand).toHaveBeenCalledWith('copy');
    // The helper textarea never outlives the call.
    expect(textareasInBody()).toBe(0);
  });

  it('falls back when navigator.clipboard is missing entirely', async () => {
    setClipboard(undefined);
    const execCommand = vi.fn().mockReturnValue(true);
    document.execCommand = execCommand;

    await expect(copyToClipboard('无剪贴板 API')).resolves.toBe(true);
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(textareasInBody()).toBe(0);
  });

  it('reports failure instead of claiming success', async () => {
    setClipboard(undefined);
    document.execCommand = vi.fn().mockReturnValue(false);

    await expect(copyToClipboard('失败')).resolves.toBe(false);
    expect(textareasInBody()).toBe(0);
  });

  it('survives an execCommand that throws, and still cleans up', async () => {
    setClipboard(undefined);
    document.execCommand = vi.fn(() => {
      throw new Error('boom');
    });

    await expect(copyToClipboard('异常')).resolves.toBe(false);
    expect(textareasInBody()).toBe(0);
  });
});

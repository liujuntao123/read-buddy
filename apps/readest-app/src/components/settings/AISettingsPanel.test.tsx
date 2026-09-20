import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AISettingsPanel from './AISettingsPanel';
import { useAISettingsStore } from '@/store/aiSettingsStore';
import { AISettingsRepository } from '@/services/db/repositories';
import { ReadestPlusDatabase } from '@/services/db/database';
import { DEFAULT_AI_SETTINGS } from '@/types/ai';
import { testConnection } from '@/services/ai/testConnection';

/**
 * The service layer is mocked so the panel test exercises UI wiring only;
 * the default store singleton picks up the mock at module-init time.
 */
vi.mock('@/services/ai/testConnection', () => ({ testConnection: vi.fn() }));

const testConnectionMock = vi.mocked(testConnection);

const input = (testId: string) => screen.getByTestId(testId) as HTMLInputElement;

beforeEach(() => {
  useAISettingsStore.setState({
    settings: { ...DEFAULT_AI_SETTINGS },
    status: 'idle',
    toast: null,
  });
  testConnectionMock.mockReset();
});

describe('AISettingsPanel', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<AISettingsPanel open={false} onClose={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('masks the API key by default and toggles with the eye icon', () => {
    render(<AISettingsPanel open onClose={vi.fn()} />);
    expect(input('api-key-input').type).toBe('password');
    fireEvent.click(screen.getByRole('button', { name: '显示 API Key' }));
    expect(input('api-key-input').type).toBe('text');
    fireEvent.click(screen.getByRole('button', { name: '隐藏 API Key' }));
    expect(input('api-key-input').type).toBe('password');
  });

  it('prefills the base URL preset when the provider changes', () => {
    render(<AISettingsPanel open onClose={vi.fn()} />);
    const provider = screen.getByTestId('provider-select') as HTMLSelectElement;
    fireEvent.change(provider, { target: { value: 'ollama' } });
    expect(input('base-url-input').value).toBe('http://localhost:11434/v1');
    fireEvent.change(provider, { target: { value: 'deepseek' } });
    expect(input('base-url-input').value).toBe('https://api.deepseek.com/v1');
    fireEvent.change(provider, { target: { value: 'claude' } });
    expect(input('base-url-input').value).toBe('https://api.openai.com/v1');
    fireEvent.change(provider, { target: { value: 'openai-compatible' } });
    expect(input('base-url-input').value).toBe('https://api.openai.com/v1');
  });

  it('persists valid settings to IndexedDB on save (read back via an independent db instance)', async () => {
    render(<AISettingsPanel open onClose={vi.fn()} />);
    fireEvent.change(input('base-url-input'), { target: { value: 'https://api.example.com/v1' } });
    fireEvent.change(input('model-input'), { target: { value: 'my-model' } });
    fireEvent.change(input('api-key-input'), { target: { value: 'sk-panel' } });
    fireEvent.change(input('temperature-input'), { target: { value: '0.2' } });
    fireEvent.change(input('max-turns-input'), { target: { value: '15' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    const repository = new AISettingsRepository(new ReadestPlusDatabase());
    await waitFor(async () => {
      await expect(repository.load()).resolves.toMatchObject({
        baseUrl: 'https://api.example.com/v1',
        model: 'my-model',
        apiKey: 'sk-panel',
        temperature: 0.2,
        maxTurnsPerTopic: 15,
      });
    });
    expect(useAISettingsStore.getState().settings.model).toBe('my-model');
  });

  it('shows field errors and keeps the store untouched when saving invalid settings', async () => {
    render(<AISettingsPanel open onClose={vi.fn()} />);
    fireEvent.change(input('model-input'), { target: { value: '' } });
    fireEvent.change(input('api-key-input'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(await screen.findByText('Model ID 不能为空')).toBeTruthy();
    expect(screen.getByText('API Key 不能为空')).toBeTruthy();
    expect(useAISettingsStore.getState().settings).toEqual(DEFAULT_AI_SETTINGS);
  });

  it('shows a green toast for a successful connection test', async () => {
    testConnectionMock.mockResolvedValue({ ok: true, message: '连接成功：模型服务可用' });
    render(<AISettingsPanel open onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /测试连接/ }));
    expect(await screen.findByText('连接成功：模型服务可用')).toBeTruthy();
    expect(screen.getByTestId('ai-settings-toast').className).toContain('alert-success');
  });

  it('shows a red toast for a failed connection test and supports manual dismissal', async () => {
    testConnectionMock.mockResolvedValue({ ok: false, message: 'API Key 无效或未授权' });
    render(<AISettingsPanel open onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /测试连接/ }));
    expect(await screen.findByText('API Key 无效或未授权')).toBeTruthy();
    expect(screen.getByTestId('ai-settings-toast').className).toContain('alert-error');
    fireEvent.click(screen.getByRole('button', { name: '关闭提示' }));
    expect(screen.queryByTestId('ai-settings-toast')).toBeNull();
  });

  it('auto-dismisses the toast after 3 seconds', async () => {
    vi.useFakeTimers();
    try {
      testConnectionMock.mockResolvedValue({ ok: true, message: '连接成功：模型服务可用' });
      render(<AISettingsPanel open onClose={vi.fn()} />);
      fireEvent.click(screen.getByRole('button', { name: /测试连接/ }));
      // Flush the mocked promise microtasks; waitFor-style polling is
      // timer-based and would hang under fake timers.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(screen.getByTestId('ai-settings-toast')).toBeTruthy();
      actAdvance(3_000);
      expect(screen.queryByTestId('ai-settings-toast')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

/** Advance fake timers inside act() so React state flushes. */
function actAdvance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

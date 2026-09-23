import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AISettingsPanel from './AISettingsPanel';
import { useAISettingsStore } from '@/store/aiSettingsStore';
import { AISettingsRepository } from '@/services/db/repositories';
import { ReadestPlusDatabase } from '@/services/db/database';
import { DEFAULT_AI_SETTINGS } from '@/types/ai';
import { testConnection } from '@/services/ai/testConnection';
import { listModels } from '@/services/ai/listModels';

/**
 * The service layer is mocked so the panel test exercises UI wiring only;
 * the default store singleton picks up the mock at module-init time.
 */
vi.mock('@/services/ai/testConnection', () => ({ testConnection: vi.fn() }));
vi.mock('@/services/ai/listModels', () => ({ listModels: vi.fn() }));

const testConnectionMock = vi.mocked(testConnection);
const listModelsMock = vi.mocked(listModels);

const input = (testId: string) => screen.getByTestId(testId) as HTMLInputElement;

beforeEach(() => {
  useAISettingsStore.setState({
    settings: { ...DEFAULT_AI_SETTINGS },
    status: 'idle',
    toast: null,
    availableModels: null,
  });
  testConnectionMock.mockReset();
  listModelsMock.mockReset();
});

/** Pick an option from the provider Selector popover. */
const chooseProvider = async (label: string | RegExp) => {
  fireEvent.click(within(screen.getByTestId('provider-select')).getByRole('combobox'));
  fireEvent.click(await screen.findByRole('option', { name: label }));
};

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

  it('prefills the base URL preset when the provider changes', async () => {
    render(<AISettingsPanel open onClose={vi.fn()} />);
    await chooseProvider('DeepSeek 官方 API');
    expect(input('base-url-input').value).toBe('https://api.deepseek.com/v1');
    await chooseProvider('OpenAI 兼容接口 (通用)');
    expect(input('base-url-input').value).toBe('https://api.openai.com/v1');
  });

  it('offers only the two OpenAI-compatible providers', async () => {
    render(<AISettingsPanel open onClose={vi.fn()} />);
    fireEvent.click(within(screen.getByTestId('provider-select')).getByRole('combobox'));
    const labels = (await screen.findAllByRole('option')).map((option) => option.textContent);
    expect(labels).toEqual(['OpenAI 兼容接口 (通用)', 'DeepSeek 官方 API']);
  });

  it('persists valid settings to IndexedDB on save and displays success toast feedback', async () => {
    const onClose = vi.fn();
    render(<AISettingsPanel open onClose={onClose} />);
    fireEvent.change(input('base-url-input'), { target: { value: 'https://api.example.com/v1' } });
    fireEvent.change(input('model-input'), { target: { value: 'my-model' } });
    fireEvent.change(input('api-key-input'), { target: { value: 'sk-panel' } });
    fireEvent.change(input('max-turns-input'), { target: { value: '15' } });
    fireEvent.blur(input('max-turns-input')); // NumberInput commits on blur
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(await screen.findByText('设置已成功保存')).toBeTruthy();
    expect(screen.getByTestId('ai-settings-toast').getAttribute('data-tone')).toBe('success');

    const repository = new AISettingsRepository(new ReadestPlusDatabase());
    await waitFor(async () => {
      await expect(repository.load()).resolves.toMatchObject({
        baseUrl: 'https://api.example.com/v1',
        model: 'my-model',
        apiKey: 'sk-panel',
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

  it('pulls the endpoint model list and selects one into Model ID', async () => {
    listModelsMock.mockResolvedValue({
      ok: true,
      models: ['deepseek-chat', 'deepseek-reasoner'],
      message: '已拉取 2 个模型，可在下方选择',
    });
    render(<AISettingsPanel open onClose={vi.fn()} />);
    fireEvent.change(input('base-url-input'), { target: { value: 'https://api.deepseek.com/v1/' } });
    fireEvent.change(input('api-key-input'), { target: { value: 'sk-live' } });

    // Nothing to pick from until a pull happens: Model ID is free text first.
    expect(screen.queryByTestId('model-select')).toBeNull();

    // The pull is an icon-only button: no visible label, name from aria-label.
    const pullButton = screen.getByTestId('fetch-models');
    expect(pullButton.textContent?.trim()).toBe('');
    expect(screen.getByRole('button', { name: '拉取模型列表' })).toBe(pullButton);

    fireEvent.click(pullButton);

    expect(await screen.findByText('已拉取 2 个模型，可在下方选择')).toBeTruthy();
    // The trailing slash is normalised away, so the pull speaks the same URL
    // the connection probe would.
    expect(listModelsMock).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: 'https://api.deepseek.com/v1/', apiKey: 'sk-live' }),
      expect.any(Function),
    );

    fireEvent.click(within(screen.getByTestId('model-select')).getByRole('combobox'));
    fireEvent.click(await screen.findByRole('option', { name: 'deepseek-reasoner' }));
    expect(input('model-input').value).toBe('deepseek-reasoner');
  });

  it('keeps a pulled model list only for the endpoint it came from', async () => {
    listModelsMock.mockResolvedValue({
      ok: true,
      models: ['deepseek-chat'],
      message: '已拉取 1 个模型，可在下方选择',
    });
    render(<AISettingsPanel open onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId('fetch-models'));
    expect(await screen.findByTestId('model-select')).toBeTruthy();

    // Same endpoint modulo a trailing slash: still the list that was pulled.
    fireEvent.change(input('base-url-input'), { target: { value: 'https://api.openai.com/v1/' } });
    expect(screen.getByTestId('model-select')).toBeTruthy();

    // Another endpoint: the offer expires rather than serving another service's models.
    fireEvent.change(input('base-url-input'), { target: { value: 'https://api.deepseek.com/v1' } });
    expect(screen.queryByTestId('model-select')).toBeNull();
  });

  it('reports a failed pull and keeps the manual Model ID intact', async () => {
    listModelsMock.mockResolvedValue({ ok: false, models: [], message: 'API Key 无效或未授权' });
    render(<AISettingsPanel open onClose={vi.fn()} />);
    fireEvent.change(input('model-input'), { target: { value: 'my-model' } });
    fireEvent.click(screen.getByTestId('fetch-models'));

    expect(await screen.findByText('API Key 无效或未授权')).toBeTruthy();
    expect(screen.getByTestId('ai-settings-toast').getAttribute('data-tone')).toBe('error');
    expect(screen.queryByTestId('model-select')).toBeNull();
    expect(input('model-input').value).toBe('my-model');
  });

  it('shows a green toast for a successful connection test', async () => {
    testConnectionMock.mockResolvedValue({ ok: true, message: '连接成功：模型服务可用' });
    render(<AISettingsPanel open onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /测试连接/ }));
    expect(await screen.findByText('连接成功：模型服务可用')).toBeTruthy();
    expect(screen.getByTestId('ai-settings-toast').getAttribute('data-tone')).toBe('success');
  });

  it('shows a red toast for a failed connection test and supports manual dismissal', async () => {
    testConnectionMock.mockResolvedValue({ ok: false, message: 'API Key 无效或未授权' });
    render(<AISettingsPanel open onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /测试连接/ }));
    expect(await screen.findByText('API Key 无效或未授权')).toBeTruthy();
    expect(screen.getByTestId('ai-settings-toast').getAttribute('data-tone')).toBe('error');
    fireEvent.click(screen.getByRole('button', { name: '关闭提示' }));
    await waitFor(() => expect(screen.queryByTestId('ai-settings-toast')).toBeNull());
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

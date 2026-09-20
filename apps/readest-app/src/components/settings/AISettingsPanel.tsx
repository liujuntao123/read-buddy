'use client';

import { useEffect, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useAISettingsStore } from '@/store/aiSettingsStore';
import { MAX_TURNS_PER_TOPIC, MIN_TURNS_PER_TOPIC, type AIProvider, type AISettings } from '@/types/ai';
import type { AISettingsErrors } from '@/services/ai/validation';

/** Base URL presets applied when the provider changes (design doc 4.1). */
const PROVIDER_BASE_URL_PRESETS: Record<AIProvider, string> = {
  'openai-compatible': 'https://api.openai.com/v1',
  deepseek: 'https://api.deepseek.com/v1',
  // Claude is reached through an OpenAI-compatible proxy endpoint.
  claude: 'https://api.openai.com/v1',
  ollama: 'http://localhost:11434/v1',
};

const TOAST_AUTO_DISMISS_MS = 3_000;

interface AISettingsPanelProps {
  open: boolean;
  onClose: () => void;
}

/**
 * AI Provider 配置中心 (design doc 4.1 / ADR 0008): OpenAI-compatible
 * endpoint + credentials + turn quota, persisted as plaintext in IndexedDB
 * and masked in the UI. Rendered as a daisyUI modal over the sidebar.
 */
export default function AISettingsPanel({ open, onClose }: AISettingsPanelProps) {
  const settings = useAISettingsStore((s) => s.settings);
  const save = useAISettingsStore((s) => s.save);
  const testConnection = useAISettingsStore((s) => s.testConnection);
  const toast = useAISettingsStore((s) => s.toast);
  const clearToast = useAISettingsStore((s) => s.clearToast);

  // Mounted only while open, so the draft seeds from the persisted settings.
  const [draft, setDraft] = useState<AISettings>(settings);
  const [errors, setErrors] = useState<AISettingsErrors>({});
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);

  // Toast auto-dismisses after 3s (manual close button also available).
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => clearToast(), TOAST_AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [toast, clearToast]);

  if (!open) return null;

  const update = <K extends keyof AISettings>(key: K, value: AISettings[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const changeProvider = (provider: AIProvider) =>
    setDraft((current) => ({ ...current, provider, baseUrl: PROVIDER_BASE_URL_PRESETS[provider] }));

  const handleSave = async () => {
    const saveErrors = await save(draft);
    setErrors(saveErrors);
  };

  const handleTestConnection = async () => {
    setTesting(true);
    try {
      await testConnection(draft);
    } finally {
      setTesting(false);
    }
  };

  const fieldError = (field: keyof AISettingsErrors) =>
    errors[field] ? <p className="mt-1 text-xs text-error">{errors[field]}</p> : null;

  return (
    <div className="modal modal-open">
      <div className="modal-box relative max-w-lg" data-testid="ai-settings-panel">
        <h3 className="mb-4 text-lg font-bold">AI Provider 设置</h3>

        <div className="grid gap-3">
          <label className="form-control">
            <div className="label pb-1">
              <span className="label-text">Provider</span>
            </div>
            <select
              className="select w-full"
              data-testid="provider-select"
              value={draft.provider}
              onChange={(event) => changeProvider(event.target.value as AIProvider)}
            >
              <option value="openai-compatible">OpenAI 兼容</option>
              <option value="deepseek">DeepSeek</option>
              <option value="claude">Claude（OpenAI 代理）</option>
              <option value="ollama">Ollama（本地）</option>
            </select>
            {fieldError('provider')}
          </label>

          <label className="form-control">
            <div className="label pb-1">
              <span className="label-text">Base URL</span>
            </div>
            <input
              type="text"
              className="input w-full"
              data-testid="base-url-input"
              placeholder="https://api.example.com/v1"
              value={draft.baseUrl}
              onChange={(event) => update('baseUrl', event.target.value)}
            />
            {fieldError('baseUrl')}
          </label>

          <label className="form-control">
            <div className="label pb-1">
              <span className="label-text">Model ID</span>
            </div>
            <input
              type="text"
              className="input w-full"
              data-testid="model-input"
              placeholder="deepseek-chat / gpt-4o-mini"
              value={draft.model}
              onChange={(event) => update('model', event.target.value)}
            />
            {fieldError('model')}
          </label>

          <div className="form-control">
            <div className="label pb-1">
              <span className="label-text">API Key{draft.provider === 'ollama' ? '（本地模型可留空）' : ''}</span>
            </div>
            <label className="input flex items-center gap-2">
              <input
                type={showKey ? 'text' : 'password'}
                className="grow"
                data-testid="api-key-input"
                placeholder="sk-..."
                autoComplete="off"
                value={draft.apiKey}
                onChange={(event) => update('apiKey', event.target.value)}
              />
              <button
                type="button"
                className="btn btn-ghost btn-xs"
                aria-label={showKey ? '隐藏 API Key' : '显示 API Key'}
                onClick={() => setShowKey((visible) => !visible)}
              >
                {showKey ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
              </button>
            </label>
            {fieldError('apiKey')}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="form-control">
              <div className="label pb-1">
                <span className="label-text">Temperature（0 ~ 2）</span>
              </div>
              <input
                type="number"
                className="input w-full"
                data-testid="temperature-input"
                min={0}
                max={2}
                step={0.1}
                value={Number.isFinite(draft.temperature) ? draft.temperature : ''}
                onChange={(event) => update('temperature', event.target.valueAsNumber)}
              />
              {fieldError('temperature')}
            </label>

            <label className="form-control">
              <div className="label pb-1">
                <span className="label-text">轮数配额（{MIN_TURNS_PER_TOPIC} ~ {MAX_TURNS_PER_TOPIC}）</span>
              </div>
              <input
                type="number"
                className="input w-full"
                data-testid="max-turns-input"
                min={MIN_TURNS_PER_TOPIC}
                max={MAX_TURNS_PER_TOPIC}
                step={1}
                value={Number.isInteger(draft.maxTurnsPerTopic) ? draft.maxTurnsPerTopic : ''}
                onChange={(event) => update('maxTurnsPerTopic', event.target.valueAsNumber)}
              />
              {fieldError('maxTurnsPerTopic')}
            </label>
          </div>
        </div>

        <div className="modal-action">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="btn btn-outline"
            disabled={testing}
            onClick={() => void handleTestConnection()}
          >
            {testing ? '测试中…' : '测试连接'}
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void handleSave()}>
            保存
          </button>
        </div>

        {toast && (
          <div className="toast toast-end toast-bottom">
            <div
              className={`alert py-2 ${toast.type === 'success' ? 'alert-success' : 'alert-error'}`}
              data-testid="ai-settings-toast"
            >
              <span>{toast.text}</span>
              <button
                type="button"
                className="btn btn-ghost btn-xs"
                aria-label="关闭提示"
                onClick={clearToast}
              >
                ✕
              </button>
            </div>
          </div>
        )}
      </div>
      <div className="modal-backdrop" onClick={onClose} />
    </div>
  );
}

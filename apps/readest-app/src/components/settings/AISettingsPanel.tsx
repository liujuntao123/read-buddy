'use client';

import { useEffect, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { IconButton } from '@astryxdesign/core/IconButton';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { Selector } from '@astryxdesign/core/Selector';
import { TextInput } from '@astryxdesign/core/TextInput';
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

const PROVIDER_OPTIONS: Array<{ value: AIProvider; label: string }> = [
  { value: 'openai-compatible', label: 'OpenAI 兼容接口 (通用)' },
  { value: 'deepseek', label: 'DeepSeek 官方 API' },
  { value: 'claude', label: 'Claude（OpenAI 兼容代理）' },
  { value: 'ollama', label: 'Ollama（本地运行）' },
];

const TOAST_AUTO_DISMISS_MS = 3_000;

interface AISettingsPanelProps {
  open: boolean;
  onClose: () => void;
}

/**
 * AI Provider 配置中心 (design doc 4.1 / ADR 0008): OpenAI-compatible
 * endpoint + credentials + turn quota, persisted as plaintext in IndexedDB
 * and masked in the UI. Rendered as a modal dialog over the sidebar.
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
  const [saving, setSaving] = useState(false);

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
    setSaving(true);
    try {
      const saveErrors = await save(draft);
      setErrors(saveErrors);
      if (Object.keys(saveErrors).length === 0) {
        window.setTimeout(() => {
          onClose();
        }, 1200);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    try {
      await testConnection(draft);
    } finally {
      setTesting(false);
    }
  };

  return (
    <Dialog
      isOpen
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      // 'info' purpose: clicking the blank backdrop (or Escape) dismisses the
      // dialog — drafts are cheap to re-enter and users expect click-away.
      purpose="info"
      width={480}
      padding={0}
    >
      <VStack data-testid="ai-settings-panel" gap={4} padding={4}>
        <DialogHeader title="AI Provider 设置" onOpenChange={(next) => !next && onClose()} />

        <VStack gap={3}>
          <Selector
            label="服务提供商 (Provider)"
            data-testid="provider-select"
            options={PROVIDER_OPTIONS}
            value={draft.provider}
            onChange={(value) => changeProvider(value as AIProvider)}
            status={errors.provider ? { type: 'error', message: errors.provider } : undefined}
          />

          <TextInput
            label="API Base URL"
            data-testid="base-url-input"
            placeholder="https://api.example.com/v1"
            value={draft.baseUrl}
            onChange={(baseUrl) => update('baseUrl', baseUrl)}
            status={errors.baseUrl ? { type: 'error', message: errors.baseUrl } : undefined}
          />

          <TextInput
            label="Model ID"
            data-testid="model-input"
            placeholder="deepseek-chat / gpt-4o-mini"
            value={draft.model}
            onChange={(model) => update('model', model)}
            status={errors.model ? { type: 'error', message: errors.model } : undefined}
          />

          <VStack gap={1}>
            <HStack gap={1} vAlign="end">
              <VStack style={{ flex: 1, minWidth: 0 }}>
                <TextInput
                  label={draft.provider === 'ollama' ? 'API Key（本地模型可留空）' : 'API Key'}
                  data-testid="api-key-input"
                  type={showKey ? 'text' : 'password'}
                  placeholder="sk-..."
                  autoComplete="off"
                  value={draft.apiKey}
                  onChange={(apiKey) => update('apiKey', apiKey)}
                  status={errors.apiKey ? { type: 'error', message: errors.apiKey } : undefined}
                />
              </VStack>
              <IconButton
                label={showKey ? '隐藏 API Key' : '显示 API Key'}
                variant="ghost"
                size="sm"
                icon={showKey ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />}
                onClick={() => setShowKey((visible) => !visible)}
              />
            </HStack>
          </VStack>

          <NumberInput
            label={`每话题轮数配额（${MIN_TURNS_PER_TOPIC} ~ ${MAX_TURNS_PER_TOPIC} 轮）`}
            data-testid="max-turns-input"
            min={MIN_TURNS_PER_TOPIC}
            max={MAX_TURNS_PER_TOPIC}
            step={1}
            isIntegerOnly
            value={Number.isInteger(draft.maxTurnsPerTopic) ? draft.maxTurnsPerTopic : null}
            onChange={(maxTurnsPerTopic) => update('maxTurnsPerTopic', maxTurnsPerTopic)}
            status={errors.maxTurnsPerTopic ? { type: 'error', message: errors.maxTurnsPerTopic } : undefined}
          />
        </VStack>

        {/* Action buttons */}
        <HStack justify="end" gap={2} style={{ borderTop: '1px solid var(--color-border)', paddingTop: 'var(--spacing-3)' }}>
          <Button label="取消" variant="ghost" size="sm" onClick={onClose} />
          <Button
            label={testing ? '测试中…' : '测试连接'}
            variant="secondary"
            size="sm"
            isDisabled={testing || saving}
            onClick={() => void handleTestConnection()}
          />
          <Button
            label={saving ? '保存中…' : '保存'}
            variant="primary"
            size="sm"
            isDisabled={saving}
            onClick={() => void handleSave()}
          />
        </HStack>

        {/* Toast */}
        {toast && (
          <Banner
            data-testid="ai-settings-toast"
            data-tone={toast.type}
            status={toast.type === 'success' ? 'success' : 'error'}
            container="card"
            collapsible={false}
            title={toast.text}
            isDismissable
            dismissLabel="关闭提示"
            onDismiss={clearToast}
          />
        )}
      </VStack>
    </Dialog>
  );
}

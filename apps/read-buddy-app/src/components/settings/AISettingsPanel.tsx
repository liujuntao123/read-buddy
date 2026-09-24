'use client';

import { useEffect, useState } from 'react';
import { Download, Eye, EyeOff } from 'lucide-react';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { IconButton } from '@astryxdesign/core/IconButton';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { Selector } from '@astryxdesign/core/Selector';
import { TextInput } from '@astryxdesign/core/TextInput';
import { useAISettingsStore } from '@/store/aiSettingsStore';
import { normalizeBaseUrl } from '@/services/ai/modelsEndpoint';
import { MAX_TURNS_PER_TOPIC, MIN_TURNS_PER_TOPIC, type AIProvider, type AISettings } from '@/types/ai';
import type { AISettingsErrors } from '@/services/ai/validation';

/** Base URL presets applied when the provider changes (docs/architecture.md). */
const PROVIDER_BASE_URL_PRESETS: Record<AIProvider, string> = {
  'openai-compatible': 'https://api.openai.com/v1',
  deepseek: 'https://api.deepseek.com/v1',
};

const PROVIDER_OPTIONS: Array<{ value: AIProvider; label: string }> = [
  { value: 'openai-compatible', label: 'OpenAI 兼容接口 (通用)' },
  { value: 'deepseek', label: 'DeepSeek 官方 API' },
];

/** Above this many models the pulled list gets a search box. */
const MODEL_SEARCH_THRESHOLD = 8;

const TOAST_AUTO_DISMISS_MS = 3_000;

interface AISettingsPanelProps {
  open: boolean;
  onClose: () => void;
}

/**
 * AI Provider 配置中心 (ADR 0008): OpenAI-compatible
 * endpoint + credentials + turn quota, persisted as plaintext in IndexedDB
 * and masked in the UI. Rendered as a modal dialog over the sidebar.
 */
export default function AISettingsPanel({ open, onClose }: AISettingsPanelProps) {
  const settings = useAISettingsStore((s) => s.settings);
  const save = useAISettingsStore((s) => s.save);
  const testConnection = useAISettingsStore((s) => s.testConnection);
  const loadModels = useAISettingsStore((s) => s.loadModels);
  const availableModels = useAISettingsStore((s) => s.availableModels);
  const toast = useAISettingsStore((s) => s.toast);
  const clearToast = useAISettingsStore((s) => s.clearToast);

  // Mounted only while open, so the draft seeds from the persisted settings.
  const [draft, setDraft] = useState<AISettings>(settings);
  const [errors, setErrors] = useState<AISettingsErrors>({});
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [pulling, setPulling] = useState(false);
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

  const handlePullModels = async () => {
    setPulling(true);
    try {
      await loadModels(draft);
    } finally {
      setPulling(false);
    }
  };

  // A pulled list belongs to the endpoint it came from, so editing the Base URL
  // hides it until the next pull instead of offering another service's models.
  const pulledModels =
    availableModels && availableModels.baseUrl === normalizeBaseUrl(draft.baseUrl)
      ? availableModels.models
      : [];

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
        <DialogHeader title="AI 设置" onOpenChange={(next) => !next && onClose()} />

        <VStack gap={3}>
          <Selector
            label="服务提供商"
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

          <VStack gap={1}>
            <HStack gap={2} vAlign="end">
              <VStack style={{ flex: 1, minWidth: 0 }}>
                <TextInput
                  label="API Key"
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
                size="md"
                icon={showKey ? <EyeOff size={15} aria-hidden /> : <Eye size={15} aria-hidden />}
                onClick={() => setShowKey((visible) => !visible)}
              />
            </HStack>
          </VStack>

          {/* Model ID is a free text field first: gateways serve models their
              own /models list omits. The icon button pulls the picker's list.
              Both row buttons are `size="md"` — the same 32px as the inputs
              beside them — so an icon button and its field share one baseline
              instead of the 28px/32px mismatch a `sm` button produced. */}
          <VStack gap={1}>
            <HStack gap={2} vAlign="end">
              <VStack style={{ flex: 1, minWidth: 0 }}>
                <TextInput
                  label="Model ID"
                  data-testid="model-input"
                  placeholder="deepseek-chat / gpt-4o-mini"
                  value={draft.model}
                  onChange={(model) => update('model', model)}
                  status={errors.model ? { type: 'error', message: errors.model } : undefined}
                />
              </VStack>
              <IconButton
                label="拉取模型列表"
                data-testid="fetch-models"
                variant="secondary"
                size="md"
                icon={<Download size={15} aria-hidden />}
                tooltip="从上方 Base URL 拉取可用模型列表"
                isLoading={pulling}
                isDisabled={testing || saving}
                onClick={() => void handlePullModels()}
              />
            </HStack>

            {pulledModels.length > 0 && (
              <Selector
                label="可用模型"
                data-testid="model-select"
                description="从服务端实时拉取；选择后自动填入 Model ID，也可直接手动输入。"
                options={pulledModels}
                value={pulledModels.includes(draft.model) ? draft.model : ''}
                placeholder={`选择模型（共 ${pulledModels.length} 个）`}
                hasSearch={pulledModels.length > MODEL_SEARCH_THRESHOLD}
                searchPlaceholder="搜索模型…"
                onChange={(model) => update('model', model)}
              />
            )}
          </VStack>

          <NumberInput
            label={`单话题最大对话轮数（${MIN_TURNS_PER_TOPIC} ~ ${MAX_TURNS_PER_TOPIC} 轮）`}
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

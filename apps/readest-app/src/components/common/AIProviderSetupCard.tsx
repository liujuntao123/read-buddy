'use client';

/**
 * 未配置模型的引导卡 (ticket 14 item 3): what the companion does, and the one
 * button that makes it work.
 *
 * Both panels used to answer the unconfigured case the same way — by failing:
 * 总结 said 「请先在侧栏右上角 ⚙ 完成 AI 设置」 after the click and 伴读 said
 * nothing until the first question errored out. The reader had to *guess* that
 * the companion needs a model at all, then find the ⚙ themselves.
 *
 * So the card states the capability in one sentence and offers the settings
 * panel as the action. It deliberately does not call a model (ADR 0004): it is
 * a signpost, not a trigger.
 */
import { KeyRound, Sparkles } from 'lucide-react';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import { useAISidebarStore } from '@/store/aiSidebarStore';

/** The default one-sentence answer to 「这一栏能做什么」. */
export const AI_SETUP_DESCRIPTION =
  '配置模型后，伴读可以总结当前节点、围绕本书回答问题，并在全书中检索线索。';

export interface AIProviderSetupCardProps {
  /** Per-tab sentence naming what that tab will do once configured. */
  description?: string;
  testId?: string;
}

export default function AIProviderSetupCard({
  description = AI_SETUP_DESCRIPTION,
  testId = 'ai-provider-setup',
}: AIProviderSetupCardProps) {
  const openSettings = useAISidebarStore((s) => s.openSettings);

  return (
    <Card data-testid={testId} variant="blue" padding={3}>
      <VStack gap={2}>
        <HStack gap={2} vAlign="center">
          <Sparkles size={14} aria-hidden />
          <Text weight="medium">先配置一个 AI 模型</Text>
        </HStack>
        <Text type="supporting" color="secondary" style={{ lineHeight: 1.6 }}>
          {description}
        </Text>
        <HStack>
          <Button
            label="配置 AI 模型"
            variant="primary"
            size="sm"
            icon={<KeyRound size={14} aria-hidden />}
            data-testid={`${testId}-button`}
            onClick={openSettings}
          />
        </HStack>
      </VStack>
    </Card>
  );
}

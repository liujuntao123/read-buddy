'use client';

/**
 * 复制按钮 (ticket 14 item 5): clipboard write + 「已复制」 feedback, one component.
 *
 * Three copy actions now share one behaviour (单条回答 / 整段对话 / 章节总结):
 * the button shape differs (icon-only in a message footer, labelled in the
 * quota card), but the clipboard call, the feedback window and the rule that a
 * failed copy never claims success must not differ. That rule lives in
 * `services/common/clipboard`; this component owns the 1.5s feedback state.
 *
 * Text is read through a getter, not a value: the transcript is assembled at
 * click time, and a long summary should not be recomputed on every render.
 */
import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from '@astryxdesign/core/Button';
import { IconButton } from '@astryxdesign/core/IconButton';
import { HStack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import { copyToClipboard } from '@/services/common/clipboard';

/** How long 「已复制」 stays up after a successful copy. */
export const COPY_FEEDBACK_MS = 1_500;

export interface CopyButtonProps {
  /** Text to copy, resolved on click. */
  getText: () => string;
  /** Accessible name; also the visible label unless `isIconOnly`. */
  label: string;
  /** Icon-only shape (message footer, scope header) vs labelled button. */
  isIconOnly?: boolean;
  /**
   * Show a visible 「已复制」 beside an icon-only button. Off by default: in a
   * tight action row (the summary scope header) an extra word would shift the
   * layout, and the icon already swaps to a check.
   */
  showCopiedText?: boolean;
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md';
  /** Hover text; falls back to `label`. */
  tooltip?: string;
  isDisabled?: boolean;
  className?: string;
  testId?: string;
}

export default function CopyButton({
  getText,
  label,
  isIconOnly = true,
  showCopiedText = false,
  variant = 'ghost',
  size = 'sm',
  tooltip,
  isDisabled = false,
  className,
  testId,
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);

  // A message can unmount (topic switch) while the feedback window is open.
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const copy = async () => {
    const ok = await copyToClipboard(getText());
    setCopied(ok);
    if (!ok) return;
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
  };

  const feedback = copied ? '已复制' : label;
  const icon = copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />;

  return (
    <HStack
      gap={1}
      vAlign="center"
      className={className}
      data-copied={copied}
      data-testid={testId ? `${testId}-feedback` : undefined}
    >
      {isIconOnly ? (
        <IconButton
          label={feedback}
          variant={variant}
          size={size}
          icon={icon}
          tooltip={copied ? '已复制' : (tooltip ?? label)}
          isDisabled={isDisabled}
          data-testid={testId}
          onClick={() => void copy()}
        />
      ) : (
        <Button
          label={label}
          variant={variant}
          size={size}
          icon={icon}
          tooltip={tooltip}
          isDisabled={isDisabled}
          data-testid={testId}
          onClick={() => void copy()}
        >
          {feedback}
        </Button>
      )}
      {isIconOnly && showCopiedText && copied && (
        <Text type="supporting" color="secondary" style={{ whiteSpace: 'nowrap' }}>
          已复制
        </Text>
      )}
    </HStack>
  );
}

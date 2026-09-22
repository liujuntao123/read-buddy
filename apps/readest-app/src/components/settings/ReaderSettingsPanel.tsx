'use client';

import { RotateCcw } from 'lucide-react';
import { Button } from '@astryxdesign/core/Button';
import { Divider } from '@astryxdesign/core/Divider';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { Selector } from '@astryxdesign/core/Selector';
import { Slider } from '@astryxdesign/core/Slider';
import { Text } from '@astryxdesign/core/Text';
import {
  READER_FONT_OPTIONS,
  useReaderSettingsStore,
} from '@/store/readerSettingsStore';

const FONT_OPTIONS = READER_FONT_OPTIONS.map((option) => ({
  value: option.key,
  label: option.label,
}));

/**
 * Reader typography/layout panel shown inside the settings popover. Reads and
 * writes the shared reader settings store; changes apply to the engine live.
 */
export default function ReaderSettingsPanel() {
  const typography = useReaderSettingsStore((s) => s.typography);
  const layoutSettings = useReaderSettingsStore((s) => s.layout);
  const setTypographySetting = useReaderSettingsStore((s) => s.setTypography);
  const adjustFontSize = useReaderSettingsStore((s) => s.adjustFontSize);
  const setLayoutSetting = useReaderSettingsStore((s) => s.setLayoutSettings);
  const resetSettings = useReaderSettingsStore((s) => s.reset);

  return (
    <VStack
      data-testid="reader-settings-panel"
      gap={3}
      padding={1}
      style={{ maxHeight: 'min(500px, 80vh)', overflowY: 'auto' }}
    >
      {/* Font size */}
      <VStack gap={1}>
        <HStack justify="between" vAlign="center">
          <Text type="label" color="secondary">字号</Text>
          <HStack gap={1} vAlign="center">
            <Button
              label="减小字号"
              variant="ghost"
              size="sm"
              isIconOnly
              data-testid="font-size-decrease"
              isDisabled={typography.fontSize <= 12}
              onClick={() => adjustFontSize(-1)}
            >
              −
            </Button>
            <Text
              type="code"
              data-testid="font-size-value"
              hasTabularNumbers
            >
              {typography.fontSize}px
            </Text>
            <Button
              label="增大字号"
              variant="ghost"
              size="sm"
              isIconOnly
              data-testid="font-size-increase"
              isDisabled={typography.fontSize >= 28}
              onClick={() => adjustFontSize(1)}
            >
              +
            </Button>
          </HStack>
        </HStack>
        <Slider
          label="字号大小"
          isLabelHidden
          min={12}
          max={28}
          step={1}
          value={typography.fontSize}
          onChange={(fontSize: number) => setTypographySetting({ fontSize })}
          valueDisplay="none"
        />
      </VStack>

      {/* Font family */}
      <Selector
        label="字体"
        data-testid="font-family-select"
        options={FONT_OPTIONS}
        value={typography.fontFamily}
        onChange={(fontFamily) => setTypographySetting({ fontFamily })}
      />

      {/* Line height */}
      <Slider
        label="行间距"
        min={1.2}
        max={2.4}
        step={0.1}
        value={typography.lineHeight}
        onChange={(lineHeight: number) => setTypographySetting({ lineHeight })}
        formatValue={(v) => v.toFixed(1)}
      />

      {/* Paragraph spacing */}
      <Slider
        label="段间距"
        min={0}
        max={1.5}
        step={0.1}
        value={typography.paragraphSpacing}
        onChange={(paragraphSpacing: number) => setTypographySetting({ paragraphSpacing })}
        formatValue={(v) => `${v.toFixed(1)}em`}
      />

      <Divider />

      {/* Content width (single-page column width) */}
      <Slider
        label="内容宽度"
        min={480}
        max={1200}
        step={20}
        value={layoutSettings.contentWidth}
        onChange={(contentWidth: number) => setLayoutSetting({ contentWidth })}
        formatValue={(v) => `${v}px`}
      />

      {/* Page margin */}
      <Slider
        label="页边距"
        min={24}
        max={96}
        step={4}
        value={layoutSettings.pageMargin}
        onChange={(pageMargin: number) => setLayoutSetting({ pageMargin })}
        formatValue={(v) => `${v}px`}
      />

      {/* Column gap */}
      <Slider
        label="页面间距"
        min={4}
        max={15}
        step={1}
        value={layoutSettings.columnGap}
        onChange={(columnGap: number) => setLayoutSetting({ columnGap })}
        formatValue={(v) => `${v}%`}
      />

      <HStack justify="between" vAlign="center">
        <Text type="supporting" color="disabled">设置自动保存</Text>
        <Button
          label="恢复默认"
          variant="ghost"
          size="sm"
          data-testid="reader-settings-reset"
          icon={<RotateCcw size={14} aria-hidden />}
          onClick={() => resetSettings()}
        />
      </HStack>
    </VStack>
  );
}

'use client';

import { Fragment } from 'react';
import { HStack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';

/**
 * 阅读视窗怎么往前走：双页是翻页，单页连续滚动 / TXT 是滚动。提示里的动词跟着它走
 * ——在单页模式里说「方向键 翻页」是错的。
 */
export type ReaderTurnMode = 'page' | 'scroll';

interface Shortcut {
  /** Stable name for the key cap (test ids, keys of the list). */
  id: string;
  /** The key (or key chord) as the reader's keyboard shows it. */
  keys: string;
  /** What pressing it does, in this reading mode. */
  label: string;
}

export interface ReaderShortcutsHintProps {
  /** How the mounted viewport moves forward (see `ReaderTurnMode`). */
  mode: ReaderTurnMode;
}

/**
 * 阅读区底边的快捷键提示：一行小字 + 键帽。
 *
 * 说的是**按键做什么**，不是一份按键表：方向键与空格在双页翻页、在单页/TXT 滚动，
 * 所以动词必须跟着阅读模式（`mode`）走；Esc 收掉选区/划线工具条；Ctrl + / 开合伴读
 * 侧栏（绑定在 HeaderBar 的宿主 window 与章节 iframe 文档两处——iframe 的键盘事件
 * 不会冒泡进宿主，见 FoliatePane）。这三件事都不写在界面上——读者要么猜，要么永远
 * 不知道，这行字就是那个「一眼看到」的地方。
 *
 * 静、稳、不抢视线：小字、次级色、键帽只有一圈描边（globals.css 的
 * `.reader-shortcuts`）。它只在阅读视图里挂载（Workspace），书架不显示；进度条在
 * 视窗顶部，这一行独占底边——dock 的底部偏移按它让开。
 */
export default function ReaderShortcutsHint({ mode }: ReaderShortcutsHintProps) {
  const pageTurn = mode === 'page';
  const shortcuts: Shortcut[] = [
    { id: 'turn', keys: '← →', label: pageTurn ? '翻页' : '滚动' },
    { id: 'forward', keys: '空格', label: pageTurn ? '下翻' : '向下滚动' },
    { id: 'escape', keys: 'Esc', label: '关闭工具条' },
    { id: 'companion', keys: 'Ctrl + /', label: '伴读侧栏' },
  ];

  return (
    <HStack
      className="reader-shortcuts"
      data-testid="reader-shortcuts"
      vAlign="center"
      hAlign="center"
      gap={2}
      paddingInline={4}
    >
      {shortcuts.map(({ id, keys, label }, index) => (
        <Fragment key={id}>
          {index > 0 && (
            <Text type="supporting" size="2xs" color="secondary" aria-hidden>
              ·
            </Text>
          )}
          <HStack gap={1} vAlign="center">
            <Text
              type="supporting"
              size="2xs"
              color="primary"
              className="reader-shortcuts-key"
              data-testid={`shortcut-keys-${id}`}
            >
              {keys}
            </Text>
            <Text type="supporting" size="2xs" color="secondary" data-testid={`shortcut-label-${id}`}>
              {label}
            </Text>
          </HStack>
        </Fragment>
      ))}
    </HStack>
  );
}

'use client';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { HStack, StackItem } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import { getAgentBookContext } from '@/services/agent/agentContext';
import { recordReadingPosition } from '@/services/reader/readingPosition';
import {
  formatNodePosition,
  nodePositionIn,
  virtualSectionPosition,
  type NodePosition,
} from '@/services/reader/readingProgress';
import { useBookIndexStore } from '@/store/bookIndexStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useReaderStore } from '@/store/readerStore';
import { useSegmentationStore } from '@/store/segmentationStore';

/**
 * 阅读进度条（进度轨 + 百分比 + 「第 3 / 12 节」），可点击 / 拖动 / 方向键跳转。
 *
 * 位置在阅读视窗**顶部**：一条 28px 的静默细条，与底部的快捷键提示分居正文两侧
 * （两条细条因此互不相邻，也就不需要「之间」的分割线）。阅读区为它让出这段高度，
 * 所以它从不压在正文上。
 *
 * 两条取数路径，与书架和 dock 一致：
 * - **引擎书籍**：进度是引擎 `relocate` 给的 `fraction`（全书百分比），跳转走
 *   `goToFraction`——引擎自己知道怎么落到那个位置（CFI 由它算）；
 * - **TXT / 分段书籍**：没有引擎，进度由 `spineIndex / spineCount` 推出，再用段内
 *   滚动比例细化（`readerStore.sectionFraction`，ReaderPane 上报）；跳转就是
 *   `recordReadingPosition` 到目标段，和 dock 的目录点击走同一条路。
 *
 * 层词（章 / 节 / 段）只从节点模型来：百分比旁边那句位置由 `readingProgress`
 * 翻译，本组件不认识「章」也「节」。
 */

/**
 * 键盘步进：方向键 1%，PageUp / PageDown 10%，Home / End 到头。细到能停在想要的
 * 位置，又不必按住不放——进度条的键盘操作是「微调」。
 */
const KEY_STEP = 0.01;
/** 一页的量级：整本书的 1/10 是「换个大位置」而不是「微调」。 */
const KEY_PAGE_STEP = 0.1;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
/** 键盘步进后的比例按 1% 量化：别让 0.4 + 0.01 = 0.41000000000000003 这类浮点
    噪声流进引擎和 Reading Position。 */
const quantize = (value: number): number => Math.round(clamp01(value) * 100) / 100;
const percentOf = (fraction: number): number => Math.round(clamp01(fraction) * 100);

export default function ReaderProgressBar() {
  const bookHash = useReaderStore((s) => s.bookHash);
  const spineIndex = useReaderStore((s) => s.spineIndex);
  const spineCount = useReaderStore((s) => s.spineCount);
  const anchor = useReaderStore((s) => s.anchor);
  const sectionFraction = useReaderStore((s) => s.sectionFraction);
  const currentEngine = useLibraryStore((s) =>
    s.currentHash ? s.engines[s.currentHash] ?? null : null,
  );
  const segmentation = useSegmentationStore((s) => s.segmentation);
  /**
   * 只当触发器用：节点模型是从注册表（`getAgentBookContext`）读的**非响应式**
   * 数据，而索引是在打开书籍之后异步落地的——不知道它到了，位置那句就会一直
   * 停在「还没索引」的答案上。索引一落地 `shape` 就有节点，于是重算一次。
   */
  const modelReady = useBookIndexStore((s) => s.bookHash === bookHash && s.shape.total > 0);

  /** 引擎报的全文进度；TXT 恒为 null（那条路走 spineIndex + 段内滚动）。 */
  const [engineFraction, setEngineFraction] = useState<number | null>(null);
  /** 指针当前落在轨道的哪个比例上（悬停 = 预览目标，拖动 = 拖动目标）。 */
  const [pointerFraction, setPointerFraction] = useState<number | null>(null);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const trackRef = useRef<HTMLDivElement | null>(null);
  /** 拖动中的事实来源是 ref：松手那一刻的状态更新还没落地也要能收尾。 */
  const scrubbingRef = useRef(false);

  // 引擎的 relocate 是进度的唯一来源（打开时先取当前位置，之后跟着翻页走）。
  useEffect(() => {
    if (!currentEngine) {
      setEngineFraction(null);
      return;
    }
    const current = currentEngine.currentLocation();
    setEngineFraction(current ? current.fraction : null);
    return currentEngine.onRelocate((location) => setEngineFraction(location.fraction));
  }, [currentEngine]);

  const committedFraction = currentEngine
    ? clamp01(engineFraction ?? 0)
    : spineCount > 0
      ? clamp01((spineIndex + clamp01(sectionFraction)) / spineCount)
      : 0;
  // 拖动时读数跟着手指走（松开前不落盘），松手后回到真实进度。
  const shownFraction = isScrubbing && pointerFraction !== null ? pointerFraction : committedFraction;
  const shownPercent = percentOf(shownFraction);

  const position = useMemo<NodePosition | null>(() => {
    const context = bookHash ? getAgentBookContext(bookHash) : undefined;
    if (context && context.nodes.length > 0) {
      const node = context.resolveNodeAt(spineIndex, anchor);
      if (node) {
        const found = nodePositionIn(context.nodes, node);
        if (found) return found;
      }
    }
    if (segmentation && segmentation.bookHash === bookHash) {
      return virtualSectionPosition(segmentation.virtualSections, spineIndex);
    }
    return null;
  }, [bookHash, spineIndex, anchor, segmentation, modelReady]);

  const positionLabel = position ? formatNodePosition(position) : undefined;
  // 悬停时标题说的是**目标**（点下去会到哪），不是当前进度。
  const title = `跳转到 ${percentOf(pointerFraction ?? committedFraction)}%`;

  /** 指针横坐标 → 比例。轨道矩形拿不到（未布局）时按起点算。 */
  const fractionAt = (event: PointerEvent<HTMLDivElement>): number => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    return clamp01((event.clientX - rect.left) / rect.width);
  };

  /** 跳转到某个比例——引擎走 goToFraction，TXT 走 Reading Position。 */
  const seek = (fraction: number) => {
    const target = clamp01(fraction);
    if (currentEngine) {
      setEngineFraction(target);
      void currentEngine.goToFraction(target);
      return;
    }
    if (spineCount <= 0) return;
    // 目标段：整本书按段等分，落在哪一段就跳哪一段（段内滚动不追——一次点击
    // 说清「到哪一节」，和目录点行是同一个粒度）。
    const spine = Math.min(spineCount - 1, Math.max(0, Math.floor(target * spineCount)));
    const title = segmentation?.virtualSections?.[spine]?.title;
    recordReadingPosition(
      { bookHash: useReaderStore.getState().bookHash, spineIndex: spine },
      title ? { titleFallback: title } : {},
    );
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    // 指针捕获：拖出轨道（甚至拖出窗口）也要继续跟着，松手才算数。
    trackRef.current?.setPointerCapture?.(event.pointerId);
    scrubbingRef.current = true;
    setIsScrubbing(true);
    setPointerFraction(fractionAt(event));
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    setPointerFraction(fractionAt(event));
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!scrubbingRef.current) return;
    scrubbingRef.current = false;
    trackRef.current?.releasePointerCapture?.(event.pointerId);
    setIsScrubbing(false);
    setPointerFraction(null);
    seek(fractionAt(event));
  };
  const onPointerLeave = () => {
    if (!scrubbingRef.current) setPointerFraction(null);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    let delta: number;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        delta = KEY_STEP;
        break;
      case 'ArrowLeft':
      case 'ArrowDown':
        delta = -KEY_STEP;
        break;
      case 'PageUp':
        delta = KEY_PAGE_STEP;
        break;
      case 'PageDown':
        delta = -KEY_PAGE_STEP;
        break;
      case 'Home':
        delta = -1;
        break;
      case 'End':
        delta = 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    // 方向键在这里是「微调进度」，不是翻页：阅读视窗把同一批按键绑成了翻页
    // （window 上的 keydown），不拦下来，一次 → 会既挪进度又翻一页。
    event.stopPropagation();
    seek(quantize(committedFraction + delta));
  };

  return (
    <HStack
      className="reader-progress"
      data-testid="reader-progress-bar"
      vAlign="center"
      gap={3}
      paddingInline={4}
    >
      <StackItem size="fill">
        <div
          ref={trackRef}
          className="reader-progress-track"
          data-testid="reader-progress-track"
          role="slider"
          tabIndex={0}
          aria-label="阅读进度"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={shownPercent}
          aria-valuetext={positionLabel ? `${shownPercent}%，${positionLabel}` : `${shownPercent}%`}
          title={title}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerLeave}
          onKeyDown={onKeyDown}
        >
          <div className="reader-progress-rail" aria-hidden="true">
            <div
              className="reader-progress-fill"
              data-testid="reader-progress-fill"
              style={{ inlineSize: `${shownPercent}%` }}
            />
          </div>
        </div>
      </StackItem>
      <Text
        type="supporting"
        color="secondary"
        className="reader-progress-percent"
        data-testid="reader-progress-percent"
      >
        {`${shownPercent}%`}
      </Text>
      {positionLabel && (
        <Text
          type="supporting"
          color="secondary"
          className="reader-progress-position"
          data-testid="reader-progress-position"
        >
          {positionLabel}
        </Text>
      )}
    </HStack>
  );
}

'use client';

import { useState } from 'react';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import type { BookFormat } from '@/types/library';

export interface BookCoverProps {
  cover?: string;
  title: string;
  author?: string;
  format?: BookFormat;
  progressText?: string;
  /**
   * How far through the book the reader is (0..1), when a fraction is derivable.
   * The cover paints it as a thin bar of its own along the bottom edge — every
   * surface that shows a cover gets the same indicator, and none of them has to
   * re-derive it from `progressText`.
   */
  progressFraction?: number;
  className?: string;
  size?: 'normal' | 'small' | 'mini';
}

/**
 * Editorial cover palettes drawn from the theme's categorical data tokens —
 * every colour adapts to light/dark and no raw hex lives in the component.
 */
const HUES = ['blue', 'teal', 'orange', 'purple', 'yellow', 'pink'] as const;

type Hue = (typeof HUES)[number];

/** Deterministic per-title hue so a book always wears the same colour. */
function pickHue(text: string): Hue {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) | 0;
  }
  return HUES[Math.abs(hash) % HUES.length]!;
}

const SIZE_STYLE: Record<NonNullable<BookCoverProps['size']>, React.CSSProperties> = {
  mini: { width: 40, height: 56 },
  small: { width: 56, height: 80 },
  normal: { aspectRatio: '3 / 4', width: '100%' },
};

/**
 * Book cover component: the real cover image when the book carries one, else a
 * clean typographic cover in the book's deterministic palette hue.
 */
export default function BookCover({
  cover,
  title,
  author,
  progressText,
  progressFraction,
  className = '',
  size = 'normal',
}: BookCoverProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const hue = pickHue(title);
  const showImage = Boolean(cover && !imgFailed);

  return (
    <div
      data-testid="book-cover"
      className={`skeuo-book-entity ${className}`}
      style={{
        position: 'relative',
        userSelect: 'none',
        overflow: 'hidden',
        ...SIZE_STYLE[size],
        ...(showImage
          ? {}
          : {
              background: `var(--color-background-${hue})`,
            }),
      }}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={cover}
          alt={`《${title}》封面`}
          data-testid="book-cover-image"
          style={{ height: '100%', width: '100%', objectFit: 'cover' }}
          loading="lazy"
          onError={() => setImgFailed(true)}
        />
      ) : (
        /* Typographic cover: modern, minimalist aesthetic */
        <div
          data-testid="book-cover-typographic"
          style={{
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            height: '100%',
            width: '100%',
            padding: size === 'mini' ? '4px' : 'var(--spacing-4) var(--spacing-3) var(--spacing-3) var(--spacing-5)',
            background: `linear-gradient(145deg, rgba(255, 255, 255, 0.12) 0%, transparent 80%), var(--color-background-${hue})`,
          }}
        >
          {/* Center title & author */}
          <VStack gap={1} justify="center" style={{ marginBlock: 'auto', paddingBlock: 'var(--spacing-1)', zIndex: 12 }}>
            <Text
              weight="bold"
              maxLines={3}
              style={{
                color: `var(--color-text-${hue})`,
                fontSize: size === 'mini' ? '8px' : size === 'small' ? '11px' : '15px',
                lineHeight: 1.35,
                letterSpacing: '0.02em',
              }}
            >
              《{title}》
            </Text>
            <div
              aria-hidden="true"
              style={{
                width: size === 'mini' ? 12 : 20,
                height: 2,
                marginBlock: '2px',
                borderRadius: 'var(--radius-full)',
                background: `var(--color-border-${hue})`,
                opacity: 0.8,
              }}
            />
            {author && (
              <Text
                type="supporting"
                maxLines={1}
                style={{
                  color: `var(--color-icon-${hue})`,
                  fontSize: size === 'mini' ? '7px' : size === 'small' ? '9px' : '11px',
                  fontWeight: 500,
                  opacity: 0.9,
                }}
              >
                著 · {author}
              </Text>
            )}
          </VStack>

          {/* Bottom brand imprint */}
          <HStack justify="between" style={{ zIndex: 12, paddingInlineStart: size === 'mini' ? 0 : 'var(--spacing-1)' }}>
            <Text
              type="code"
              size="4xs"
              style={{
                letterSpacing: '0.18em',
                opacity: 0.5,
                color: `var(--color-text-${hue})`,
                fontWeight: 600,
              }}
            >
              READEST+
            </Text>
          </HStack>
        </div>
      )}

      {/* Optional progress bar along the bottom edge. A hairline track under the
          cover's own radius: reading progress is worth a glance, not a badge. */}
      {typeof progressFraction === 'number' && (
        <div data-testid="book-cover-progress-bar" className="shelf-progress-track">
          <div
            data-testid="book-cover-progress-fill"
            className="shelf-progress-fill"
            style={{
              width: `${Math.round(Math.min(1, Math.max(0, progressFraction)) * 100)}%`,
            }}
          />
        </div>
      )}

      {/* Optional progress overlay on cover */}
      {progressText && (        <HStack
          data-testid="book-cover-progress"
          justify="center"
          style={{
            position: 'absolute',
            insetInline: 'var(--spacing-2)',
            bottom: 'var(--spacing-2)',
            zIndex: 20,
            borderRadius: 'var(--radius-full)',
            background: 'rgba(18, 14, 12, 0.75)',
            backdropFilter: 'blur(8px)',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            boxShadow: '0 2px 4px rgba(0, 0, 0, 0.2)',
            padding: '2px var(--spacing-2)',
          }}
        >
          <Text
            type="supporting"
            size="2xs"
            maxLines={1}
            weight="semibold"
            style={{ color: '#ffffff' }}
          >
            {progressText}
          </Text>
        </HStack>
      )}
    </div>
  );
}

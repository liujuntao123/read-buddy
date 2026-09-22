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
 * Editorial Book Cover component.
 * Displays the high-resolution cover image when available, or falls back to
 * a bespoke clothbound typographical cover with realistic book spine depth.
 */
export default function BookCover({
  cover,
  title,
  author,
  progressText,
  className = '',
  size = 'normal',
}: BookCoverProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const hue = pickHue(title);
  const showImage = Boolean(cover && !imgFailed);

  return (
    <div
      data-testid="book-cover"
      className={className}
      style={{
        position: 'relative',
        userSelect: 'none',
        overflow: 'hidden',
        borderRadius: 'var(--radius-element)',
        border: '1px solid var(--color-border)',
        boxShadow: 'var(--shadow-low)',
        ...SIZE_STYLE[size],
        ...(showImage
          ? {}
          : { background: `var(--color-background-${hue})` }),
      }}
    >
      {/* Physical book spine lighting simulation (left edge) */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          insetBlock: 0,
          insetInlineStart: 0,
          width: 10,
          zIndex: 10,
          pointerEvents: 'none',
          background: 'var(--color-overlay)',
          borderInlineEnd: '1px solid var(--color-border)',
        }}
      />

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
        /* Typographic cover fallback */
        <div
          data-testid="book-cover-typographic"
          style={{
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            height: '100%',
            width: '100%',
            padding: 'var(--spacing-3) var(--spacing-3) var(--spacing-3) var(--spacing-5)',
          }}
        >
          {/* Center title & author */}
          <VStack gap={1} justify="center" style={{ marginBlock: 'auto', paddingBlock: 'var(--spacing-1)' }}>
            <Text
              weight="bold"
              maxLines={3}
              style={{ color: `var(--color-text-${hue})` }}
            >
              《{title}》
            </Text>
            <div
              aria-hidden="true"
              style={{
                width: 20,
                height: 2,
                borderRadius: 'var(--radius-full)',
                background: `var(--color-border-${hue})`,
              }}
            />
            {author && (
              <Text
                type="supporting"
                maxLines={1}
                style={{ color: `var(--color-icon-${hue})` }}
              >
                著 · {author}
              </Text>
            )}
          </VStack>

          {/* Bottom imprint */}
          <HStack justify="between">
            <Text
              type="code"
              size="4xs"
              style={{ letterSpacing: '0.2em', opacity: 0.4, color: `var(--color-text-${hue})` }}
            >
              READEST+
            </Text>
          </HStack>
        </div>
      )}

      {/* Optional progress overlay on cover — a compact chip so it never
          competes with the cover art or the card overlay below. */}
      {progressText && (
        <HStack
          data-testid="book-cover-progress"
          justify="center"
          style={{
            position: 'absolute',
            insetInline: 'var(--spacing-2)',
            bottom: 'var(--spacing-1)',
            zIndex: 20,
            borderRadius: 'var(--radius-full)',
            background: 'var(--color-background-popover)',
            border: '1px solid var(--color-border)',
            padding: '0 var(--spacing-2)',
          }}
        >
          <Text type="supporting" size="2xs" maxLines={1} weight="medium">
            {progressText}
          </Text>
        </HStack>
      )}
    </div>
  );
}

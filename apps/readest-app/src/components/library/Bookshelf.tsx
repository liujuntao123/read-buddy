'use client';

/**
 * Bookshelf view: lists imported books with covers, search, sort, and view
 * modes. Book cards open on click (cover + info together); the delete button
 * is a sibling control that stops propagation.
 */
import { useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowDownUp,
  BookMarked,
  BookOpen,
  CalendarDays,
  HardDrive,
  History,
  LayoutGrid,
  List,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { Badge, type BadgeProps } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { ClickableCard } from '@astryxdesign/core/ClickableCard';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Grid } from '@astryxdesign/core/Grid';
import { IconButton } from '@astryxdesign/core/IconButton';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import type { LibraryBookMeta } from '@/services/library/bookLibrary';
import { useLibraryStore, type LibraryStoreHook } from '@/store/libraryStore';
import { useBookIndexStore } from '@/store/bookIndexStore';
import { formatProgress, type BookNodeShape } from '@/services/bookNodes';
import BookCover from './BookCover';

interface BookshelfProps {
  /** Injectable store seam; defaults to the app-wide singleton. */
  store?: LibraryStoreHook;
}

/** Format label + tinted category badge colour per book format. */
const FORMAT_BADGES: Record<string, { label: string; variant: BadgeProps['variant'] }> = {
  epub: { label: 'EPUB', variant: 'blue' },
  mobi: { label: 'MOBI', variant: 'yellow' },
  fb2: { label: 'FB2', variant: 'red' },
  cbz: { label: 'CBZ', variant: 'purple' },
  txt: { label: 'TXT', variant: 'green' },
};

const SORT_OPTIONS: Array<{ value: SortKey; label: string; icon: ReactNode }> = [
  { value: 'recent', label: '最近阅读', icon: <History size={14} aria-hidden /> },
  { value: 'imported', label: '添加时间', icon: <CalendarDays size={14} aria-hidden /> },
  { value: 'title', label: '书籍名称', icon: <BookMarked size={14} aria-hidden /> },
  { value: 'size', label: '文件大小', icon: <HardDrive size={14} aria-hidden /> },
];

type SortKey = 'recent' | 'imported' | 'title' | 'size';

const formatDate = (ts: number): string => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const formatSize = (bytes: number): string => {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

/**
 * Reading-progress line, honest about what the shelf actually knows.
 *
 * The shelf stores only an ordinal, and an ordinal is meaningless without a
 * node shape: "读至第 4 章" and "读至第 4 节" are different claims — only the node model may choose the word. A shape is
 * available only for the book the reader currently has indexed (the index
 * store holds exactly one book's shape), so:
 *   - shape known  → `formatProgress(shape, n)` picks the level word from the
 *     node model (最小节点: 有节就是节);
 *   - shape unknown → the neutral 「第 N 个节点」, never a guessed 章 / 节.
 */
const progressLabel = (book: LibraryBookMeta, shape?: BookNodeShape): string | undefined => {
  const ordinal = book.lastNodeIndex;
  if (typeof ordinal !== 'number' || ordinal <= 0) return undefined;
  return shape && shape.total > 0
    ? formatProgress(shape, ordinal + 1)
    : `读至第 ${ordinal + 1} 个节点`;
};

export default function Bookshelf({ store = useLibraryStore }: BookshelfProps) {
  const books = store((s) => s.books);
  const importing = store((s) => s.importing);
  const error = store((s) => s.error);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('recent');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  const pickFiles = () => inputRef.current?.click();

  const onInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = ''; // allow picking the same file again later
    if (files.length > 0) void store.getState().importFiles(files);
  };

  const openBook = (hash: string) => {
    void store.getState().open(hash);
  };

  const removeBook = (book: LibraryBookMeta) => {
    const ok =
      typeof window.confirm === 'function'
        ? window.confirm(`删除《${book.title}》？该书的总结与对话记录不会被清除。`)
        : true;
    if (ok) void store.getState().remove(book.hash);
  };

  const filteredBooks = useMemo(() => {
    let result = [...books];

    // Filter by query
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      result = result.filter(
        (b) =>
          b.title.toLowerCase().includes(q) ||
          (b.author && b.author.toLowerCase().includes(q)),
      );
    }

    // Sort
    result.sort((a, b) => {
      if (sortKey === 'recent') return b.updatedAt - a.updatedAt;
      if (sortKey === 'imported') return b.importedAt - a.importedAt;
      if (sortKey === 'title') return a.title.localeCompare(b.title, 'zh-CN');
      if (sortKey === 'size') return b.size - a.size;
      return 0;
    });

    return result;
  }, [books, searchQuery, sortKey]);

  const importButton = (testId: string) => (
    <Button
      label={importing ? '导入中…' : '导入书籍'}
      variant="primary"
      size="sm"
      isLoading={importing}
      icon={<BookOpen size={16} aria-hidden />}
      data-testid={testId}
      onClick={pickFiles}
    />
  );

  return (
    <VStack
      data-testid="bookshelf"
      aria-label="本地书架"
      height="100%"
      gap={0}
      style={{ minWidth: 0, flex: 1, background: 'var(--color-background-surface)' }}
    >
      {/* Shared hidden multi-file picker, triggered by every import button. */}
      <input
        ref={inputRef}
        data-testid="bookshelf-file-input"
        type="file"
        accept=".epub,.mobi,.azw,.azw3,.prc,.fb2,.fbz,.cbz,.txt"
        multiple
        hidden
        onChange={onInputChange}
      />
      {/* Top action & filter bar. The app title, book count and primary
          import action live in the HeaderBar; this bar only holds the
          shelf-local search / sort / view controls. */}
      {books.length > 0 && (
        <VStack gap={2} style={{ padding: 'var(--spacing-3) var(--spacing-6)', borderBottom: '1px solid var(--color-border)' }}>
          <HStack justify="between" vAlign="center" wrap="wrap" gap={3}>
            <VStack width={320} style={{ minWidth: 200, flexShrink: 1 }}>
              <TextInput
                label="搜索书架"
                isLabelHidden
                size="sm"
                startIcon={Search}
                hasClear
                placeholder="搜索书名或作者…"
                value={searchQuery}
                onChange={setSearchQuery}
              />
            </VStack>
            <HStack gap={2} vAlign="center" style={{ flexShrink: 0, flexWrap: 'nowrap' }}>
              <Selector
                label="排序方式"
                isLabelHidden
                variant="ghost"
                size="sm"
                startIcon={<ArrowDownUp size={14} aria-hidden />}
                options={SORT_OPTIONS}
                value={sortKey}
                onChange={(value) => setSortKey(value as SortKey)}
              />
              <SegmentedControl
                aria-label="视图模式"
                label="视图模式"
                size="sm"
                value={viewMode}
                onChange={(next) => setViewMode(next as 'grid' | 'list')}
              >
                <SegmentedControlItem
                  value="grid"
                  label="网格视图"
                  isLabelHidden
                  icon={<LayoutGrid size={14} aria-hidden />}
                />
                <SegmentedControlItem
                  value="list"
                  label="列表视图"
                  isLabelHidden
                  icon={<List size={14} aria-hidden />}
                />
              </SegmentedControl>
            </HStack>
          </HStack>
        </VStack>
      )}

      {error && (
        <Banner
          data-testid="bookshelf-error"
          status="error"
          container="section"
          title={error}
          isDismissable
          dismissLabel="关闭提示"
          onDismiss={() => store.getState().clearError()}
        />
      )}

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {/* Empty State */}
        {books.length === 0 ? (
          <VStack data-testid="bookshelf-empty" height="100%" vAlign="center" hAlign="center" padding={8}>
            <EmptyState
              icon={<BookOpen size={40} aria-hidden />}
              title="开始您的深度阅读旅程"
              description="书架还是空的，导入一本 EPUB 或 TXT 开始阅读"
              actions={importButton('bookshelf-empty-import-button')}
            />
            <Text type="supporting" color="secondary">
              支持 EPUB · MOBI · AZW3 · FB2 · CBZ · TXT 等电子书格式，也可直接拖入文件
            </Text>
          </VStack>
        ) : filteredBooks.length === 0 ? (
          <VStack vAlign="center" hAlign="center" gap={2} padding={8}>
            <Text color="secondary">未找到匹配「{searchQuery}」的书籍</Text>
            <Button label="清除搜索" variant="ghost" size="sm" onClick={() => setSearchQuery('')} />
          </VStack>
        ) : viewMode === 'grid' ? (
          /* Grid View: cover cards, with the import action as the last cell. */
          <Grid
            columns={{ minWidth: 160, max: 6 }}
            gap={4}
            style={{ padding: 'var(--spacing-6)' }}
          >
            {filteredBooks.map((book) => (
              <BookCard
                key={book.hash}
                book={book}
                layout="grid"
                onOpen={openBook}
                onRemove={removeBook}
              />
            ))}
            <ImportCard onPick={pickFiles} testId="bookshelf-import-card" />
          </Grid>
        ) : (
          /* List View */
          <VStack gap={2} style={{ padding: 'var(--spacing-4) var(--spacing-6)' }}>
            {filteredBooks.map((book) => (
              <BookCard
                key={book.hash}
                book={book}
                layout="list"
                onOpen={openBook}
                onRemove={removeBook}
              />
            ))}
          </VStack>
        )}
      </div>
    </VStack>
  );
}

interface BookCardProps {
  book: LibraryBookMeta;
  layout: 'grid' | 'list';
  onOpen: (hash: string) => void;
  onRemove: (book: LibraryBookMeta) => void;
}

/**
 * One book as an open trigger — cover-only card. The metadata (title,
 * author · date) is overlaid on the cover with a scrim gradient instead of
 * laid out below it; the format badge sits on the cover's top corner. When
 * the book has no cover image the typographic cover already carries the
 * title, so the overlay shows only the meta line (no duplicated title).
 */
function BookCard({ book, layout, onOpen, onRemove }: BookCardProps) {
  // The index store knows the shape of the book it currently has indexed; any
  // other shelf row only has an ordinal (see `progressLabel`).
  const shape = useBookIndexStore((s) => (s.bookHash === book.hash ? s.shape : undefined));
  const progress = progressLabel(book, shape);
  const metaLine = `${book.author || '未知作者'} · 导入于 ${formatDate(book.importedAt)}${progress ? ` · ${progress}` : ''}`;
  const hasCoverArt = Boolean(book.cover);

  if (layout === 'list') {
    return (
      <ClickableCard
        data-testid={`book-card-${book.hash}`}
        label={`打开《${book.title}》`}
        padding={3}
        className="shelf-card"
        onClick={() => onOpen(book.hash)}
      >
        <HStack gap={4} vAlign="center">
          <BookCover
            cover={book.cover}
            title={book.title}
            author={book.author}
            size="small"
          />
          <VStack gap={0} style={{ flex: 1, minWidth: 0 }}>
            <HStack gap={2} vAlign="center">
              <Text weight="semibold" maxLines={1}>{book.title}</Text>
              <Badge
                label={FORMAT_BADGES[book.format]?.label ?? book.format.toUpperCase()}
                variant={FORMAT_BADGES[book.format]?.variant ?? 'neutral'}
              />
            </HStack>
            <Text type="supporting" color="secondary" maxLines={1}>
              {book.author || '未知作者'} · {formatSize(book.size)} · 导入于 {formatDate(book.importedAt)}
            </Text>
            {progress && (
              <Text type="supporting" size="2xs" color="accent" weight="medium">{progress}</Text>
            )}
          </VStack>
          <IconButton
            label="删除书籍"
            variant="ghost"
            size="sm"
            tooltip="删除书籍"
            icon={<Trash2 size={14} aria-hidden />}
            onClick={(event) => {
              event.stopPropagation();
              onRemove(book);
            }}
          />
        </HStack>
      </ClickableCard>
    );
  }

  return (
    <ClickableCard
      data-testid={`book-card-${book.hash}`}
      label={`打开《${book.title}》`}
      padding={0}
      className="shelf-card"
      style={{ position: 'relative', overflow: 'hidden', borderRadius: 'var(--radius-container)', border: 'none' }}
      onClick={() => onOpen(book.hash)}
    >
      <VStack gap={0} style={{ position: 'relative' }}>
        <IconButton
          label="删除书籍"
          variant="secondary"
          size="sm"
          tooltip="从书架移除"
          style={{ position: 'absolute', insetInlineEnd: 'var(--spacing-2)', insetBlockStart: 'var(--spacing-2)', zIndex: 30 }}
          icon={<X size={14} aria-hidden />}
          onClick={(event) => {
            event.stopPropagation();
            onRemove(book);
          }}
        />
        <Badge
          data-testid={`book-format-${book.hash}`}
          label={FORMAT_BADGES[book.format]?.label ?? book.format.toUpperCase()}
          variant={FORMAT_BADGES[book.format]?.variant ?? 'neutral'}
          style={{ position: 'absolute', insetInlineStart: 'var(--spacing-2)', insetBlockStart: 'var(--spacing-2)', zIndex: 30 }}
        />

        <BookCover
          cover={book.cover}
          title={book.title}
          author={book.author}
        />

        {/* Scrim overlay: metadata rides on the cover, not below it. Stays
            under the cover's progress chip (z 20) and the corner controls. */}
        <VStack
          gap={1}
          style={{
            position: 'absolute',
            insetInline: 0,
            bottom: 0,
            zIndex: 15,
            padding: 'var(--spacing-10) var(--spacing-4) var(--spacing-3)',
            background:
              'linear-gradient(to top, rgb(0 0 0 / 0.8) 0%, rgb(0 0 0 / 0.45) 62%, transparent 100%)',
          }}
        >
          {hasCoverArt && (
            <Text size="sm" maxLines={1} weight="semibold" style={{ color: 'rgb(255 255 255)', lineHeight: 1.5 }}>
              {book.title}
            </Text>
          )}
          <Text
            type="supporting"
            size="2xs"
            maxLines={1}
            style={{ color: 'rgb(255 255 255 / 0.85)', letterSpacing: '0.01em' }}
          >
            {metaLine}
          </Text>
        </VStack>
      </VStack>
    </ClickableCard>
  );
}

/**
 * The shelf's last grid cell: a dashed "add book" card, same aspect as the
 * covers, so importing stays one click away without a dedicated toolbar
 * button.
 */
function ImportCard({ onPick, testId }: { onPick: () => void; testId: string }) {
  return (
    <ClickableCard
      data-testid={testId}
      label="导入书籍"
      padding={0}
      className="shelf-card"
      style={{
        border: '2px dashed var(--color-border-emphasized)',
        borderRadius: 'var(--radius-container)',
      }}
      onClick={onPick}
    >
      <VStack
        vAlign="center"
        hAlign="center"
        gap={2}
        style={{ aspectRatio: '3 / 4', width: '100%', padding: 'var(--spacing-4)' }}
      >
        <VStack
          vAlign="center"
          hAlign="center"
          style={{
            width: 48,
            height: 48,
            borderRadius: 'var(--radius-full)',
            background: 'var(--color-background-muted)',
            color: 'var(--color-text-secondary)',
          }}
        >
          <Plus size={22} aria-hidden />
        </VStack>
        <Text type="supporting" color="secondary">导入书籍</Text>
        <Text type="supporting" size="2xs" color="secondary" style={{ textAlign: 'center' }}>
          EPUB · MOBI · TXT 等
        </Text>
      </VStack>
    </ClickableCard>
  );
}

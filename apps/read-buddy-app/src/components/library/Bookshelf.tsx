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
  Upload,
  X,
} from 'lucide-react';
import { Badge, type BadgeProps } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { ClickableCard } from '@astryxdesign/core/ClickableCard';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
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
 * Reading-progress line, answered by the book's own row.
 *
 * It used to borrow the shape of whichever book the single index store happened
 * to hold, and to feed a **spine** ordinal into node-model wording — so
 * 《何为良好生活》 (11 spine files, 70 节) showed 「读至第 7 节」 for spine 7, and any
 * other row wore the open book's levels. Now each row carries what the index
 * pipeline computed for it (`nodeShape`) and the **node** ordinal the Reading
 * Position owner resolved (`lastNodeIndex`), so the two coordinate spaces are
 * never confused:
 *   - both present → `formatProgress` picks the level word from the node model;
 *   - otherwise → the neutral 「读至第 N 个位置」, never a guessed 章 / 节.
 */
const progressLabel = (book: LibraryBookMeta): string | undefined => {
  const { nodeShape, lastNodeIndex } = book;
  if (nodeShape && nodeShape.total > 0 && typeof lastNodeIndex === 'number') {
    return formatProgress(nodeShape, lastNodeIndex + 1);
  }
  // No node answer for this book yet: fall back to the physical ordinal, said
  // plainly.
  const spineOrdinal = book.lastSpineIndex;
  if (typeof spineOrdinal !== 'number' || spineOrdinal <= 0) return undefined;
  return `读至第 ${spineOrdinal + 1} 个位置`;
};

/**
 * How far through the book the reader is, as a 0..1 fraction — the cover's
 * progress bar and the hero's share one answer.
 *
 * Derived strictly inside the **node** coordinate space: a numerator
 * (`lastNodeIndex`, resolved by the Reading Position owner) over its own total
 * (`nodeShape.total`). A bare `lastSpineIndex` deliberately yields no fraction:
 * a spine ordinal is a position in a different space (ADR 0011), and dividing it
 * by a node total is the same confusion `progressLabel` exists to prevent —
 * 《何为良好生活》 would sit at 7/81 for having 11 spine files. No fraction is
 * better than a wrong one; the label still says where the reader is.
 */
const progressFraction = (book: LibraryBookMeta): number | undefined => {
  const { nodeShape, lastNodeIndex } = book;
  if (!nodeShape || nodeShape.total <= 0 || typeof lastNodeIndex !== 'number') return undefined;
  // The reader is *in* the node, so the Nth node reads as N/total complete — the
  // same convention as 「读至第 N 节」, where the ordinal is 1-based.
  return Math.min(1, Math.max(0, (lastNodeIndex + 1) / nodeShape.total));
};

/** True once anything was recorded for this book — opened at least once. */
const hasReadingProgress = (book: LibraryBookMeta): boolean =>
  typeof book.lastSpineIndex === 'number' || typeof book.lastNodeIndex === 'number';

export default function Bookshelf({ store = useLibraryStore }: BookshelfProps) {
  const books = store((s) => s.books);
  const importing = store((s) => s.importing);
  const error = store((s) => s.error);
  const currentHash = store((s) => s.currentHash);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('recent');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [deletingBook, setDeletingBook] = useState<LibraryBookMeta | null>(null);
  const [deleteArtifacts, setDeleteArtifacts] = useState(false);

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
    setDeletingBook(book);
    setDeleteArtifacts(false);
  };

  const handleConfirmDelete = async () => {
    if (!deletingBook) return;
    const target = deletingBook;
    setDeletingBook(null);
    await store.getState().remove(target.hash, { deleteArtifacts });
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

  /**
   * The book the hero offers: the one still open behind the shelf when there is
   * one (its reader state is live, so 继续阅读 re-enters it instantly), else the
   * most recently read book that has a recorded position.
   */
  const continueBook = useMemo(() => {
    const open = currentHash ? books.find((book) => book.hash === currentHash) : undefined;
    if (open) return open;
    const read = books.filter(hasReadingProgress);
    return read.length > 0
      ? read.reduce((newest, book) => (book.updatedAt > newest.updatedAt ? book : newest))
      : undefined;
  }, [books, currentHash]);

  const continueReading = () => {
    if (!continueBook) return;
    // Re-enter the kept-open book rather than re-open it: `open` re-parses the
    // stored bytes and rebuilds the engine, losing the live reading session.
    if (continueBook.hash === currentHash) store.getState().resumeReading();
    else void store.getState().open(continueBook.hash);
  };

  const importButton = (testId: string) => (
    <Button
      label={importing ? '导入中…' : '导入书籍'}
      variant="primary"
      size="sm"
      isLoading={importing}
      icon={<Upload size={16} aria-hidden />}
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

      <div className="modern-bookshelf-canvas" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {/* Continue-reading band: the shelf's primary action, said plainly at the
            top of the library instead of hiding behind a header icon. It stands
            down while a search is running — a filtered shelf answers a different
            question, and the hero would sit above results it has nothing to do
            with. */}
        {continueBook && !searchQuery.trim() && (
          <ShelfHero
            book={continueBook}
            fraction={progressFraction(continueBook)}
            onContinue={continueReading}
          />
        )}
        {/* Empty State */}
        {books.length === 0 ? (
          <VStack data-testid="bookshelf-empty" height="100%" vAlign="center" hAlign="center" padding={8}>
            <EmptyState
              icon={<BookOpen size={40} aria-hidden />}
              title="书架暂无书籍"
              description="导入电子书或直接将文件拖入此处开始阅读"
              actions={importButton('bookshelf-empty-import-button')}
            />
            <Text type="supporting" color="secondary">
              支持 EPUB · MOBI · AZW3 · FB2 · CBZ · TXT 等格式
            </Text>
          </VStack>
        ) : filteredBooks.length === 0 ? (
          <VStack vAlign="center" hAlign="center" gap={2} padding={8}>
            <Text color="secondary">未找到匹配「{searchQuery}」的书籍</Text>
            <Button label="清除搜索" variant="ghost" size="sm" onClick={() => setSearchQuery('')} />
          </VStack>
        ) : viewMode === 'grid' ? (
          /* Grid View: modern flat-skeuomorphic cards */
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

      {deletingBook && (
        <Dialog
          isOpen
          onOpenChange={(open) => !open && setDeletingBook(null)}
          width={460}
          padding={0}
          aria-label="删除书籍"
          data-testid="delete-book-dialog"
        >
          <VStack gap={0} style={{ minWidth: 0 }}>
            <HStack
              justify="between"
              vAlign="center"
              style={{
                padding: 'var(--spacing-4) var(--spacing-5)',
                borderBottom: '1px solid var(--color-border)',
              }}
            >
              <HStack gap={3} vAlign="center">
                <div
                  style={{
                    color: 'var(--color-danger)',
                    background: 'rgba(239, 68, 68, 0.1)',
                    width: 32,
                    height: 32,
                    borderRadius: 'var(--radius-container)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <Trash2 size={16} aria-hidden />
                </div>
                <VStack gap={0} style={{ minWidth: 0 }}>
                  <Text weight="semibold" type="large">
                    删除书籍
                  </Text>
                  <Text type="supporting" color="secondary">
                    从书架中移除此图书
                  </Text>
                </VStack>
              </HStack>
              <IconButton
                icon={<X size={16} aria-hidden />}
                label="关闭弹窗"
                variant="ghost"
                size="sm"
                onClick={() => setDeletingBook(null)}
              />
            </HStack>

            <VStack gap={4} style={{ padding: 'var(--spacing-5)' }}>
              <HStack
                gap={3}
                vAlign="center"
                style={{
                  padding: 'var(--spacing-3) var(--spacing-4)',
                  background: 'var(--color-background-muted)',
                  borderRadius: 'var(--radius-container)',
                  border: '1px solid var(--color-border)',
                }}
              >
                <div style={{ flexShrink: 0 }}>
                  <BookCover
                    cover={deletingBook.cover}
                    title={deletingBook.title}
                    author={deletingBook.author}
                    size="mini"
                  />
                </div>
                <VStack gap={1} style={{ minWidth: 0, flex: 1 }}>
                  <Text weight="semibold" maxLines={1}>
                    《{deletingBook.title}》
                  </Text>
                  <HStack gap={2} vAlign="center" wrap="wrap">
                    <Text type="supporting" color="secondary" maxLines={1}>
                      {deletingBook.author || '未知作者'}
                    </Text>
                    <Badge variant="neutral" label={deletingBook.format.toUpperCase()} />
                    <Text type="supporting" color="secondary">
                      {formatSize(deletingBook.size)}
                    </Text>
                  </HStack>
                </VStack>
              </HStack>

              <Text type="supporting" color="secondary" style={{ lineHeight: 1.6 }}>
                确定从书架中移除该书籍吗？默认保留阅读进度与伴读数据。
              </Text>

              <div
                style={{
                  background: 'var(--color-background-surface)',
                  borderRadius: 'var(--radius-container)',
                  border: '1px solid var(--color-border)',
                  padding: 'var(--spacing-3) var(--spacing-4)',
                }}
              >
                <CheckboxInput
                  label="同时删除阅读记录与 AI 伴读数据"
                  description="删除后将无法恢复。"
                  value={deleteArtifacts}
                  onChange={(checked) => setDeleteArtifacts(checked)}
                  data-testid="delete-artifacts-checkbox"
                />
              </div>
            </VStack>

            <HStack
              justify="end"
              gap={3}
              style={{
                padding: 'var(--spacing-3) var(--spacing-5)',
                borderTop: '1px solid var(--color-border)',
                background: 'var(--color-background-muted)',
              }}
            >
              <Button
                label="取消"
                variant="ghost"
                size="sm"
                data-testid="cancel-delete-button"
                onClick={() => setDeletingBook(null)}
              />
              <Button
                label="确认删除"
                variant="destructive"
                size="sm"
                data-testid="confirm-delete-button"
                onClick={handleConfirmDelete}
              />
            </HStack>
          </VStack>
        </Dialog>
      )}
    </VStack>
  );
}

/**
 * The continue-reading band at the top of the shelf: a small cover, whose book
 * this is, how far in the reader is, and the one action that matters.
 *
 * A band, not a banner — a hairline under it and no card of its own, so the grid
 * below stays the loudest thing on the shelf. It carries the same
 * `progressLabel` and `progressFraction` a card does, so the two can never
 * disagree about one book.
 */
function ShelfHero({
  book,
  fraction,
  onContinue,
}: {
  book: LibraryBookMeta;
  fraction?: number;
  onContinue: () => void;
}) {
  const progress = progressLabel(book);

  return (
    <HStack data-testid="shelf-hero" gap={4} vAlign="center" className="shelf-hero">
      <BookCover
        cover={book.cover}
        title={book.title}
        author={book.author}
        size="small"
        progressFraction={fraction}
      />
      <VStack gap={1} style={{ flex: 1, minWidth: 0 }}>
        <Text type="supporting" size="2xs" color="secondary" style={{ letterSpacing: '0.08em' }}>
          上次读到
        </Text>
        <Text weight="semibold" maxLines={1} style={{ fontSize: '15px' }}>
          {book.title}
        </Text>
        <HStack gap={2} vAlign="center" wrap="wrap" style={{ minWidth: 0 }}>
          <Text type="supporting" color="secondary" maxLines={1}>
            {book.author || '未知作者'}
          </Text>
          {progress && (
            <Text
              type="supporting"
              size="2xs"
              color="accent"
              weight="medium"
              data-testid="shelf-hero-progress"
            >
              {progress}
            </Text>
          )}
        </HStack>
      </VStack>
      <Button
        label="继续阅读"
        variant="primary"
        size="sm"
        icon={<BookOpen size={16} aria-hidden />}
        data-testid="shelf-hero-continue"
        onClick={onContinue}
      />
    </HStack>
  );
}

interface BookCardProps {
  book: LibraryBookMeta;
  layout: 'grid' | 'list';
  onOpen: (hash: string) => void;
  onRemove: (book: LibraryBookMeta) => void;
}

/**
 * One book as an open trigger — cover-only card. The metadata (author ·
 * progress) is overlaid on the cover with a scrim gradient instead of laid out
 * below it; the format badge sits on the cover's top corner. When the book has no
 * cover image the typographic cover already carries the title, so the overlay
 * shows only the meta line (no duplicated title). The delete ✕ appears on hover
 * or keyboard focus; the import date lives in the list view, where the line is
 * not clamped to one row.
 */
function BookCard({ book, layout, onOpen, onRemove }: BookCardProps) {
  // Answered by the book's own row — no store lookup, no borrowing the open
  // book's levels (see `progressLabel`).
  const progress = progressLabel(book);
  const fraction = progressFraction(book);
  // The grid overlay sits on the cover's scrim and is clamped to one line there,
  // so it says the two things a shelf is scanned for: who wrote it and how far in
  // the reader is. The import date belongs to the list view, where it has room.
  const overlayLine = `${book.author || '未知作者'}${progress ? ` · ${progress}` : ''}`;
  const listLine = `${book.author || '未知作者'} · ${formatSize(book.size)} · 导入于 ${formatDate(book.importedAt)}`;
  const hasCoverArt = Boolean(book.cover);

  if (layout === 'list') {
    return (
      <ClickableCard
        data-testid={`book-card-${book.hash}`}
        label={`打开《${book.title}》`}
        padding={3}
        className="shelf-card"
        style={{
          borderRadius: 'var(--radius-container)',
          border: '1px solid var(--color-border)',
          background: 'var(--color-background-surface)',
          boxShadow: 'var(--shadow-low)',
        }}
        onClick={() => onOpen(book.hash)}
      >
        <HStack gap={4} vAlign="center">
          <BookCover
            cover={book.cover}
            title={book.title}
            author={book.author}
            size="small"
            progressFraction={fraction}
          />
          <VStack gap={1} style={{ flex: 1, minWidth: 0 }}>
            <HStack gap={2} vAlign="center">
              <Text weight="semibold" maxLines={1} style={{ fontSize: '15px' }}>{book.title}</Text>
              <Badge
                data-testid={`book-format-${book.hash}`}
                label={FORMAT_BADGES[book.format]?.label ?? book.format.toUpperCase()}
                variant={FORMAT_BADGES[book.format]?.variant ?? 'neutral'}
              />
            </HStack>
            <Text type="supporting" color="secondary" maxLines={1}>
              {listLine}
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
      style={{
        position: 'relative',
        overflow: 'hidden',
        borderRadius: '3px 8px 8px 3px',
        border: 'none',
        background: 'transparent',
      }}
      onClick={() => onOpen(book.hash)}
    >
      <VStack gap={0} style={{ position: 'relative' }}>
        <IconButton
          label="删除书籍"
          variant="secondary"
          size="sm"
          tooltip="从书架移除"
          // Revealed by the card's hover / focus-within (globals.css): a permanent
          // ✕ on every cover was noise, and the most mis-clicked control on the
          // shelf was the one that deletes a book.
          className="shelf-card-action"
          style={{
            position: 'absolute',
            insetInlineEnd: 'var(--spacing-2)',
            insetBlockStart: 'var(--spacing-2)',
            zIndex: 30,
            background: 'rgba(18, 14, 12, 0.65)',
            backdropFilter: 'blur(8px)',
            color: '#ffffff',
            borderRadius: 'var(--radius-full)',
            border: '1px solid rgba(255, 255, 255, 0.2)',
          }}
          icon={<X size={14} aria-hidden />}
          onClick={(event) => {
            event.stopPropagation();
            onRemove(book);
          }}
        />

        {/* Modern format badge */}
        <div
          data-testid={`book-format-${book.hash}`}
          className="modern-format-badge"
        >
          {FORMAT_BADGES[book.format]?.label ?? book.format.toUpperCase()}
        </div>

        <BookCover
          cover={book.cover}
          title={book.title}
          author={book.author}
          progressFraction={fraction}
        />

        {/* Modern archival cover overlay */}
        <VStack
          gap={1}
          className="modern-cover-overlay"
        >
          {hasCoverArt && (
            <Text
              size="sm"
              maxLines={1}
              weight="semibold"
              style={{
                color: '#ffffff',
                lineHeight: 1.4,
                textShadow: '0 1px 2px rgba(0, 0, 0, 0.85)',
                letterSpacing: '0.01em',
              }}
            >
              {book.title}
            </Text>
          )}
          <Text
            type="supporting"
            size="2xs"
            maxLines={1}
            data-testid={`book-meta-${book.hash}`}
            style={{
              color: 'rgba(255, 255, 255, 0.92)',
              letterSpacing: '0.01em',
              textShadow: '0 1px 1px rgba(0, 0, 0, 0.75)',
            }}
          >
            {overlayLine}
          </Text>
        </VStack>
      </VStack>
    </ClickableCard>
  );
}

/**
 * The shelf's last grid cell: a modern flat-skeuomorphic slot, same aspect as the
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
        borderRadius: '3px 8px 8px 3px',
        border: 'none',
        background: 'transparent',
      }}
      onClick={onPick}
    >
      <div className="modern-import-card">
        <VStack
          vAlign="center"
          hAlign="center"
          gap={2}
          style={{ width: '100%', padding: 'var(--spacing-4)' }}
        >
          <div className="modern-import-icon-bubble">
            <Plus size={22} aria-hidden />
          </div>
          <Text type="supporting" weight="semibold" style={{ color: 'var(--color-text-primary)' }}>
            导入书籍
          </Text>
          <Text type="supporting" size="2xs" color="secondary" style={{ textAlign: 'center' }}>
            EPUB · MOBI · TXT 等
          </Text>
        </VStack>
      </div>
    </ClickableCard>
  );
}

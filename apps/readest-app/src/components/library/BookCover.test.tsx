import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import BookCover from './BookCover';

describe('BookCover', () => {
  it('renders image when cover prop is provided', () => {
    render(<BookCover title="三体" cover="data:image/jpeg;base64,1234" />);
    const img = screen.getByTestId('book-cover-image') as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.src).toContain('data:image/jpeg;base64,1234');
    expect(screen.queryByTestId('book-cover-typographic')).toBeNull();
  });

  it('renders typographic fallback when no cover prop is passed', () => {
    render(<BookCover title="百年孤独" author="加西亚·马尔克斯" format="txt" />);
    expect(screen.getByTestId('book-cover-typographic')).toBeTruthy();
    expect(screen.getByText('《百年孤独》')).toBeTruthy();
    expect(screen.getByText('著 · 加西亚·马尔克斯')).toBeTruthy();
    expect(screen.queryByTestId('book-cover-image')).toBeNull();
  });

  it('falls back to typographic cover if the image fails to load', () => {
    render(<BookCover title="瓦尔登湖" cover="http://bad-url.com/broken.jpg" />);
    const img = screen.getByTestId('book-cover-image');
    fireEvent.error(img);
    expect(screen.getByTestId('book-cover-typographic')).toBeTruthy();
    expect(screen.getByText('《瓦尔登湖》')).toBeTruthy();
  });

  it('displays progress badge when progressText is provided', () => {
    render(<BookCover title="原则" progressText="第 5 节 · 35%" />);
    expect(screen.getByTestId('book-cover-progress')).toBeTruthy();
    expect(screen.getByText('第 5 节 · 35%')).toBeTruthy();
  });

  it('paints a hairline progress bar along the bottom edge when a fraction is known', () => {
    render(<BookCover title="原则" progressFraction={0.35} />);
    expect(screen.getByTestId('book-cover-progress-bar')).toBeTruthy();
    expect((screen.getByTestId('book-cover-progress-fill') as HTMLElement).style.width).toBe('35%');
  });

  it('clamps a fraction outside 0..1 instead of overflowing the cover', () => {
    const { unmount } = render(<BookCover title="原则" progressFraction={1.4} />);
    expect((screen.getByTestId('book-cover-progress-fill') as HTMLElement).style.width).toBe('100%');
    unmount();

    render(<BookCover title="原则" progressFraction={-0.2} />);
    expect((screen.getByTestId('book-cover-progress-fill') as HTMLElement).style.width).toBe('0%');
  });

  it('shows no bar when no fraction is known', () => {
    // A book whose progress is only known as an ordinal has no fraction to paint,
    // and a half-filled bar would be a claim the shelf cannot back.
    render(<BookCover title="原则" />);
    expect(screen.queryByTestId('book-cover-progress-bar')).toBeNull();
  });
});

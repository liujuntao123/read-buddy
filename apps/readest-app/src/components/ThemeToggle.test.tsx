import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import ThemeToggle from './ThemeToggle';
import { READING_THEME_CHANGE_EVENT, THEME_STORAGE_KEY, type ReadingTheme } from '@/theme/readingTheme';

const radiobutton = (name: string) => screen.getByRole('radio', { name });

beforeEach(() => {
  window.localStorage.clear();
});

describe('ThemeToggle', () => {
  it('renders the three theme options and defaults to 日间模式', () => {
    render(<ThemeToggle />);
    expect(screen.getByTestId('theme-toggle').getAttribute('role')).toBe('radiogroup');
    expect(screen.getByRole('radio', { name: '日间模式' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: '护眼模式' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: '夜间模式' })).toBeTruthy();

    expect(radiobutton('日间模式').getAttribute('aria-checked')).toBe('true');
    expect(radiobutton('护眼模式').getAttribute('aria-checked')).toBe('false');
  });

  it('switches to sepia, broadcasts the change and persists to localStorage', () => {
    const changes: ReadingTheme[] = [];
    const onChange = (event: Event) => {
      changes.push((event as CustomEvent<ReadingTheme>).detail);
    };
    window.addEventListener(READING_THEME_CHANGE_EVENT, onChange);

    render(<ThemeToggle />);
    fireEvent.click(radiobutton('护眼模式'));

    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('sepia');
    expect(changes).toEqual(['sepia']);
    expect(radiobutton('护眼模式').getAttribute('aria-checked')).toBe('true');
    expect(radiobutton('日间模式').getAttribute('aria-checked')).toBe('false');
    window.removeEventListener(READING_THEME_CHANGE_EVENT, onChange);
  });

  it('switches to dark and back to light', () => {
    render(<ThemeToggle />);
    fireEvent.click(radiobutton('夜间模式'));
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(radiobutton('夜间模式').getAttribute('aria-checked')).toBe('true');

    fireEvent.click(radiobutton('日间模式'));
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    expect(radiobutton('日间模式').getAttribute('aria-checked')).toBe('true');
  });

  it('restores the persisted theme on a fresh mount', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    render(<ThemeToggle />);
    expect(radiobutton('夜间模式').getAttribute('aria-checked')).toBe('true');
  });

  it('falls back to light for an unknown stored value', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'neon-pink');
    render(<ThemeToggle />);
    expect(radiobutton('日间模式').getAttribute('aria-checked')).toBe('true');
  });
});

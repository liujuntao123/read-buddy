import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import ThemeToggle, { readStoredTheme, THEME_STORAGE_KEY } from './ThemeToggle';

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.setAttribute('data-theme', 'light');
});

describe('ThemeToggle', () => {
  it('renders the three theme buttons and defaults to 日间模式', () => {
    render(<ThemeToggle />);
    expect(screen.getByRole('button', { name: '日间模式' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '护眼模式' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '夜间模式' })).toBeTruthy();

    const active = screen.getByRole('button', { name: '日间模式' });
    expect(active.getAttribute('aria-pressed')).toBe('true');
    expect(active.className).toContain('btn-active');
    expect(screen.getByRole('button', { name: '护眼模式' }).getAttribute('aria-pressed')).toBe('false');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('switches to sepia, applies html[data-theme] and persists to localStorage', () => {
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole('button', { name: '护眼模式' }));

    expect(document.documentElement.dataset.theme).toBe('sepia');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('sepia');
    expect(screen.getByRole('button', { name: '护眼模式' }).className).toContain('btn-active');
    expect(screen.getByRole('button', { name: '日间模式' }).className).not.toContain('btn-active');
  });

  it('switches to dark and back to light', () => {
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole('button', { name: '夜间模式' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');

    fireEvent.click(screen.getByRole('button', { name: '日间模式' }));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
  });

  it('restores the persisted theme on a fresh mount', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    render(<ThemeToggle />);
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(screen.getByRole('button', { name: '夜间模式' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('falls back to light for an unknown stored value', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'neon-pink');
    expect(readStoredTheme()).toBe('light');
    render(<ThemeToggle />);
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});

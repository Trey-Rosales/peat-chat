import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTheme } from './useTheme';

describe('useTheme', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });
  afterEach(() => localStorage.clear());

  it('defaults to dark when nothing stored', () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('restores theme from localStorage', () => {
    localStorage.setItem('dtak.theme', 'ld');
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('ld');
    expect(document.documentElement.getAttribute('data-theme')).toBe('ld');
  });

  it('setTheme updates dom + storage', () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setTheme('light'));
    expect(result.current.theme).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(localStorage.getItem('dtak.theme')).toBe('light');
  });

  it('rejects invalid theme values', () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setTheme('wat' as any));
    expect(result.current.theme).toBe('dark');  // unchanged
  });
});

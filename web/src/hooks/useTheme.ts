import { useEffect, useState, useCallback } from 'react';

export type Theme = 'dark' | 'light' | 'ld';
const STORAGE_KEY = 'dtak.theme';
const VALID: Theme[] = ['dark', 'light', 'ld'];

function readStored(): Theme {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return VALID.includes(v as Theme) ? (v as Theme) : 'dark';
  } catch {
    return 'dark';
  }
}

function applyToDom(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => {
    const t = readStored();
    applyToDom(t);
    return t;
  });

  useEffect(() => {
    applyToDom(theme);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    if (!VALID.includes(next)) return;
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* noop */ }
    setThemeState(next);
  }, []);

  return { theme, setTheme };
}

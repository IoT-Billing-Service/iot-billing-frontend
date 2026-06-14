'use client';

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

type ThemeMode = 'light' | 'dark' | 'high-contrast-light' | 'high-contrast-dark';

interface ThemeContextValue {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  toggle: () => void;
  isHighContrast: boolean;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const THEME_KEY = 'iot-billing-theme';
const THEME_ORDER: ThemeMode[] = ['light', 'dark', 'high-contrast-light', 'high-contrast-dark'];

function getSystemTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'dark';
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  return prefersDark ? 'dark' : 'light';
}

function applyTheme(mode: ThemeMode): void {
  const root = document.documentElement;
  root.setAttribute('data-theme', mode);
  root.classList.remove('light', 'dark', 'high-contrast-light', 'high-contrast-dark');
  root.classList.add(mode);

  if (mode === 'high-contrast-light' || mode === 'high-contrast-dark') {
    root.style.setProperty('--contrast-boost', '1.5');
    root.style.setProperty('--text-shadow', '0 0 2px currentColor');
  } else {
    root.style.removeProperty('--contrast-boost');
    root.style.removeProperty('--text-shadow');
  }

  try {
    localStorage.setItem(THEME_KEY, mode);
  } catch {
    // localStorage unavailable
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(() => {
    if (typeof window === 'undefined') return 'dark';
    const stored = localStorage.getItem(THEME_KEY) as ThemeMode | null;
    const initial = stored ?? getSystemTheme();
    applyTheme(initial);
    return initial;
  });

  const setMode = useCallback((newMode: ThemeMode) => {
    setModeState(newMode);
    applyTheme(newMode);
  }, []);

  const toggle = useCallback(() => {
    setModeState((prev) => {
      const idx = THEME_ORDER.indexOf(prev);
      const next = THEME_ORDER[(idx + 1) % THEME_ORDER.length]!;
      applyTheme(next);
      return next;
    });
  }, []);

  const isHighContrast = mode === 'high-contrast-light' || mode === 'high-contrast-dark';

  return (
    <ThemeContext.Provider value={{ mode, setMode, toggle, isHighContrast }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}

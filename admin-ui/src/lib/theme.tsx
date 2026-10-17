// Тема оформления: тёмная по умолчанию, светлая или как в системе. Выбор хранится в localStorage
// (тот же ключ читает скрипт в index.html, чтобы страница сразу открывалась в нужной теме).
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type Theme = 'dark' | 'light' | 'system';
const STORAGE_KEY = 'tlh-theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

function storedTheme(): Theme {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'system' ? value : 'dark';
  } catch {
    return 'dark';
  }
}

const resolve = (theme: Theme): 'dark' | 'light' => (theme === 'system' ? (matchMedia(DARK_QUERY).matches ? 'dark' : 'light') : theme);

interface ThemeContextValue {
  theme: Theme;
  /** Тема, которая сейчас на экране («как в системе» уже раскрыто). */
  resolved: 'dark' | 'light';
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(storedTheme);
  const [resolved, setResolved] = useState(() => resolve(theme));

  useEffect(() => {
    const apply = () => {
      const next = resolve(theme);
      document.documentElement.classList.remove('dark', 'light');
      document.documentElement.classList.add(next);
      setResolved(next);
    };
    apply();
    if (theme !== 'system') return;
    const media = matchMedia(DARK_QUERY);
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);

  const setTheme = (next: Theme) => {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Без localStorage тема просто не запомнится.
    }
    setThemeState(next);
  };

  return <ThemeContext value={{ theme, resolved, setTheme }}>{children}</ThemeContext>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme нужен внутри ThemeProvider.');
  return value;
}

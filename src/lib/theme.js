// Dark / light theme. The choice is kept in localStorage; without one the device setting decides.
// index.html applies it before the first paint (same rules), so the page never flashes the wrong colours.

export const THEME_KEY = 'looper-theme';
export const THEMES = ['dark', 'light'];
export const THEME_COLOR = { dark: '#050B18', light: '#F2F2F3' }; // browser bar colour

/** The theme to use: a stored choice wins, else the device's light/dark setting, else dark. */
export function resolveTheme(stored, prefersLight) {
  if (THEMES.includes(stored)) return stored;
  return prefersLight ? 'light' : 'dark';
}

export const otherTheme = (theme) => (theme === 'light' ? 'dark' : 'light');

export function readStoredTheme() {
  try {
    return window.localStorage.getItem(THEME_KEY);
  } catch {
    return null; // private mode / blocked storage
  }
}

export function currentTheme() {
  const set = typeof document !== 'undefined' ? document.documentElement.dataset.theme : null;
  if (THEMES.includes(set)) return set;
  const prefersLight = typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches;
  return resolveTheme(readStoredTheme(), Boolean(prefersLight));
}

/** Show a theme (and, with `save`, remember it for next time). */
export function applyTheme(theme, { save = false } = {}) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme]);
  if (save) {
    try {
      window.localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* the choice just is not remembered */
    }
  }
  window.dispatchEvent(new CustomEvent('looper-theme', { detail: theme }));
}

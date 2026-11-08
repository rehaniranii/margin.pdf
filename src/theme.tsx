import { useEffect, useState } from 'react'

type Theme = 'light' | 'dark'

function initialTheme(): Theme {
  try { const saved = localStorage.getItem('theme'); if (saved === 'light' || saved === 'dark') return saved } catch {}
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

// Theme lives on <html data-theme> so the homepage and editor share it.
export function ThemeToggle() {
  const [theme, setTheme] = useState(initialTheme)
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try { localStorage.setItem('theme', theme) } catch {}
  }, [theme])
  const dark = theme === 'dark'
  return <button type="button" className="theme-toggle" onClick={() => setTheme(dark ? 'light' : 'dark')} aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'} aria-pressed={dark} title={dark ? 'Light mode' : 'Dark mode'}>
    <svg className="sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
    <svg className="moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>
  </button>
}

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import {
  APPEARANCE_STORAGE_KEY,
  VISUAL_THEME_STORAGE_KEY,
  readAppearance,
  readVisualTheme,
  resolveAppearance,
  type Appearance,
  type ResolvedAppearance,
  type VisualTheme,
} from './themeModel'

export type { Appearance, ResolvedAppearance, VisualTheme } from './themeModel'

interface ThemeContextValue {
  appearance: Appearance
  resolvedAppearance: ResolvedAppearance
  visualTheme: VisualTheme
  setAppearance: (appearance: Appearance) => void
  setVisualTheme: (theme: VisualTheme) => void
  toggle: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

function getSystemAppearance(): ResolvedAppearance {
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

function applyTheme(visualTheme: VisualTheme, resolved: ResolvedAppearance) {
  document.documentElement.setAttribute('data-visual-theme', visualTheme)
  document.documentElement.setAttribute('data-appearance', resolved)
  // Keep this compatibility attribute during the gradual CSS migration.
  document.documentElement.setAttribute('data-theme', resolved)
  // 同步 Tauri 原生窗口主题，避免 macOS 标题栏/红绿灯与页面违和
  void (async () => {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      await getCurrentWindow().setTheme(resolved)
    } catch {
      // 非 Tauri 环境（如 vitest）忽略
    }
  })()
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [appearance, setAppearanceState] = useState<Appearance>(() => {
    const previewTheme = import.meta.env.DEV
      ? new URLSearchParams(window.location.search).get('theme')
      : import.meta.env.VITE_UI_APPEARANCE ?? null
    if (previewTheme === 'light' || previewTheme === 'dark') return previewTheme
    if (typeof localStorage === 'undefined') return 'system'
    return readAppearance(localStorage)
  })
  const [visualTheme, setVisualThemeState] = useState<VisualTheme>(() =>
    typeof localStorage === 'undefined' ? 'axiom' : readVisualTheme(localStorage))
  const [systemAppearance, setSystemAppearance] = useState<ResolvedAppearance>(getSystemAppearance)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) =>
      setSystemAppearance(e.matches ? 'dark' : 'light')
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  const resolvedAppearance = resolveAppearance(appearance, systemAppearance)

  useEffect(() => {
    applyTheme(visualTheme, resolvedAppearance)
  }, [resolvedAppearance, visualTheme])

  const setAppearance = useCallback((next: Appearance) => {
    setAppearanceState(next)
    if (next === 'system') {
      localStorage.removeItem(APPEARANCE_STORAGE_KEY)
    } else {
      localStorage.setItem(APPEARANCE_STORAGE_KEY, next)
    }
    localStorage.setItem(VISUAL_THEME_STORAGE_KEY, visualTheme)
  }, [visualTheme])

  const setVisualTheme = useCallback((next: VisualTheme) => {
    setVisualThemeState(next)
    localStorage.setItem(VISUAL_THEME_STORAGE_KEY, next)
  }, [])

  const toggle = useCallback(() => {
    setAppearance(resolvedAppearance === 'dark' ? 'light' : 'dark')
  }, [resolvedAppearance, setAppearance])

  const value = useMemo(
    () => ({ appearance, resolvedAppearance, visualTheme, setAppearance, setVisualTheme, toggle }),
    [appearance, resolvedAppearance, visualTheme, setAppearance, setVisualTheme, toggle],
  )

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  )
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}

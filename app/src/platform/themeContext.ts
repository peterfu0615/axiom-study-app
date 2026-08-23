import { createContext } from 'react'
import type { Appearance, ResolvedAppearance, VisualTheme } from './themeModel'

export interface ThemeContextValue {
  appearance: Appearance
  resolvedAppearance: ResolvedAppearance
  visualTheme: VisualTheme
  setAppearance: (appearance: Appearance) => void
  setVisualTheme: (theme: VisualTheme) => void
  toggle: () => void
}

export const ThemeContext = createContext<ThemeContextValue | null>(null)

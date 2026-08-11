import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ThemeProvider } from './platform/theme'
import { readAppearance, resolveAppearance } from './platform/themeModel'
import './index.css'
import App from './App.tsx'

// 在 React 挂载前同步设置主题，避免初始闪烁（FOUC）
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
const previewTheme = import.meta.env.DEV
  ? new URLSearchParams(window.location.search).get('theme')
  : import.meta.env.VITE_UI_APPEARANCE ?? null
const initialTheme: 'light' | 'dark' =
  previewTheme === 'light' || previewTheme === 'dark'
    ? previewTheme
    : resolveAppearance(readAppearance(localStorage), prefersDark ? 'dark' : 'light')
document.documentElement.setAttribute('data-visual-theme', 'axiom')
document.documentElement.setAttribute('data-appearance', initialTheme)
document.documentElement.setAttribute('data-theme', initialTheme)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
)

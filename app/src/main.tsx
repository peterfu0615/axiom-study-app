import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ThemeProvider } from './platform/theme'
import './index.css'
import App from './App.tsx'

// 在 React 挂载前同步设置主题，避免初始闪烁（FOUC）
const storedTheme = localStorage.getItem('axiom.theme') as
  | 'light'
  | 'dark'
  | null
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
const previewTheme = import.meta.env.DEV
  ? new URLSearchParams(window.location.search).get('theme')
  : null
const initialTheme: 'light' | 'dark' =
  previewTheme === 'light' || previewTheme === 'dark'
    ? previewTheme
    : storedTheme ?? (prefersDark ? 'dark' : 'light')
document.documentElement.setAttribute('data-theme', initialTheme)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
)

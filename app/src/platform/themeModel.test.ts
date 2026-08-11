import { describe, expect, it } from 'vitest'
// @ts-expect-error Vitest executes this contract in Node, while the app tsconfig is browser-only.
import { readFileSync } from 'node:fs'
import {
  APPEARANCE_STORAGE_KEY,
  LEGACY_THEME_STORAGE_KEY,
  readAppearance,
  readVisualTheme,
  resolveAppearance,
} from './themeModel'

function memoryStorage(values: Record<string, string> = {}) {
  const data = new Map(Object.entries(values))
  return {
    getItem: (key: string) => data.get(key) ?? null,
    removeItem: (key: string) => data.delete(key),
    setItem: (key: string, value: string) => data.set(key, value),
    value: (key: string) => data.get(key) ?? null,
  }
}

describe('theme foundation', () => {
  it('keeps visual theme separate from appearance resolution', () => {
    const storage = memoryStorage({ 'axiom.visual-theme': 'axiom' })
    expect(readVisualTheme(storage)).toBe('axiom')
    expect(resolveAppearance('system', 'dark')).toBe('dark')
    expect(resolveAppearance('system', 'light')).toBe('light')
    expect(resolveAppearance('dark', 'light')).toBe('dark')
  })

  it('persists explicit appearance and defaults missing values to system', () => {
    expect(readAppearance(memoryStorage())).toBe('system')
    expect(readAppearance(memoryStorage({ [APPEARANCE_STORAGE_KEY]: 'light' }))).toBe('light')
    expect(readAppearance(memoryStorage({ [APPEARANCE_STORAGE_KEY]: 'dark' }))).toBe('dark')
  })

  it('migrates the legacy theme preference without changing its value', () => {
    const storage = memoryStorage({ [LEGACY_THEME_STORAGE_KEY]: 'dark' })
    expect(readAppearance(storage)).toBe('dark')
    expect(storage.value(APPEARANCE_STORAGE_KEY)).toBe('dark')
    expect(storage.value(LEGACY_THEME_STORAGE_KEY)).toBeNull()
  })

  it('rejects corrupt persisted values', () => {
    expect(readAppearance(memoryStorage({ [APPEARANCE_STORAGE_KEY]: 'sepia' }))).toBe('system')
    expect(readVisualTheme(memoryStorage({ 'axiom.visual-theme': 'unknown' }))).toBe('axiom')
  })

  it('defines the semantic token contract required by new feature surfaces', () => {
    const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8')
    const required = [
      'color-bg', 'color-surface', 'color-surface-raised', 'color-surface-muted',
      'color-overlay', 'text-primary', 'text-secondary', 'text-tertiary',
      'text-inverse', 'border-default', 'divider', 'focus-ring', 'accent',
      'accent-hover', 'accent-active', 'accent-foreground', 'success-fg',
      'warning-fg', 'danger-fg', 'info-fg', 'review-again', 'review-hard',
      'review-good', 'review-easy', 'radius-sm', 'shadow-card',
      'elevation-raised', 'space-4', 'type-body-size',
    ]
    required.forEach((token) => expect(css).toContain(`--ax-${token}:`))
    expect(css).toContain(":root[data-theme='dark']")
  })
})

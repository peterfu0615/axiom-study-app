// @ts-expect-error Vitest executes this contract in Node, while the app tsconfig is browser-only.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { VISUAL_THEMES } from './themeModel'

const stylesheet = readFileSync(new URL('../index.css', import.meta.url), 'utf8')

function selectorBlock(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  return stylesheet.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`, 'u'))?.[1] ?? ''
}

function literalColors(block: string) {
  return Object.fromEntries(
    [...block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/gu)]
      .map((match) => [match[1], match[2]]),
  )
}

function luminance(hex: string) {
  const value = Number.parseInt(hex.slice(1), 16)
  const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255]
    .map((channel) => {
      const normalized = channel / 255
      return normalized <= 0.04045
        ? normalized / 12.92
        : ((normalized + 0.055) / 1.055) ** 2.4
    })
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
}

function contrast(foreground: string, background: string) {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
  return (values[0] + 0.05) / (values[1] + 0.05)
}

describe('theme text contrast', () => {
  it.each(['light', 'dark'] as const)('keeps every %s palette at WCAG AA for small UI text', (appearance) => {
    const base = literalColors(selectorBlock(':root'))
    const appearanceColors = appearance === 'dark'
      ? literalColors(selectorBlock(":root[data-theme='dark']"))
      : {}

    for (const theme of VISUAL_THEMES) {
      const themeColors = theme === 'axiom'
        ? {}
        : literalColors(selectorBlock(`:root[data-visual-theme='${theme}'][data-theme='${appearance}']`))
      const colors = { ...base, ...appearanceColors, ...themeColors }
      const pairs = [
        ['primary text', colors.ink, colors.surface],
        ['secondary and tertiary text', colors.muted, colors.surface],
        ['primary button label', colors['ax-primary-control-ink'], colors.brand],
        ['danger text', colors.danger, colors.surface],
        ['page eyebrow', colors['ax-page-eyebrow'], colors.canvas],
      ] as const

      for (const [role, foreground, background] of pairs) {
        expect(
          contrast(foreground, background),
          `${appearance}/${theme}: ${role}`,
        ).toBeGreaterThanOrEqual(4.5)
      }
    }
  })
})

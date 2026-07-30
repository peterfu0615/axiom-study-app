import { describe, expect, it } from 'vitest'
import { normalizeMathMarkdown } from './mathMarkdown'

describe('normalizeMathMarkdown', () => {
  it('keeps valid inline and block formulas unchanged', () => {
    const markdown = String.raw`已知 $\frac{x}{2}=1$

$$\sqrt{x^2+1}$$`
    expect(normalizeMathMarkdown(markdown)).toBe(markdown)
  })

  it('wraps a parenthesized fraction that is missing math delimiters', () => {
    expect(normalizeMathMarkdown(String.raw`A. (\frac{2x+1}{2+5x})`)).toBe(
      String.raw`A. $\frac{2x+1}{2+5x}$`,
    )
  })

  it('keeps nested fractions intact while adding one delimiter pair', () => {
    expect(
      normalizeMathMarkdown(String.raw`（\frac{1}{1+\frac{x}{2}}）`),
    ).toBe(String.raw`$\frac{1}{1+\frac{x}{2}}$`)
  })

  it('normalizes formulas embedded in Chinese text', () => {
    expect(
      normalizeMathMarkdown(String.raw`当（x^2+1=0）时，求根号。`),
    ).toBe(String.raw`当$x^2+1=0$时，求根号。`)
  })

  it('does not alter Chinese prose or ordinary parentheses', () => {
    const prose = '根据题意（见图一），选择正确答案（可多选）。'
    expect(normalizeMathMarkdown(prose)).toBe(prose)
  })

  it('does not normalize formula-like text inside code spans', () => {
    const markdown = '输入 `(\\frac{a}{b})`，而不是公式。'
    expect(normalizeMathMarkdown(markdown)).toBe(markdown)
  })
})

import { describe, expect, it } from 'vitest'
import { normalizeMathMarkdown } from './mathMarkdown'

describe('normalizeMathMarkdown', () => {
  it('keeps valid inline and block formulas unchanged', () => {
    const markdown = String.raw`已知 $\frac{x}{2}=1$

$$\sqrt{x^2+1}$$`
    expect(normalizeMathMarkdown(markdown)).toBe(markdown)
  })

  it('repairs high-confidence OCR damage inside delimited formulas', () => {
    const input = String.raw`密度 $22.42ext{克/厘米}^3$，熔点 $2410\±40^\circ C$。`
    const expected = String.raw`密度 $22.42\text{克/厘米}^3$，熔点 $2410\pm40^\circ C$。`
    expect(normalizeMathMarkdown(input)).toBe(expected)
    expect(normalizeMathMarkdown(expected)).toBe(expected)
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

  it('normalizes \\because and \\therefore into Unicode math symbols', () => {
    expect(normalizeMathMarkdown(String.raw`\because y 的值随 x 的增大而增大，\therefore m > 0`)).toBe(
      '∵ y 的值随 x 的增大而增大，∴ m > 0',
    )
  })

  it('trims leading/trailing spaces inside inline math delimiters', () => {
    expect(normalizeMathMarkdown('利用一次函数 $ y = kx + b $ 的性质 $k > 0 $')).toBe(
      '利用一次函数 $y = kx + b$ 的性质 $k > 0$',
    )
  })

  it('restores literal backslash-n sequences to real line breaks', () => {
    const input = String.raw`解：设 $x=1$。\n\n代入原式，得 $y=2$。`
    expect(normalizeMathMarkdown(input)).toBe('解：设 $x=1$。\n\n代入原式，得 $y=2$。')
  })

  it('keeps LaTeX commands starting with n (like \\neq) untouched', () => {
    const input = String.raw`当 $a\neq b$ 时结论成立，且 a\neq b`
    expect(normalizeMathMarkdown(input)).toBe(input)
  })

  it('wraps bare LaTeX environments in display math delimiters', () => {
    const input = String.raw`由 \begin{cases} -2k+b=0 \\ b=4 \end{cases} 解得 $k=2$`
    expect(normalizeMathMarkdown(input)).toBe(
      String.raw`由 $$\begin{cases} -2k+b=0 \\ b=4 \end{cases}$$ 解得 $k=2$`,
    )
  })

  it('wraps bare left-right groups in inline math delimiters', () => {
    const input = String.raw`点 P 的坐标为 \left(\frac{1}{2}, 5\right)。`
    expect(normalizeMathMarkdown(input)).toBe(
      String.raw`点 P 的坐标为 $\left(\frac{1}{2}, 5\right)$。`,
    )
  })

  it('is idempotent for escaped line breaks, environments and left-right groups', () => {
    const input = String.raw`由 \begin{cases} k=2 \\ b=4 \end{cases} 得坐标 \left(\frac{1}{2}, 5\right)。\n\n综上成立。`
    const once = normalizeMathMarkdown(input)
    expect(normalizeMathMarkdown(once)).toBe(once)
  })

  it('does not touch literal backslash-n or environments inside code spans', () => {
    const markdown = '转义符 `\\n` 与环境 `\\begin{cases}` 保持原样。'
    expect(normalizeMathMarkdown(markdown)).toBe(markdown)
  })

  it('keeps already-wrapped environments inside math spans unchanged', () => {
    const markdown = String.raw`$$\begin{cases} a=1 \\ b=2 \end{cases}$$`
    expect(normalizeMathMarkdown(markdown)).toBe(markdown)
  })

  it('promotes inline math containing block environments to display math', () => {
    // 真实库形态：cases 被包在行内 $…$ 里，应提升为块级公式稳定排版。
    const input = String.raw`$\therefore \begin{cases} -2k + b = 0, \\ b = 4. \end{cases}$`
    expect(normalizeMathMarkdown(input)).toBe(
      String.raw`$$\therefore \begin{cases} -2k + b = 0, \\ b = 4. \end{cases}$$`,
    )
  })

  it('keeps inline math without block environments inline', () => {
    expect(normalizeMathMarkdown(String.raw`直线 $l$ 与 $y = 2x + 4$`)).toBe(
      String.raw`直线 $l$ 与 $y = 2x + 4$`,
    )
  })

  it('wraps bare equation lines conservatively', () => {
    const input = ['已知条件如下', '-2k + b = 0', 'b = 4', '求解析式'].join('\n')
    expect(normalizeMathMarkdown(input)).toBe(
      ['已知条件如下', '$-2k + b = 0$', '$b = 4$', '求解析式'].join('\n'),
    )
  })

  it('does not wrap Chinese prose, markdown lists or plain sentences as equations', () => {
    const markdown = [
      '因为 k 不等于 0，所以成立',
      '- 这是一条包含 = 号的中文列表项',
      'well known fact',
      '# 标题含 a = b',
    ].join('\n')
    expect(normalizeMathMarkdown(markdown)).toBe(markdown)
  })

  it('is idempotent for bare equation line wrapping and inline env promotion', () => {
    const input = [
      String.raw`$\therefore \begin{cases} k = 2, \\ b = 4. \end{cases}$`,
      '-2k + b = 0',
      '解得结果',
    ].join('\n')
    const once = normalizeMathMarkdown(input)
    expect(normalizeMathMarkdown(once)).toBe(once)
  })

  it('normalizes the real solution step content into renderable math', () => {
    // 用户库 solution step1 的真实存储形态（行内 $…$ 含 cases + 真实换行）。
    const input = [
      '设直线 $l$ 所对应的函数表达式为 $y = kx + b$ ($k \\neq 0$).',
      '$\\because$ 直线 $l$ 过点 $A(-2, 0)$ 和 $B(0, 4)$，',
      '$\\therefore \\begin{cases} -2k + b = 0, \\\\ b = 4. \\end{cases}$',
      '解得 $\\begin{cases} k = 2, \\\\ b = 4. \\end{cases}$',
      '$\\therefore$ 直线 $l$ 所对应的函数表达式为 $y = 2x + 4$.',
    ].join('\n')
    const output = normalizeMathMarkdown(input)
    // 行内 cases 提升为 display；其余行内公式保持；无裸花括号泄漏
    expect(output).toContain(
      String.raw`$$\therefore \begin{cases} -2k + b = 0, \\ b = 4. \end{cases}$$`,
    )
    expect(output).toContain('$l$')
    expect(output).toContain('$y = kx + b$')
    expect(normalizeMathMarkdown(output)).toBe(output)
  })
})

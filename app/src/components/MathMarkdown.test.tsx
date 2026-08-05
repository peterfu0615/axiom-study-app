import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MathMarkdown } from './MathMarkdown'

describe('MathMarkdown', () => {
  it('renders inline and block LaTeX as KaTeX instead of source text', () => {
    const html = renderToStaticMarkup(
      <MathMarkdown>
        {String.raw`已知 $\triangle ABC$，$\angle A=30^\circ$，且
$$\frac{x^2}{\sqrt{y}}=1$$`}
      </MathMarkdown>,
    )
    expect(html).toContain('class="katex"')
    expect(html).toContain('class="katex-display"')
    expect(html).toContain('mfrac')
    expect(html).toContain('sqrt')
    expect(html).not.toContain('$\\frac')
  })

  it('normalizes missing delimiters for fraction choices and geometry symbols', () => {
    const html = renderToStaticMarkup(
      <MathMarkdown>
        {String.raw`A. (\frac{2x+1}{2+5x})

B. （\frac{2x-1}{2-5x}）

$\angle A \perp BC$，$\triangle ABC \parallel \triangle DEF$`}
      </MathMarkdown>,
    )
    expect(html.match(/class="katex"/g)?.length).toBeGreaterThanOrEqual(4)
    expect(html.match(/mfrac/g)?.length).toBeGreaterThanOrEqual(2)
    expect(html).not.toContain('(\\frac')
    expect(html).not.toContain('（\\frac')
  })

  it('degrades invalid LaTeX to readable error text instead of throwing', () => {
    const html = renderToStaticMarkup(
      <MathMarkdown>{String.raw`公式 $\badcommandxyz{1}$ 之后的正文仍要可见`}</MathMarkdown>,
    )
    expect(html).toContain('之后的正文仍要可见')
    // strict:'ignore' 下未知命令以红色文本降级呈现，而不是抛出或吞掉
    expect(html).toContain('katex')
    expect(html).toContain('badcommandxyz')
  })

  it('renders escaped line breaks and bare environments from streamed JSON', () => {
    const html = renderToStaticMarkup(
      <MathMarkdown>
        {String.raw`设直线为 $y=kx+b$。\n由 \begin{cases} -2k+b=0 \\ b=4 \end{cases} 解得 $k=2$`}
      </MathMarkdown>,
    )
    expect(html).toContain('katex-display')
    // cases 环境已按方程组渲染（KaTeX 的源码 annotation 不计入泄露）
    expect(html).toContain('mtable')
    // 字面量反斜杠 n 已还原为真实换行（remark-breaks 渲染为 <br/>）
    expect(html).toContain('<br/>')
  })

  it('renders step titles with formulas via inline mode without paragraph wrappers', () => {
    const html = renderToStaticMarkup(
      <MathMarkdown inline>{'求直线 $l$ 所对应的函数表达式'}</MathMarkdown>,
    )
    // 容器是 span 且无 <p>，保证嵌入 <strong> 时保持标题样式
    expect(html.startsWith('<span')).toBe(true)
    expect(html).not.toContain('<p>')
    expect(html).toContain('class="katex"')
    expect(html).not.toContain('$l$')
  })

  it('renders real solution content with inline cases as a display equation system', () => {
    const content = [
      '设直线 $l$ 所对应的函数表达式为 $y = kx + b$ ($k \\neq 0$).',
      '$\\because$ 直线 $l$ 过点 $A(-2, 0)$ 和 $B(0, 4)$，',
      '$\\therefore \\begin{cases} -2k + b = 0, \\\\ b = 4. \\end{cases}$',
      '解得 $\\begin{cases} k = 2, \\\\ b = 4. \\end{cases}$',
      '$\\therefore$ 直线 $l$ 所对应的函数表达式为 $y = 2x + 4$.',
    ].join('\n')
    const html = renderToStaticMarkup(
      <MathMarkdown className="problem-solution-content">{content}</MathMarkdown>,
    )
    // cases 提升为块级后按方程组表格渲染，无 katex 错误、无裸花括号文本泄露
    expect(html).toContain('katex-display')
    expect(html).toContain('mtable')
    expect(html).not.toContain('katex-error')
    expect(html).not.toContain('{ -2k')
  })
})

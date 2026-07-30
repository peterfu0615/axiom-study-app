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
})

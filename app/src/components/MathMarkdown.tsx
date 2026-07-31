import ReactMarkdown from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import remarkMath from 'remark-math'
import remarkBreaks from 'remark-breaks'
import { normalizeMathMarkdown } from '../domain/mathMarkdown'
import 'katex/dist/katex.min.css'

export function MathMarkdown({
  children,
  className,
}: {
  children: string
  className?: string
}) {
  // 块级公式 $$...$$ 换行处理，确保 remark-math 将其正确解析为 katex-display
  const markdown = normalizeMathMarkdown(children || '').replace(
    /\$\$([\s\S]+?)\$\$/g,
    (_match, formula: string) => `\n\n$$\n${formula.trim()}\n$$\n\n`,
  )
  return (
    <div className={className}>
      <ReactMarkdown
        rehypePlugins={[rehypeKatex]}
        remarkPlugins={[remarkMath, remarkBreaks]}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  )
}

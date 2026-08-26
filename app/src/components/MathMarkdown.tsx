import { useMemo, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import remarkMath from 'remark-math'
import remarkBreaks from 'remark-breaks'
import type { PluggableList } from 'unified'
import { normalizeMathMarkdown } from '../domain/mathMarkdown'
import 'katex/dist/katex.min.css'
import './MathMarkdown.css'

// 非法公式降级为可读的错误文本而不是抛错（throwOnError），
// 也不因严格模式拒绝常见 LaTeX 写法（strict），避免原文直接泄露。
const KATEX_OPTIONS = { throwOnError: false, strict: 'ignore' } as const

// 插件数组提为模块常量：每次 render 新建数组会让 react-markdown 的
// 处理器缓存失效，流式/高频渲染时触发整篇重新解析与 KaTeX 排版。
const REHYPE_PLUGINS: PluggableList = [[rehypeKatex, KATEX_OPTIONS]]
const REMARK_PLUGINS: PluggableList = [remarkMath, remarkBreaks]
const INLINE_COMPONENTS = { p: InlineParagraph }

// inline 模式下把段落降级为 span，供步骤标题等行内场景使用
// （避免 <p> 的默认边距与块级换行破坏标题/短语布局）。
function InlineParagraph({ children }: { children?: ReactNode }) {
  return <span>{children}</span>
}

export function MathMarkdown({
  children,
  className,
  inline = false,
}: {
  children: string
  className?: string
  inline?: boolean
}) {
  // 块级公式 $$...$$ 换行处理，确保 remark-math 将其正确解析为 katex-display。
  // 归一化与重排结果按输入缓存，避免流式/高频渲染时重复计算。
  const markdown = useMemo(() => {
    return normalizeMathMarkdown(children || '').replace(
      /\$\$([\s\S]+?)\$\$/g,
      (_match, formula: string) => `\n\n$$\n${formula.trim()}\n$$\n\n`,
    )
  }, [children])
  if (inline) {
    return (
      <span className={className}>
        <ReactMarkdown
          components={INLINE_COMPONENTS}
          rehypePlugins={REHYPE_PLUGINS}
          remarkPlugins={REMARK_PLUGINS}
        >
          {markdown}
        </ReactMarkdown>
      </span>
    )
  }
  return (
    <div className={className}>
      <ReactMarkdown
        rehypePlugins={REHYPE_PLUGINS}
        remarkPlugins={REMARK_PLUGINS}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  )
}

import { sanitizeAIOutputText } from '../../ai/intelligenceParser'

/// 去掉 key_point 首尾的空白/星号/转义反斜杠：AI 可能返回
/// `**用待定系数法**` 或双重转义的 `\*\*…\*\*` 等形态，统一剥到纯文本，
/// 再交给 JSX <strong>关键点：</strong> 拼接，不再依赖 Markdown 星号解析。
export function normalizeKeyPoint(raw: string) {
  return sanitizeAIOutputText(raw)
    .replace(/^[\s*\\]+|[\s*\\]+$/g, '')
    .trim()
}

/// 从已渲染的 Markdown 节点提取可读文本：KaTeX 会把公式同时输出为
/// MathML 可访问层与视觉层，直接取 textContent 会得到重复拼接的乱码
/// （如 `y=kx+by = kx + b`）。这里把每个 `.katex` 还原为其 LaTeX 源
/// （annotation 里的原始 TeX）并用 $/$$ 重新包裹，让文本回到
/// MathMarkdown 后能再次正确渲染，也适合作为 AI 解释的选中上下文。
export function extractReadableMathText(element: Element) {
  const clone = element.cloneNode(true) as Element
  for (const katex of Array.from(clone.querySelectorAll('.katex'))) {
    const tex = (
      katex.querySelector('annotation[encoding="application/x-tex"]')?.textContent ?? ''
    ).trim()
    if (!tex) {
      katex.remove()
      continue
    }
    const isDisplay = katex.parentElement?.classList.contains('katex-display')
    const wrapped = isDisplay ? `$$${tex}$$` : `$${tex}$`
    katex.replaceWith(clone.ownerDocument.createTextNode(` ${wrapped} `))
  }
  return (clone.textContent ?? '').replace(/\s+/g, ' ').trim()
}

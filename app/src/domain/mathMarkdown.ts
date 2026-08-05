const DEFINITE_LATEX_COMMAND =
  /\\(?:d?frac|sqrt|angle|triangle|perp|parallel|overline|underline|vec|overrightarrow|cdot|times|div|pm|leq|geq|neq|approx|infty|sin|cos|tan|log|ln|sum|prod|int|lim|left|right|begin|end|because|therefore|Rightarrow|Leftarrow|Leftrightarrow|rightarrow|leftarrow|to|implies|impliedby)\b/u

const CJK_TEXT = /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/u
const ALGEBRAIC_TOKEN = /[A-Za-z0-9]|[∠△⊥∥]/u
const ALGEBRAIC_OPERATOR = /[=+\-*/<>^_]|≤|≥|≠|≈/u

// 裸露的 LaTeX 环境（未包在 $$ 内）；\end 必须与 \begin 同名。
const MATH_ENVIRONMENT_PATTERN =
  /\\begin\{(cases|aligned|split|array|gathered|equation)\}[\s\S]*?\\end\{\1\}/g
// 裸露的 \left…\right 分组（如 \left(\frac{1}{2}, 5\right)）。
const LEFT_RIGHT_PATTERN = /\\left\s*[([{|.][\s\S]*?\\right\s*[)\]}|.]/g
// 行内 $…$ 中包含块级数学环境（cases/aligned 等）时，整体提升为 $$…$$：
// 行内模式下方程组排版局促且部分 WebView 渲染不稳，块级展示才是正确形态。
const INLINE_BLOCK_ENV_PATTERN =
  /\\begin\{(cases|aligned|split|array|gathered|equation)\}/

function isEscaped(value: string, index: number) {
  let slashCount = 0
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === '\\'; cursor -= 1) {
    slashCount += 1
  }
  return slashCount % 2 === 1
}

function looksLikeUnwrappedMath(value: string) {
  const content = value.trim()
  if (!content || content.includes('\n') || CJK_TEXT.test(content)) return false
  if (DEFINITE_LATEX_COMMAND.test(content)) return true
  return ALGEBRAIC_TOKEN.test(content) && ALGEBRAIC_OPERATOR.test(content)
}

/// 独立成行的裸方程（如 `-2k + b = 0`）保守包上 $…$。
/// 只处理纯文本段内的行：排除 CJK 文本/CJK 标点（不误伤中文）、
/// Markdown 语法行、含未包裹 LaTeX 环境/\left 的行（由既有候选逻辑处理）。
/// 包裹后该行成为 math span，二次调用不会再命中（幂等）。
const BARE_EQUATION_OPERATOR = /[=<>≤≥≠≈]/u
const CJK_PUNCTUATION = /[　-〿＀-￯]/u

function wrapBareEquationLines(value: string) {
  return value
    .split('\n')
    .map((line) => {
      const trimmed = line.trim()
      if (!trimmed || trimmed.length > 120 || trimmed.includes('$') || trimmed.includes('`')) {
        return line
      }
      if (CJK_TEXT.test(trimmed) || CJK_PUNCTUATION.test(trimmed)) return line
      // Markdown 标题/引用/列表/有序列表行不视为方程
      if (/^(#{1,6}\s|>\s?|[-*+]\s|\d+[.)、]\s?)/.test(trimmed)) return line
      // 含 LaTeX 环境或 \left…\right 的行交给下方候选逻辑统一包裹
      if (/\\begin\{|\\end\{|\\left\b|\\right\b/.test(trimmed)) return line
      if (!BARE_EQUATION_OPERATOR.test(trimmed)) return line
      if (!ALGEBRAIC_TOKEN.test(trimmed)) return line
      return line.replace(trimmed, `$${trimmed}$`)
    })
    .join('\n')
}

/// 把括号内形似数学的内容包上 $…$；已是 code/math span 的区域不会进入这里。
function wrapParenthesizedMath(value: string) {
  let output = ''
  let plainStart = 0
  let groupStart = -1
  let opening = ''
  let depth = 0

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    if (depth === 0 && (character === '(' || character === '（')) {
      groupStart = index
      opening = character
      depth = 1
      continue
    }
    if (depth === 0) continue

    if (character === opening) {
      depth += 1
      continue
    }
    const closing = opening === '(' ? ')' : '）'
    if (character !== closing) continue

    depth -= 1
    if (depth !== 0) continue
    const content = value.slice(groupStart + 1, index)
    if (looksLikeUnwrappedMath(content)) {
      output += value.slice(plainStart, groupStart)
      output += `$${content.trim()}$`
      plainStart = index + 1
    }
    groupStart = -1
    opening = ''
  }

  return output + value.slice(plainStart)
}

/// 模型在 JSON 字符串里输出的字面量 `\n`/`\r\n`（反斜杠+n 两个字符）
/// 还原为真实换行。负向前瞻排除 `\neq`、`\nu` 等合法 LaTeX 命令；
/// 还原后文本里不再含字面量 `\n`，因此二次调用结果不变（幂等）。
function restoreEscapedLineBreaks(value: string) {
  return value
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n(?![A-Za-z])/g, '\n')
}

function normalizePlainTextSegment(value: string, leadingChar = '') {
  const text = wrapBareEquationLines(
    restoreEscapedLineBreaks(
      value.replace(/\\because\b/g, '∵').replace(/\\therefore\b/g, '∴'),
    ),
  )

  // 收集裸的数学环境与 \left…\right 分组，包裹后交给括号扫描时跳过，
  // 避免对同一内容二次包裹。
  type WrappedSpan = { start: number; end: number; wrapped: string }
  const candidates: WrappedSpan[] = []
  for (const match of text.matchAll(MATH_ENVIRONMENT_PATTERN)) {
    candidates.push({
      start: match.index,
      end: match.index + match[0].length,
      wrapped: `$$${match[0]}$$`,
    })
  }
  for (const match of text.matchAll(LEFT_RIGHT_PATTERN)) {
    candidates.push({
      start: match.index,
      end: match.index + match[0].length,
      wrapped: `$${match[0]}$`,
    })
  }
  candidates.sort((a, b) => a.start - b.start || a.end - b.end)

  const accepted: WrappedSpan[] = []
  let coveredEnd = 0
  for (const candidate of candidates) {
    if (candidate.start < coveredEnd) continue
    // 前导是 $ 说明已处在数学定界符旁（例如孤立 $$ 被移除后的边界），
    // 再包一层会形成双重包裹。
    const before = candidate.start > 0 ? text[candidate.start - 1] : leadingChar
    if (before === '$') continue
    accepted.push(candidate)
    coveredEnd = candidate.end
  }

  let output = ''
  let cursor = 0
  for (const span of accepted) {
    output += wrapParenthesizedMath(text.slice(cursor, span.start))
    output += span.wrapped
    cursor = span.end
  }
  return output + wrapParenthesizedMath(text.slice(cursor))
}

/**
 * Repairs conservative, high-confidence cases where a model emitted LaTeX
 * without Markdown math delimiters. Existing math and code spans are copied
 * verbatim so the normalization is idempotent.
 */
export function normalizeMathMarkdown(markdown: string) {
  let output = ''
  let plainStart = 0
  let index = 0

  const flushPlainText = (end: number) => {
    output += normalizePlainTextSegment(
      markdown.slice(plainStart, end),
      markdown[plainStart - 1] ?? '',
    )
  }

  while (index < markdown.length) {
    if (markdown[index] === '`' && !isEscaped(markdown, index)) {
      flushPlainText(index)
      let delimiterLength = 1
      while (markdown[index + delimiterLength] === '`') delimiterLength += 1
      const delimiter = '`'.repeat(delimiterLength)
      const end = markdown.indexOf(delimiter, index + delimiterLength)
      const spanEnd = end < 0 ? markdown.length : end + delimiterLength
      output += markdown.slice(index, spanEnd)
      index = spanEnd
      plainStart = spanEnd
      continue
    }

    if (markdown[index] === '$' && !isEscaped(markdown, index)) {
      flushPlainText(index)
      const isDisplayMode = markdown[index + 1] === '$'
      const delimiter = isDisplayMode ? '$$' : '$'
      let end = index + delimiter.length
      let found = false
      while (end < markdown.length) {
        const match = markdown.indexOf(delimiter, end)
        if (match < 0) {
          break
        }
        if (!isEscaped(markdown, match)) {
          end = match + delimiter.length
          found = true
          break
        }
        end = match + delimiter.length
      }

      if (!found) {
        // 找不到配对的 $/``，移除孤立的 $ 符号，防止 $ 暴露
        index += delimiter.length
        plainStart = index
        continue
      }

      const mathSpan = markdown.slice(index, end)
      if (isDisplayMode) {
        output += mathSpan
      } else {
        // 对于单 $ 的行内公式，去除内部紧贴 $ 的首尾空格（避免 remark-math 校验失败导致无法渲染）
        const inner = mathSpan.slice(1, -1).trim()
        if (!inner) {
          output += mathSpan
        } else if (INLINE_BLOCK_ENV_PATTERN.test(inner)) {
          // 含块级环境的行内公式提升为 display math（幂等：提升后走 $$ 分支原样复制）
          output += `$$${inner}$$`
        } else {
          output += `$${inner}$`
        }
      }

      index = end
      plainStart = end
      continue
    }

    index += 1
  }

  flushPlainText(markdown.length)
  return output
}

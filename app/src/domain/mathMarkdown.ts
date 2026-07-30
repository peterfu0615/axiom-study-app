const DEFINITE_LATEX_COMMAND =
  /\\(?:d?frac|sqrt|angle|triangle|perp|parallel|overline|underline|vec|overrightarrow|cdot|times|div|pm|leq|geq|neq|approx|infty|sin|cos|tan|log|ln|sum|prod|int|lim|left|right|begin|end)\b/u

const CJK_TEXT = /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/u
const ALGEBRAIC_TOKEN = /[A-Za-z0-9]|[∠△⊥∥]/u
const ALGEBRAIC_OPERATOR = /[=+\-*/<>^_]|≤|≥|≠|≈/u

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

function normalizePlainTextSegment(value: string) {
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
    output += normalizePlainTextSegment(markdown.slice(plainStart, end))
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
      const delimiter = markdown[index + 1] === '$' ? '$$' : '$'
      let end = index + delimiter.length
      while (end < markdown.length) {
        const match = markdown.indexOf(delimiter, end)
        if (match < 0) {
          end = markdown.length
          break
        }
        if (!isEscaped(markdown, match)) {
          end = match + delimiter.length
          break
        }
        end = match + delimiter.length
      }
      output += markdown.slice(index, end)
      index = end
      plainStart = end
      continue
    }

    index += 1
  }

  flushPlainText(markdown.length)
  return output
}

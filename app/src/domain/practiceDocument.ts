import type { PracticeItem, PracticeSet } from './practice'
import { normalizeMathMarkdown } from './mathMarkdown'

export const PRACTICE_LAYOUT_VERSION = 'practice-a4-v3'
export const A4_POINTS = { width: 595.28, height: 841.89 } as const

export type PracticeDocumentType = 'questions' | 'answer_sheet' | 'solutions'
export type PracticeSectionKind = 'exercise' | 'answer_sheet' | 'solution'

export type PracticeInlineContent =
  | { kind: 'text'; text: string }
  | { kind: 'inlineMath'; latex: string }

export type PracticeContentBlock =
  | { kind: 'paragraph'; content: PracticeInlineContent[] }
  | { kind: 'displayMath'; latex: string }
  | { kind: 'image'; path: string; alt: string; purpose: 'source' | 'diagram' }
  | { kind: 'tikzDiagram'; path: string; diagramId: string | null; alt: string }
  | { kind: 'list'; ordered: boolean; items: PracticeInlineContent[][] }
  | { kind: 'answerSpace'; practiceItemId: string; lineCount: number; minimumHeightPoints: number }
  | { kind: 'pageBreak'; reason: 'cover_to_body' | 'section' }
  | {
    kind: 'sectionCover'
    section: PracticeSectionKind
    brand: 'Axiom'
    title: string
    subtitle: string
    dateLabel: string
    itemCount: number
  }
  | {
    kind: 'question'
    practiceItemId: string
    displayNumber: number
    content: PracticeContentBlock[]
  }

export interface StructuredPracticeSection {
  kind: PracticeSectionKind
  title: string
  blocks: PracticeContentBlock[]
}

export interface CompletePracticeDocument {
  id: string
  practiceSetId: string
  attemptId: string
  documentType: 'complete'
  title: string
  metadata: { subject: string; createdAt: number; itemCount: number; strategy: string; sessionMode: string; maxDurationSeconds: number }
  layout: { version: typeof PRACTICE_LAYOUT_VERSION; pageSize: 'A4'; widthPoints: number; heightPoints: number; marginPoints: number }
  sections: StructuredPracticeSection[]
}

export interface DocumentRect { x: number; y: number; width: number; height: number }
export interface PracticeAnswerRegion extends DocumentRect {
  id: string
  practiceItemId: string
  regionIndex: number
}
export interface PracticeDocumentQuestion {
  practiceItemId: string
  displayNumber: number
  statementMarkdown: string
  options: string[] | null
  difficulty: PracticeItem['difficulty']
  diagramIds: string[]
  diagramImagePaths: string[]
  answerAreaPolicy: { lineCount: number; minimumHeightPoints: number }
  canonicalAnswer?: string
  solutionMarkdown?: string
}
export interface PracticeDocumentPage {
  id: string
  pageIndex: number
  pageIdentity: string
  qrPayload: string
  markerRects: DocumentRect[]
  questions: Array<PracticeDocumentQuestion & { frame: DocumentRect }>
  answerRegions: PracticeAnswerRegion[]
}
export interface PracticeDocument {
  id: string
  practiceSetId: string
  attemptId: string
  documentType: PracticeDocumentType
  title: string
  metadata: { subject: string; createdAt: number; itemCount: number; strategy: string }
  layout: { version: typeof PRACTICE_LAYOUT_VERSION; pageSize: 'A4'; widthPoints: number; heightPoints: number; marginPoints: number }
  sections: Array<{ kind: 'questions' | 'answer_sheet' | 'solutions'; title: string }>
  pages: PracticeDocumentPage[]
}

const margin = 42
const headerHeight = 70
const footerHeight = 28
const contentWidth = A4_POINTS.width - margin * 2
const availableBottom = A4_POINTS.height - footerHeight - margin

function solutionMarkdown(item: PracticeItem) {
  try {
    const solution = JSON.parse(item.solutionJson) as { contentMarkdown?: string; steps?: Array<{ content?: string; contentMarkdown?: string; content_markdown?: string }> }
    return solution.contentMarkdown || solution.steps?.map((step) => step.content ?? step.contentMarkdown ?? step.content_markdown ?? '').filter(Boolean).join('\n\n') || ''
  } catch { return '' }
}

function solutionContent(item: PracticeItem): PracticeContentBlock[] {
  const answer = item.canonicalAnswer.trim()
  const solution = solutionMarkdown(item).trim()
  if (!answer && !solution) {
    return [{ kind: 'paragraph', content: [{ kind: 'text', text: '当前题目的答案与解析暂不可用。' }] }]
  }
  return [
    ...(answer ? [{ kind: 'paragraph' as const, content: [{ kind: 'text' as const, text: '答案：' }, ...parsePracticeInlineContent(answer)] }] : []),
    ...(solution ? parsePracticeMarkdown(solution) : [{ kind: 'paragraph' as const, content: [{ kind: 'text' as const, text: '详细解析暂不可用。' }] }]),
  ]
}

function readBalancedGroup(value: string, openIndex: number) {
  if (value[openIndex] !== '{') return { text: '', end: openIndex }
  let depth = 0
  for (let index = openIndex; index < value.length; index += 1) {
    if (value[index] === '{') depth += 1
    if (value[index] === '}') {
      depth -= 1
      if (depth === 0) return { text: value.slice(openIndex + 1, index), end: index }
    }
  }
  return { text: value.slice(openIndex + 1), end: value.length - 1 }
}

const visibleSymbolCommands = new Set([
  'angle', 'circ', 'perp', 'parallel', 'cdot', 'times', 'div', 'pm', 'leq', 'geq',
  'neq', 'approx', 'infty', 'sin', 'cos', 'tan', 'log', 'ln', 'sum', 'prod', 'int',
  'lim', 'therefore', 'because', 'Rightarrow', 'Leftarrow', 'Leftrightarrow',
  'rightarrow', 'leftarrow', 'to', 'implies', 'impliedby',
])

/**
 * Estimate the amount of visible handwriting, not the raw TeX source length.
 * This intentionally remains a small monotone estimator rather than trying to
 * duplicate a TeX layout engine. It is shared by document construction and
 * the legacy normalized document adapter.
 */
export function estimateVisibleWritingUnits(markdown: string): number {
  let units = 0
  const visit = (value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      const character = value[index]
      if (character === '\n' || character === '\r') { units += 10; continue }
      if (character === '$' || character === '`' || character === '{' || character === '}') continue
      if (character === '\\') {
        if (value[index + 1] === '\\') { units += 10; index += 1; continue }
        const command = value.slice(index + 1).match(/^[A-Za-z]+/u)?.[0] ?? ''
        if (!command) { units += .45; continue }
        index += command.length
        let cursor = index + 1
        while (value[cursor] === ' ') cursor += 1
        if (command === 'frac') {
          const numerator = readBalancedGroup(value, cursor)
          const denominator = readBalancedGroup(value, numerator.end + 1)
          visit(numerator.text); visit(denominator.text); units += 1.5
          index = denominator.end
        } else if (command === 'sqrt') {
          if (value[cursor] === '[') {
            const optionEnd = value.indexOf(']', cursor + 1)
            cursor = optionEnd >= 0 ? optionEnd + 1 : cursor
          }
          const radicand = readBalancedGroup(value, cursor)
          visit(radicand.text); units += 1; index = radicand.end
        } else if (command === 'text' || command === 'textrm' || command === 'textnormal') {
          const text = readBalancedGroup(value, cursor)
          visit(text.text); index = text.end
        } else if (command === 'left' || command === 'right' || command === 'mathrm' || command === 'mathbf' || command === 'mathit') {
          const next = value[cursor]
          if (next && !/[A-Za-z0-9\\]/u.test(next)) units += .45
        } else {
          units += visibleSymbolCommands.has(command) ? 1 : 1
        }
        continue
      }
      if (/[\u3400-\u9fff]/u.test(character)) units += 1
      else if (/[A-Za-z0-9]/u.test(character)) units += .7
      else if (/\s/u.test(character)) continue
      else units += .45
    }
  }
  visit(markdown.replace(/```[\s\S]*?```/gu, ''))
  return Math.max(0, units)
}

function solutionDetails(item: PracticeItem) {
  try {
    const solution = JSON.parse(item.solutionJson) as {
      contentMarkdown?: string
      steps?: Array<{ content?: string; contentMarkdown?: string; content_markdown?: string }>
    }
    const steps = solution.steps?.map((step) => step.content ?? step.contentMarkdown ?? step.content_markdown ?? '').filter(Boolean) ?? []
    if (steps.length) return { units: steps.reduce((sum, step) => sum + estimateVisibleWritingUnits(step), 0), stepCount: steps.length }
    return { units: estimateVisibleWritingUnits(solution.contentMarkdown ?? ''), stepCount: 0 }
  } catch { return { units: 0, stepCount: 0 } }
}

export function answerPolicy(item: PracticeItem, mode: PracticeSet['sessionMode'] = 'standard', answerSheet = false) {
  const answerUnits = estimateVisibleWritingUnits(item.canonicalAnswer)
  const solution = solutionDetails(item)
  const proofLike = /证明|求证|证明题|prove/iu.test(`${item.statementMarkdown}\n${item.gradingRubric?.criteria?.join(' ') ?? ''}`)
  const rawHeight = 58 + answerUnits * .75 + Math.min(solution.units, 360) * .20
    + Math.min(Math.max(solution.stepCount - 1, 0), 7) * 12 + (proofLike ? 24 : 0)
  const modeHeight = answerSheet ? Math.max(112, rawHeight * .8) : mode === 'quick' ? rawHeight * .68 : rawHeight
  const minimum = answerSheet ? 112 : mode === 'quick' ? 58 : 76
  const maximum = answerSheet ? 180 : mode === 'quick' ? 128 : 220
  const height = Math.round(Math.min(maximum, Math.max(minimum, item.options?.length && !answerSheet ? Math.min(88, modeHeight) : modeHeight)) * 100) / 100
  return { minimumHeightPoints: height, lineCount: Math.min(12, Math.max(3, Math.floor((height - 24) / 16))) }
}

const DEFINITE_LATEX_COMMAND =
  /\\(?:d?frac|sqrt|angle|triangle|perp|parallel|overline|underline|vec|overrightarrow|cdot|times|div|pm|leq|geq|neq|approx|infty|sin|cos|tan|log|ln|sum|prod|int|lim|left|right|begin|end|because|therefore|Rightarrow|Leftarrow|Leftrightarrow|rightarrow|leftarrow|to|implies|impliedby|circ)\b/u
const MATH_CANDIDATE = /[A-Za-z0-9\\{}()[\].,+\-*/=<>^_\s]+/gu
const MATH_OPERATOR = /[=+\-*/<>^]|≤|≥|≠|≈/u
const MATH_SUBSCRIPT = /_(?:[A-Za-z0-9]|\{)/u
const ANSWER_BLANK = /_{2,}/u

function appendText(content: PracticeInlineContent[], text: string) {
  if (!text) return
  const previous = content.at(-1)
  if (previous?.kind === 'text') previous.text += text
  else content.push({ kind: 'text', text })
}

function splitPlainPrintableContent(value: string): PracticeInlineContent[] {
  const content: PracticeInlineContent[] = []
  let cursor = 0
  const protectedValue = value.replace(
    /\\(?:text|textrm|textnormal)\{[^{}]*\}/gu,
    (group) => group.replace(/[\u3400-\u9fff]/gu, 'T'),
  )
  for (const match of protectedValue.matchAll(MATH_CANDIDATE)) {
    const protectedRaw = match[0]
    const start = match.index
    const raw = value.slice(start, start + protectedRaw.length)
    const candidate = raw.trim()
    const mathLike = !ANSWER_BLANK.test(candidate) && (
      DEFINITE_LATEX_COMMAND.test(candidate)
      || ((MATH_OPERATOR.test(candidate) || MATH_SUBSCRIPT.test(candidate)) && /[A-Za-z0-9]/u.test(candidate))
    )
    if (!candidate || !mathLike) continue
    appendText(content, value.slice(cursor, start))
    const leading = raw.length - raw.trimStart().length
    const trailing = raw.length - raw.trimEnd().length
    appendText(content, raw.slice(0, leading))
    content.push({ kind: 'inlineMath', latex: candidate })
    appendText(content, trailing ? raw.slice(raw.length - trailing) : '')
    cursor = start + raw.length
  }
  appendText(content, value.slice(cursor))
  return content
}

export function parsePracticeInlineContent(markdown: string): PracticeInlineContent[] {
  const normalized = normalizeMathMarkdown(markdown)
  const content: PracticeInlineContent[] = []
  let cursor = 0
  while (cursor < normalized.length) {
    const index = normalized.indexOf('$', cursor)
    if (index < 0) break
    const delimiter = normalized[index + 1] === '$' ? '$$' : '$'
    const end = normalized.indexOf(delimiter, index + delimiter.length)
    if (end < 0) break
    splitPlainPrintableContent(normalized.slice(cursor, index)).forEach((item) => {
      if (item.kind === 'text') appendText(content, item.text)
      else content.push(item)
    })
    const latex = normalized.slice(index + delimiter.length, end).trim()
    if (latex) {
      if (ANSWER_BLANK.test(latex)) appendText(content, latex)
      else content.push({ kind: 'inlineMath', latex })
    }
    cursor = end + delimiter.length
  }
  splitPlainPrintableContent(normalized.slice(cursor)).forEach((item) => {
    if (item.kind === 'text') appendText(content, item.text)
    else content.push(item)
  })
  return content
}

export function parsePracticeMarkdown(markdown: string): PracticeContentBlock[] {
  const normalized = normalizeMathMarkdown(markdown).replace(/\r\n?/g, '\n')
  const lines = normalized.split('\n')
  const blocks: PracticeContentBlock[] = []
  let paragraph: string[] = []
  const flushParagraph = () => {
    const value = paragraph.join(' ').trim().replace(/^#{1,6}\s+/u, '').replace(/\*\*/g, '')
    if (value) blocks.push({ kind: 'paragraph', content: parsePracticeInlineContent(value) })
    paragraph = []
  }
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim()
    if (!trimmed) { flushParagraph(); continue }
    if (trimmed.startsWith('$$')) {
      flushParagraph()
      const formula: string[] = []
      let current = trimmed.slice(2)
      if (current.endsWith('$$')) {
        current = current.slice(0, -2)
      } else {
        if (current) formula.push(current)
        while (++index < lines.length) {
          const line = lines[index]
          const end = line.indexOf('$$')
          if (end >= 0) { formula.push(line.slice(0, end)); break }
          formula.push(line)
        }
        current = ''
      }
      const latex = [...formula, current].filter(Boolean).join('\n').trim()
      if (latex) blocks.push({ kind: 'displayMath', latex })
      continue
    }
    const list = trimmed.match(/^([-*+] |\d+[.)、]\s*)(.+)$/u)
    if (list) {
      flushParagraph()
      const ordered = /^\d/u.test(trimmed)
      const items = [parsePracticeInlineContent(list[2])]
      while (index + 1 < lines.length) {
        const next = lines[index + 1].trim().match(/^([-*+] |\d+[.)、]\s*)(.+)$/u)
        if (!next || /^\d/u.test(lines[index + 1].trim()) !== ordered) break
        items.push(parsePracticeInlineContent(next[2])); index += 1
      }
      blocks.push({ kind: 'list', ordered, items })
      continue
    }
    paragraph.push(trimmed)
  }
  flushParagraph()
  return blocks
}

function printableImages(item: PracticeItem): PracticeContentBlock[] {
  return item.diagramImagePaths.map((path, index): PracticeContentBlock =>
    path.toLowerCase().endsWith('.svg')
      ? { kind: 'tikzDiagram', path, diagramId: item.diagramIds[index] ?? null, alt: `第 ${item.orderIndex + 1} 题矢量图形` }
      : { kind: 'image', path, alt: `第 ${item.orderIndex + 1} 题图形`, purpose: 'diagram' })
}

function sectionCover(section: PracticeSectionKind, practiceSet: PracticeSet, createdAt: number): PracticeContentBlock {
  const mode = practiceSet.sessionMode ?? 'standard'
  const settings = practiceSet.sessionSettings
  const title = section === 'exercise' ? `${practiceSet.subject}练习` : section === 'answer_sheet' ? '统一答题页' : '答案与解析'
  const subtitle = section === 'exercise'
    ? mode === 'quick' ? '快速复习 · 建议 5–10 分钟内完成。'
      : mode === 'mock_test' ? `模拟测试 · 限时 ${Math.ceil((settings?.maxDurationSeconds ?? 3600) / 60)} 分钟。`
        : ''
    : section === 'answer_sheet' ? '请按题号在对应区域内完整作答。' : '完成练习后再查看。'
  return {
    kind: 'sectionCover', section, brand: 'Axiom', title, subtitle,
    dateLabel: section === 'exercise'
      ? new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Shanghai' }).format(createdAt)
      : section === 'answer_sheet' ? `${practiceSet.items.length} 题` : practiceSet.subject,
    itemCount: practiceSet.items.length,
  }
}

function questionBlock(item: PracticeItem, section: PracticeSectionKind, practiceSet: PracticeSet): PracticeContentBlock {
  const mode = practiceSet.sessionMode ?? 'standard'
  const content = section === 'answer_sheet' ? [
      { kind: 'paragraph' as const, content: [{ kind: 'text' as const, text: `第 ${item.orderIndex + 1} 题作答区` }] },
      { kind: 'answerSpace' as const, practiceItemId: item.id, ...answerPolicy(item, mode, true) },
    ] : [
      ...(item.sourceType === 'generated_variant'
        ? [{ kind: 'paragraph' as const, content: [{ kind: 'text' as const, text: 'AI 变式题' }] }]
        : []),
      ...parsePracticeMarkdown(item.statementMarkdown),
      ...(item.options?.length ? [{ kind: 'list' as const, ordered: false, items: item.options.map((option, index) => parsePracticeInlineContent(`${String.fromCharCode(65 + index)}. ${option}`)) }] : []),
      ...printableImages(item),
      ...(section === 'exercise'
        ? mode === 'mock_test' ? [] : [{ kind: 'answerSpace' as const, practiceItemId: item.id, ...answerPolicy(item, mode) }]
        : solutionContent(item)),
    ]
  return { kind: 'question', practiceItemId: item.id, displayNumber: item.orderIndex + 1, content }
}

export function buildCompletePracticeDocument(practiceSet: PracticeSet, input: {
  attemptId: string
  generatedAt?: number
}): CompletePracticeDocument {
  const createdAt = input.generatedAt ?? Date.now()
  const id = `${practiceSet.id}:${input.attemptId}:complete:${PRACTICE_LAYOUT_VERSION}`
  const section = (kind: PracticeSectionKind, title: string): StructuredPracticeSection => ({
    kind,
    title,
    blocks: [
      sectionCover(kind, practiceSet, createdAt),
      { kind: 'pageBreak', reason: 'cover_to_body' },
      ...practiceSet.items.map((item) => questionBlock(item, kind, practiceSet)),
    ],
  })
  return {
    id, practiceSetId: practiceSet.id, attemptId: input.attemptId, documentType: 'complete',
    title: `Axiom ${practiceSet.subject}练习`,
    metadata: {
      subject: practiceSet.subject, createdAt, itemCount: practiceSet.items.length, strategy: practiceSet.strategy,
      sessionMode: practiceSet.sessionMode ?? 'standard', maxDurationSeconds: practiceSet.sessionSettings?.maxDurationSeconds ?? 0,
    },
    layout: { version: PRACTICE_LAYOUT_VERSION, pageSize: 'A4', widthPoints: A4_POINTS.width, heightPoints: A4_POINTS.height, marginPoints: margin },
    sections: [
      section('exercise', '练习'),
      ...(practiceSet.sessionMode === 'mock_test' || practiceSet.sessionSettings?.includeAnswerSheet
        ? [section('answer_sheet', '统一答题页')]
        : []),
      section('solution', '答案与解析'),
    ],
  }
}

function questionHeight(item: PracticeItem, type: PracticeDocumentType) {
  if (type === 'answer_sheet') return answerPolicy(item).minimumHeightPoints + 34
  const textLines = Math.max(2, Math.ceil(item.statementMarkdown.length / 34))
  const optionLines = item.options?.length ?? 0
  const imageHeight = item.questionImagePath || item.diagramImagePaths.length || item.diagramIds.length ? 110 : 0
  const solutionHeight = type === 'solutions' ? Math.max(56, Math.ceil((item.canonicalAnswer.length + solutionMarkdown(item).length) / 38) * 15) : 0
  return 44 + textLines * 18 + optionLines * 18 + imageHeight + solutionHeight
}

function qrPayload(setId: string, attemptId: string, documentId: string, pageIndex: number) {
  return `AXIOM|layout=${PRACTICE_LAYOUT_VERSION}|set=${setId}|attempt=${attemptId}|document=${documentId}|page=${pageIndex}`
}

function markers(): DocumentRect[] {
  const size = 11
  return [
    { x: margin - 18, y: margin - 18, width: size, height: size },
    { x: A4_POINTS.width - margin + 7, y: margin - 18, width: size, height: size },
    { x: margin - 18, y: A4_POINTS.height - margin + 7, width: size, height: size },
    { x: A4_POINTS.width - margin + 7, y: A4_POINTS.height - margin + 7, width: size, height: size },
  ]
}

export function buildPracticeDocument(practiceSet: PracticeSet, input: {
  attemptId: string
  documentType: PracticeDocumentType
  generatedAt?: number
}): PracticeDocument {
  const id = `${practiceSet.id}:${input.attemptId}:${input.documentType}:${PRACTICE_LAYOUT_VERSION}`
  const pages: PracticeDocumentPage[] = []
  let pageIndex = -1
  let cursorY = margin + headerHeight
  const newPage = () => {
    pageIndex += 1; cursorY = margin + headerHeight
    pages.push({
      id: `${id}:page:${pageIndex}`, pageIndex,
      pageIdentity: `${id}:page:${pageIndex}`,
      qrPayload: qrPayload(practiceSet.id, input.attemptId, id, pageIndex),
      markerRects: markers(), questions: [], answerRegions: [],
    })
  }
  newPage()
  practiceSet.items.forEach((item) => {
    const height = questionHeight(item, input.documentType)
    if (cursorY + height > availableBottom && pages[pageIndex].questions.length) newPage()
    const frame = { x: margin, y: cursorY, width: contentWidth, height: Math.min(height, availableBottom - cursorY) }
    const question: PracticeDocumentQuestion & { frame: DocumentRect } = {
      practiceItemId: item.id, displayNumber: item.orderIndex + 1,
      statementMarkdown: item.statementMarkdown, options: item.options, difficulty: item.difficulty,
      diagramIds: item.diagramIds, diagramImagePaths: item.diagramImagePaths,
      answerAreaPolicy: answerPolicy(item), frame,
      ...(input.documentType === 'solutions' ? { canonicalAnswer: item.canonicalAnswer, solutionMarkdown: solutionMarkdown(item) } : {}),
    }
    pages[pageIndex].questions.push(question)
    if (input.documentType === 'answer_sheet') {
      const region = { x: frame.x + 4, y: frame.y + 28, width: frame.width - 8, height: frame.height - 34 }
      pages[pageIndex].answerRegions.push({
        id: `${pages[pageIndex].id}:answer:${item.id}:0`, practiceItemId: item.id, regionIndex: 0,
        x: region.x / A4_POINTS.width, y: region.y / A4_POINTS.height,
        width: region.width / A4_POINTS.width, height: region.height / A4_POINTS.height,
      })
    }
    cursorY += frame.height + 12
  })
  return {
    id, practiceSetId: practiceSet.id, attemptId: input.attemptId, documentType: input.documentType,
    title: input.documentType === 'questions' ? 'Axiom 针对性练习' : input.documentType === 'answer_sheet' ? 'Axiom 答题卡' : 'Axiom 练习答案与解析',
    metadata: { subject: practiceSet.subject, createdAt: input.generatedAt ?? Date.now(), itemCount: practiceSet.items.length, strategy: practiceSet.strategy },
    layout: { version: PRACTICE_LAYOUT_VERSION, pageSize: 'A4', widthPoints: A4_POINTS.width, heightPoints: A4_POINTS.height, marginPoints: margin },
    sections: [{ kind: input.documentType, title: input.documentType === 'questions' ? '练习题' : input.documentType === 'answer_sheet' ? '答题区域' : '答案与解析' }],
    pages,
  }
}

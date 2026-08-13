import type { PracticeItem, PracticeSet } from './practice'
import { normalizeMathMarkdown } from './mathMarkdown'

export const PRACTICE_LAYOUT_VERSION = 'practice-a4-v1'
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
  metadata: { subject: string; createdAt: number; itemCount: number; strategy: string }
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

function answerPolicy(item: PracticeItem) {
  const lineCount = item.difficulty === 'advanced' ? 8 : item.difficulty === 'intermediate' ? 6 : 4
  return { lineCount, minimumHeightPoints: lineCount * 18 + 16 }
}

const DEFINITE_LATEX_COMMAND =
  /\\(?:d?frac|sqrt|angle|triangle|perp|parallel|overline|underline|vec|overrightarrow|cdot|times|div|pm|leq|geq|neq|approx|infty|sin|cos|tan|log|ln|sum|prod|int|lim|left|right|begin|end|because|therefore|Rightarrow|Leftarrow|Leftrightarrow|rightarrow|leftarrow|to|implies|impliedby|circ)\b/u
const MATH_CANDIDATE = /[A-Za-z0-9\\{}()[\].,+\-*/=<>^_\s]+/gu
const MATH_OPERATOR = /[=+\-*/<>^_]|≤|≥|≠|≈/u

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
    const mathLike = DEFINITE_LATEX_COMMAND.test(candidate)
      || (MATH_OPERATOR.test(candidate) && /[A-Za-z0-9]/u.test(candidate))
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
    if (latex) content.push({ kind: 'inlineMath', latex })
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
  const diagrams = item.diagramImagePaths.map((path, index): PracticeContentBlock =>
    path.toLowerCase().endsWith('.svg')
      ? { kind: 'tikzDiagram', path, diagramId: item.diagramIds[index] ?? null, alt: `第 ${item.orderIndex + 1} 题矢量图形` }
      : { kind: 'image', path, alt: `第 ${item.orderIndex + 1} 题图形`, purpose: 'diagram' })
  if (diagrams.length || !item.questionImagePath) return diagrams
  return [{ kind: 'image', path: item.questionImagePath, alt: `第 ${item.orderIndex + 1} 题原图`, purpose: 'source' }]
}

function sectionCover(section: PracticeSectionKind, practiceSet: PracticeSet, createdAt: number): PracticeContentBlock {
  const title = section === 'exercise' ? `${practiceSet.subject}练习` : section === 'answer_sheet' ? '答题卡' : '答案与解析'
  const subtitle = section === 'exercise' ? `${practiceSet.items.length} 题` : section === 'answer_sheet'
    ? '完成练习后，在对应区域作答并提交至 Axiom。' : `完成练习后再查看。\n${practiceSet.subject} · ${practiceSet.items.length} 题`
  return {
    kind: 'sectionCover', section, brand: 'Axiom', title, subtitle,
    dateLabel: new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Shanghai' }).format(createdAt),
    itemCount: practiceSet.items.length,
  }
}

function questionBlock(item: PracticeItem, section: PracticeSectionKind): PracticeContentBlock {
  const content = section === 'answer_sheet'
    ? [{ kind: 'answerSpace' as const, practiceItemId: item.id, ...answerPolicy(item) }]
    : [
      ...parsePracticeMarkdown(item.statementMarkdown),
      ...(item.options?.length ? [{ kind: 'list' as const, ordered: false, items: item.options.map((option, index) => parsePracticeInlineContent(`${String.fromCharCode(65 + index)}. ${option}`)) }] : []),
      ...printableImages(item),
      ...(section === 'exercise' ? [{ kind: 'answerSpace' as const, practiceItemId: item.id, ...answerPolicy(item) }] : [
        { kind: 'paragraph' as const, content: [{ kind: 'text' as const, text: '答案：' }, ...parsePracticeInlineContent(item.canonicalAnswer)] },
        ...parsePracticeMarkdown(solutionMarkdown(item)),
      ]),
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
      ...practiceSet.items.map((item) => questionBlock(item, kind)),
    ],
  })
  return {
    id, practiceSetId: practiceSet.id, attemptId: input.attemptId, documentType: 'complete',
    title: `Axiom ${practiceSet.subject}练习`,
    metadata: { subject: practiceSet.subject, createdAt, itemCount: practiceSet.items.length, strategy: practiceSet.strategy },
    layout: { version: PRACTICE_LAYOUT_VERSION, pageSize: 'A4', widthPoints: A4_POINTS.width, heightPoints: A4_POINTS.height, marginPoints: margin },
    sections: [section('exercise', '练习'), section('answer_sheet', '答题卡'), section('solution', '答案与解析')],
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

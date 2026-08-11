import type { PracticeItem, PracticeSet } from './practice'

export const PRACTICE_LAYOUT_VERSION = 'practice-a4-v1'
export const A4_POINTS = { width: 595.28, height: 841.89 } as const

export type PracticeDocumentType = 'questions' | 'answer_sheet' | 'solutions'

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

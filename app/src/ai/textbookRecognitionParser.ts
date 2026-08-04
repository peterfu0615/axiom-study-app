import type { ErrorObject } from 'ajv'
import validateTextbookRecognition from './generated/textbookRecognitionValidator.js'
import {
  normalizeTagName,
  type TextbookChapterRecognition,
  type TextbookKnowledgePointRecognition,
  type TextbookMetadataField,
  type TextbookRecognition,
} from '../domain/horizon'

export class TextbookRecognitionParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TextbookRecognitionParseError'
  }
}

function schemaErrorMessage(errors: ErrorObject[] | null | undefined) {
  return (errors ?? [])
    .slice(0, 4)
    .map((error) => `${error.instancePath || '/'} ${error.message ?? '无效'}`)
    .join('；')
}

function extractJSONObject(value: string) {
  const trimmed = value.trim().replace(/^```(?:json)?\s*|\s*```$/giu, '')
  const start = trimmed.indexOf('{')
  if (start < 0) throw new TextbookRecognitionParseError('教材识别结果中没有 JSON 对象')
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < trimmed.length; index += 1) {
    const character = trimmed[index]
    if (inString) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') inString = false
      continue
    }
    if (character === '"') inString = true
    else if (character === '{') depth += 1
    else if (character === '}') {
      depth -= 1
      if (depth === 0) return trimmed.slice(start, index + 1)
    }
  }
  throw new TextbookRecognitionParseError('教材识别 JSON 不完整')
}

function field(value: unknown): TextbookMetadataField {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  const raw = source.value
  const name = typeof raw === 'string' && raw.trim() ? raw.trim() : null
  const confidence = typeof source.confidence === 'number' && Number.isFinite(source.confidence)
    ? Math.min(1, Math.max(0, source.confidence))
    : 0
  return {
    value: name,
    confidence,
    evidence: typeof source.evidence === 'string' ? source.evidence.trim() : '',
  }
}

function boundedConfidence(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : 0
}

function positivePages(value: unknown) {
  const values = Array.isArray(value) ? value : []
  return [...new Set(values
    .filter((page): page is number => Number.isInteger(page) && page > 0)
    .map(Number))].sort((left, right) => left - right)
}

function optionalPage(value: unknown) {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : null
}

function knowledgePoint(value: unknown): TextbookKnowledgePointRecognition | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const source = value as Record<string, unknown>
  const name = typeof (source.name ?? source.canonical_name) === 'string'
    ? String(source.name ?? source.canonical_name).trim()
    : ''
  if (!name) return null
  const pages = positivePages(source.page_numbers ?? source.pageNumbers)
  return {
    name,
    pageNumbers: pages,
    evidence: typeof (source.evidence ?? source.evidence_text) === 'string'
      ? String(source.evidence ?? source.evidence_text).trim()
      : '',
    confidence: boundedConfidence(source.confidence),
    chapterName: typeof (source.chapter_name ?? source.chapterName) === 'string'
      ? String(source.chapter_name ?? source.chapterName).trim() || null
      : null,
  }
}

function mergeKnowledgePoint(
  points: TextbookKnowledgePointRecognition[],
  point: TextbookKnowledgePointRecognition,
) {
  const existing = points.find((item) => normalizeTagName(item.name) === normalizeTagName(point.name))
  if (!existing) {
    points.push(point)
    return
  }
  existing.pageNumbers = [...new Set([...existing.pageNumbers, ...point.pageNumbers])]
    .sort((left, right) => left - right)
  if (!existing.evidence && point.evidence) existing.evidence = point.evidence
  existing.confidence = Math.max(existing.confidence, point.confidence)
  existing.chapterName = existing.chapterName ?? point.chapterName
}

function addChapter(
  chapters: TextbookChapterRecognition[],
  value: { title: string; pageStart: number | null; pageEnd: number | null; evidenceText?: string; isUnclassified?: boolean },
) {
  const normalizedTitle = normalizeTagName(value.title)
  const existing = chapters.find((item) => normalizeTagName(item.title) === normalizedTitle)
  if (existing) {
    existing.pageStart = existing.pageStart ?? value.pageStart
    existing.pageEnd = value.pageEnd ?? existing.pageEnd
    if (!existing.evidenceText && value.evidenceText) existing.evidenceText = value.evidenceText
    existing.isUnclassified = existing.isUnclassified || value.isUnclassified
    return existing
  }
  const chapter: TextbookChapterRecognition = {
    title: value.title.trim(),
    pageStart: value.pageStart,
    pageEnd: value.pageEnd,
    evidenceText: value.evidenceText || null,
    knowledgePoints: [],
    ...(value.isUnclassified ? { isUnclassified: true } : {}),
  }
  chapters.push(chapter)
  return chapter
}

function normalizeLegacyLevelList(value: unknown[]): TextbookChapterRecognition[] {
  const chapters: TextbookChapterRecognition[] = []
  let currentChapter: TextbookChapterRecognition | null = null
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const source = item as Record<string, unknown>
    const title = typeof (source.title ?? source.name) === 'string'
      ? String(source.title ?? source.name).trim()
      : ''
    if (!title) continue
    const level = Number(source.level ?? source.depth ?? 1)
    const page = optionalPage(source.page_number ?? source.pageNumber)
    const evidence = typeof (source.evidence_text ?? source.evidence) === 'string'
      ? String(source.evidence_text ?? source.evidence).trim()
      : ''
    if (level <= 1) {
      currentChapter = addChapter(chapters, { title, pageStart: page, pageEnd: null, evidenceText: evidence })
      continue
    }
    currentChapter ??= addChapter(chapters, {
      title: '待归类知识点', pageStart: page, pageEnd: page, isUnclassified: true,
    })
    mergeKnowledgePoint(currentChapter.knowledgePoints, {
      name: title,
      pageNumbers: page ? [page] : [],
      evidence,
      confidence: boundedConfidence(source.confidence),
      chapterName: currentChapter.isUnclassified ? null : currentChapter.title,
    })
  }
  return chapters
}

export function normalizeTextbookRecognitionChapters(value: Record<string, unknown>) {
  const rawChapters = Array.isArray(value.chapters) ? value.chapters : []
  const hasNestedChapters = rawChapters.some((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false
    const source = item as Record<string, unknown>
    return Array.isArray(source.knowledge_points) || Array.isArray(source.knowledgePoints)
  })
  if (!hasNestedChapters) {
    const legacy = rawChapters.length > 0
      ? rawChapters
      : Array.isArray(value.outline) ? value.outline : []
    return normalizeLegacyLevelList(legacy)
  }

  const chapters: TextbookChapterRecognition[] = []
  let currentChapter: TextbookChapterRecognition | null = null
  for (const item of rawChapters) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const source = item as Record<string, unknown>
    const nestedPoints = Array.isArray(source.knowledge_points) || Array.isArray(source.knowledgePoints)
    const title = typeof source.title === 'string' ? source.title.trim() : ''
    if (!title) continue
    if (!nestedPoints) {
      const level = Number(source.level ?? source.depth ?? 1)
      const page = optionalPage(source.page_number ?? source.pageNumber)
      const evidence = typeof (source.evidence_text ?? source.evidence) === 'string'
        ? String(source.evidence_text ?? source.evidence).trim()
        : ''
      if (level <= 1) {
        currentChapter = addChapter(chapters, { title, pageStart: page, pageEnd: null, evidenceText: evidence })
        continue
      }
      currentChapter ??= addChapter(chapters, {
        title: '待归类知识点', pageStart: page, pageEnd: page, isUnclassified: true,
      })
      if (currentChapter) {
        mergeKnowledgePoint(currentChapter.knowledgePoints, {
          name: title,
          pageNumbers: page ? [page] : [],
          evidence,
          confidence: boundedConfidence(source.confidence),
          chapterName: currentChapter.isUnclassified ? null : currentChapter.title,
        })
      }
      continue
    }
    const chapter = addChapter(chapters, {
      title,
      pageStart: optionalPage(source.page_start ?? source.pageStart),
      pageEnd: optionalPage(source.page_end ?? source.pageEnd),
      evidenceText: typeof (source.evidence ?? source.evidence_text) === 'string'
        ? String(source.evidence ?? source.evidence_text).trim()
        : '',
      isUnclassified: source.is_unclassified === true,
    })
    currentChapter = chapter
    const points = Array.isArray(source.knowledge_points)
      ? source.knowledge_points
      : Array.isArray(source.knowledgePoints) ? source.knowledgePoints : []
    for (const point of points) {
      const parsed = knowledgePoint(point)
      if (parsed) {
        parsed.chapterName = parsed.chapterName ?? chapter.title
        mergeKnowledgePoint(chapter.knowledgePoints, parsed)
      }
    }
  }
  return chapters
}

export function parseTextbookRecognition(rawOutput: string): TextbookRecognition {
  let parsed: unknown
  try {
    parsed = JSON.parse(extractJSONObject(rawOutput))
  } catch (error) {
    if (error instanceof TextbookRecognitionParseError) throw error
    throw new TextbookRecognitionParseError(`教材识别结果不是有效 JSON：${String(error)}`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TextbookRecognitionParseError('教材识别结果必须是对象')
  }
  // Enforce the same schema the provider was asked to follow. Invalid output
  // must surface as an explicit parse failure (entering the retry path)
  // instead of being silently degraded into dirty checkpoint data.
  if (!validateTextbookRecognition(parsed)) {
    throw new TextbookRecognitionParseError(
      `教材识别 JSON 不符合 Schema：${schemaErrorMessage(validateTextbookRecognition.errors)}`,
    )
  }
  const value = parsed as Record<string, unknown>
  const overallConfidence = typeof value.overall_confidence === 'number' && Number.isFinite(value.overall_confidence)
    ? Math.min(1, Math.max(0, value.overall_confidence))
    : 0
  return {
    title: field(value.title),
    subject: field(value.subject),
    grade: field(value.grade),
    volume: field(value.volume),
    publisher: field(value.publisher),
    edition: field(value.edition),
    chapters: normalizeTextbookRecognitionChapters(value),
    overallConfidence,
    warnings: Array.isArray(value.warnings)
      ? value.warnings.filter((warning): warning is string => typeof warning === 'string')
      : [],
  }
}

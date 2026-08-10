import { normalizeTagName, type TextbookChapterRecognition } from '../../domain/horizon'

export const UNCLASSIFIED_CHAPTER_TITLE = '待归类知识点'

export interface CurriculumStructureTagReference {
  tagType: string
  canonicalName: string
  description?: string | null
  knowledgeNames: string[]
  chapterName?: string | null
  pageNumbers: number[]
  evidenceText?: string | null
}

export interface NormalizedKnowledgePoint {
  name: string
  pageNumbers: number[]
  evidenceText: string | null
  description: string | null
  confidence: number
  chapterName: string | null
}

export interface NormalizedCurriculumChapter {
  title: string
  pageStart: number | null
  pageEnd: number | null
  evidenceText: string | null
  confidence: number
  isUnclassified: boolean
  knowledgePoints: NormalizedKnowledgePoint[]
}

export interface TextbookOutlineInput {
  title: string
  level: number
  pageNumber: number
  evidenceText: string
  confidence: number
}

function finiteConfidence(value: number) {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0
}

function normalizedPages(value: number[]) {
  return [...new Set(value.filter((page) => Number.isInteger(page) && page > 0))]
    .sort((left, right) => left - right)
}

function pageStart(points: NormalizedKnowledgePoint[]) {
  const pages = points.flatMap((point) => point.pageNumbers)
  return pages.length ? Math.min(...pages) : null
}

function pageEnd(points: NormalizedKnowledgePoint[]) {
  const pages = points.flatMap((point) => point.pageNumbers)
  return pages.length ? Math.max(...pages) : null
}

function isPureStructuralHeading(title: string) {
  const normalized = title.normalize('NFKC').trim().replace(/[：:、。．.　\s]+/gu, '')
  return /^(?:本节|本单元|本章)?(?:知识点|重点知识|学习目标|内容提要|小结|复习与练习)$/u.test(normalized)
}

function addChapter(
  chapters: NormalizedCurriculumChapter[],
  input: {
    title: string
    pageStart: number | null
    pageEnd: number | null
    evidenceText?: string | null
    confidence?: number
    isUnclassified?: boolean
  },
) {
  const title = input.title.trim()
  if (!title) return null
  const unclassified = input.isUnclassified === true || normalizeTagName(title) === normalizeTagName(UNCLASSIFIED_CHAPTER_TITLE)
  const existing = chapters.find((chapter) => normalizeTagName(chapter.title) === normalizeTagName(title))
  if (existing) {
    existing.pageStart = existing.pageStart ?? input.pageStart
    existing.pageEnd = input.pageEnd ?? existing.pageEnd
    existing.evidenceText = existing.evidenceText ?? input.evidenceText ?? null
    existing.confidence = Math.max(existing.confidence, finiteConfidence(input.confidence ?? 0))
    existing.isUnclassified = existing.isUnclassified || unclassified
    return existing
  }
  const chapter: NormalizedCurriculumChapter = {
    title,
    pageStart: input.pageStart,
    pageEnd: input.pageEnd,
    evidenceText: input.evidenceText ?? null,
    confidence: finiteConfidence(input.confidence ?? 0),
    isUnclassified: unclassified,
    knowledgePoints: [],
  }
  chapters.push(chapter)
  return chapter
}

function addKnowledgePoint(
  chapter: NormalizedCurriculumChapter,
  input: {
    name: string
    pageNumbers?: number[]
    evidenceText?: string | null
    description?: string | null
    confidence?: number
  },
) {
  const name = input.name.trim()
  if (!name || normalizeTagName(name) === normalizeTagName(chapter.title)) return null
  const existing = chapter.knowledgePoints.find((point) => normalizeTagName(point.name) === normalizeTagName(name))
  if (existing) {
    existing.pageNumbers = normalizedPages([...existing.pageNumbers, ...(input.pageNumbers ?? [])])
    existing.evidenceText = existing.evidenceText ?? input.evidenceText ?? null
    existing.description = existing.description ?? input.description ?? null
    existing.confidence = Math.max(existing.confidence, finiteConfidence(input.confidence ?? 0))
    existing.chapterName = chapter.title
    return existing
  }
  const point: NormalizedKnowledgePoint = {
    name,
    pageNumbers: normalizedPages(input.pageNumbers ?? []),
    evidenceText: input.evidenceText ?? null,
    description: input.description ?? null,
    confidence: finiteConfidence(input.confidence ?? 0),
    chapterName: chapter.title,
  }
  chapter.knowledgePoints.push(point)
  return point
}

function addRecognizedChapter(
  chapters: NormalizedCurriculumChapter[],
  recognized: TextbookChapterRecognition,
) {
  const chapter = addChapter(chapters, {
    title: recognized.title,
    pageStart: recognized.pageStart,
    pageEnd: recognized.pageEnd,
    evidenceText: recognized.evidenceText,
    isUnclassified: recognized.isUnclassified,
  })
  if (!chapter) return null
  for (const point of recognized.knowledgePoints) {
    addKnowledgePoint(chapter, point)
  }
  return chapter
}

function chapterContainsPage(chapter: NormalizedCurriculumChapter, page: number) {
  if (chapter.pageStart === null || page < chapter.pageStart) return false
  if (chapter.pageEnd !== null) return page <= chapter.pageEnd
  // A chapter with only a start page is not an unbounded match.  Keep the
  // fallback conservative so an unrelated late-page candidate goes to review.
  return page - chapter.pageStart <= 80
}

export function resolveKnowledgeChapterIndex(
  chapters: NormalizedCurriculumChapter[],
  reference: Pick<CurriculumStructureTagReference, 'canonicalName' | 'knowledgeNames' | 'chapterName' | 'pageNumbers'>,
) {
  const explicit = reference.chapterName?.trim()
  if (explicit) {
    const explicitIndex = chapters.findIndex((chapter) => normalizeTagName(chapter.title) === normalizeTagName(explicit))
    if (explicitIndex >= 0) return explicitIndex
  }

  const names = [reference.canonicalName, ...reference.knowledgeNames].map(normalizeTagName).filter(Boolean)
  const contextualIndex = chapters.findIndex((chapter) =>
    chapter.knowledgePoints.some((point) => names.includes(normalizeTagName(point.name))) ||
    names.includes(normalizeTagName(chapter.title)),
  )
  if (contextualIndex >= 0) return contextualIndex

  const firstPage = reference.pageNumbers.find((page) => Number.isInteger(page) && page > 0)
  if (firstPage !== undefined) {
    const inRange = chapters
      .map((chapter, index) => ({ chapter, index }))
      .filter(({ chapter }) => !chapter.isUnclassified && chapterContainsPage(chapter, firstPage))
      .sort((left, right) => {
        const leftSpan = (left.chapter.pageEnd ?? left.chapter.pageStart ?? firstPage) - (left.chapter.pageStart ?? firstPage)
        const rightSpan = (right.chapter.pageEnd ?? right.chapter.pageStart ?? firstPage) - (right.chapter.pageStart ?? firstPage)
        return leftSpan - rightSpan
      })
    if (inRange[0]) return inRange[0].index

    const nearest = chapters
      .map((chapter, index) => ({ chapter, index, distance: Math.abs((chapter.pageStart ?? firstPage) - firstPage) }))
      .filter(({ chapter }) => !chapter.isUnclassified && chapter.pageStart !== null)
      .sort((left, right) => left.distance - right.distance)[0]
    if (nearest && nearest.distance <= 80) return nearest.index
  }

  return chapters.findIndex((chapter) => chapter.isUnclassified)
}

function inferChapterPageEnds(chapters: NormalizedCurriculumChapter[]) {
  for (let index = 0; index < chapters.length; index += 1) {
    const chapter = chapters[index]
    const pointStart = pageStart(chapter.knowledgePoints)
    const pointEnd = pageEnd(chapter.knowledgePoints)
    chapter.pageStart = chapter.pageStart ?? pointStart
    chapter.pageEnd = chapter.pageEnd ?? pointEnd
    const next = chapters.slice(index + 1).find((candidate) => !candidate.isUnclassified && candidate.pageStart !== null)
    if (chapter.pageEnd === null && next && next.pageStart !== null && chapter.pageStart !== null && next.pageStart > chapter.pageStart) {
      chapter.pageEnd = next.pageStart - 1
    }
    if (chapter.pageStart !== null && chapter.pageEnd !== null && chapter.pageEnd < chapter.pageStart) {
      chapter.pageEnd = chapter.pageStart
    }
  }
}

export function normalizeTextbookStructure(input: {
  chapters?: TextbookChapterRecognition[] | null
  outline?: TextbookOutlineInput[] | null
  tagCandidates?: CurriculumStructureTagReference[]
}) {
  const chapters: NormalizedCurriculumChapter[] = []
  for (const recognized of input.chapters ?? []) addRecognizedChapter(chapters, recognized)

  let currentChapter: NormalizedCurriculumChapter | null = null
  for (const item of input.outline ?? []) {
    const title = item.title.trim()
    if (!title) continue
    if (item.level <= 1) {
      currentChapter = addChapter(chapters, {
        title,
        pageStart: item.pageNumber,
        pageEnd: null,
        evidenceText: item.evidenceText,
        confidence: item.confidence,
      })
      continue
    }
    if (!currentChapter) {
      currentChapter = addChapter(chapters, {
        title: UNCLASSIFIED_CHAPTER_TITLE,
        pageStart: item.pageNumber,
        pageEnd: item.pageNumber,
        evidenceText: '无法从目录或 AI 结果确定父章节',
        confidence: 0,
        isUnclassified: true,
      })
    }
    if (!currentChapter) continue
    if (!isPureStructuralHeading(title) || item.level >= 3) {
      addKnowledgePoint(currentChapter, {
        name: title,
        pageNumbers: item.pageNumber > 0 ? [item.pageNumber] : [],
        evidenceText: item.evidenceText,
        confidence: item.confidence,
      })
    }
  }

  const candidates = input.tagCandidates ?? []
  for (const candidate of candidates.filter((item) => item.tagType === 'knowledge')) {
    let index = resolveKnowledgeChapterIndex(chapters, candidate)
    if (index < 0) {
      const unclassified = addChapter(chapters, {
        title: UNCLASSIFIED_CHAPTER_TITLE,
        pageStart: candidate.pageNumbers[0] ?? null,
        pageEnd: candidate.pageNumbers.at(-1) ?? null,
        evidenceText: '无法从目录或 AI 结果确定父章节',
        confidence: 0,
        isUnclassified: true,
      })
      index = unclassified ? chapters.indexOf(unclassified) : -1
    }
    if (index >= 0) {
      addKnowledgePoint(chapters[index], {
        name: candidate.canonicalName,
        pageNumbers: candidate.pageNumbers,
        evidenceText: candidate.evidenceText,
        description: candidate.description,
        confidence: 0,
      })
    }
  }

  inferChapterPageEnds(chapters)
  return chapters
}

export function chapterKnowledgePointNames(chapter: NormalizedCurriculumChapter) {
  return chapter.knowledgePoints.map((point) => point.name)
}

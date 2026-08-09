import type {
  AITagCandidate,
  HorizonTagType,
} from './models'

export type VerificationStatus =
  | 'unverified'
  | 'ai_verified'
  | 'user_verified'
  | 'needs_review'
  | 'rejected'

export type TagLifecycleStatus =
  | 'candidate'
  | 'active'
  | 'rejected'
  | 'archived'
  | 'merged'

export interface Textbook {
  id: string
  subject: string
  title: string
  grade: string | null
  volume: string | null
  publisher: string | null
  edition: string | null
  sourceType: 'pdf' | 'scanned_pdf' | 'directory_image' | 'manual'
  sourcePath: string | null
  contentHash: string | null
  extractionStatus: 'pending' | 'processing' | 'needs_review' | 'completed' | 'failed'
  extractionMethod: 'pdf_text' | 'vision_ocr' | 'manual' | 'mixed' | null
  isCurrent: boolean
  archivedAt: number | null
  createdAt: number
  updatedAt: number
}

export interface TextbookMetadataField {
  value: string | null
  evidence: string
}

export interface TextbookKnowledgePointRecognition {
  name: string
  pageNumbers: number[]
  evidence: string
  chapterName?: string | null
}

export interface TextbookChapterRecognition {
  title: string
  pageStart: number | null
  pageEnd: number | null
  evidenceText?: string | null
  knowledgePoints: TextbookKnowledgePointRecognition[]
  isUnclassified?: boolean
}

export interface TextbookRecognition {
  title: TextbookMetadataField
  subject: TextbookMetadataField
  grade: TextbookMetadataField
  volume: TextbookMetadataField
  publisher: TextbookMetadataField
  edition: TextbookMetadataField
  chapters: TextbookChapterRecognition[]
  warnings: string[]
}

export type CurriculumImportStatus =
  | 'ai_analyzing_structure'
  | 'ai_generating_tags'
  | 'ai_auditing'
  | 'waiting_for_review'
  | 'ai_failed_recoverable'

export type CurriculumImportStage =
  | 'ai_analyzing_structure'
  | 'ai_generating_tags'
  | 'ai_auditing'
  | 'waiting_for_review'

export interface CurriculumImportJob {
  id: string
  originalSourcePath: string
  sourcePath: string
  sourceName: string
  sourceType: Textbook['sourceType'] | null
  contentHash: string | null
  status: CurriculumImportStatus
  stage: CurriculumImportStage
  pageCount: number | null
  extractionMethod: Textbook['extractionMethod'] | null
  extraction: {
    pageCount: number
    extractionMethod: 'pdf_text' | 'vision_ocr' | 'mixed'
    pages: Array<{
      pageNumber: number
      evidenceText: string
      extractionMethod: 'pdf_text' | 'vision_ocr' | 'manual' | 'failed'
      confidence: number
    }>
    outline: Array<{
      title: string
      level: number
      pageNumber: number
      evidenceText: string
      confidence: number
    }>
    warnings: string[]
  } | null
  recognition: TextbookRecognition | null
  provider: string | null
  model: string | null
  promptVersion: string | null
  schemaVersion: string | null
  inputHash: string | null
  rawOutput: string | null
  errorMessage: string | null
  error?: import('./aiError').AIErrorEnvelope | null
  providerTaskId: string | null
  structure: unknown | null
  tags: unknown | null
  audit: unknown | null
  progressCurrent: number
  progressTotal: number
  progressFraction: number
  progressLabel: string
  createdAt: number
  updatedAt: number
}

export interface KnowledgeNode {
  id: string
  textbookId: string
  subject: string
  canonicalName: string
  nodeType: 'book' | 'chapter' | 'section' | 'knowledge' | 'definition' | 'formula' | 'theorem' | 'property'
  parentId: string | null
  path: string
  sortOrder: number
  curriculumVersion: number
  description: string | null
  sourcePageStart: number | null
  sourcePageEnd: number | null
  evidenceText: string | null
  sourcePath: string | null
  extractionMethod: 'pdf_text' | 'vision_ocr' | 'manual' | 'mixed'
  confidence: number
  verificationStatus: VerificationStatus
  mergedIntoId: string | null
  archivedAt: number | null
  createdAt: number
  updatedAt: number
  isUnclassified: boolean
}

export interface KnowledgeEdge {
  id: string
  subject: string
  fromNodeId: string
  toNodeId: string
  relationType: 'contains' | 'prerequisite_of' | 'derived_from' | 'similar_to' | 'confusable_with' | 'used_by' | 'appears_in'
  confidence: number
  source: 'textbook' | 'model' | 'user' | 'system'
  verificationStatus: VerificationStatus
}

export interface TagDefinition {
  id: string
  subject: string
  tagType: HorizonTagType
  canonicalName: string
  aliases: string[]
  description: string | null
  parentId: string | null
  knowledgeNodeId: string | null
  textbookId: string | null
  source: 'textbook_extracted' | 'ai_inferred' | 'existing_library' | 'user_created'
  taxonomyVersion: number
  verificationStatus: VerificationStatus
  lifecycleStatus: TagLifecycleStatus
  methodClass: 'core' | 'optional' | null
  mergedIntoId: string | null
  archivedAt: number | null
  createdAt: number
  updatedAt: number
}

export interface ProblemTag {
  id: string
  problemId: string
  subject: string
  tagType: HorizonTagType
  tagId: string | null
  canonicalName: string
  role: 'primary' | 'secondary'
  mappingStatus: 'mapped' | 'unmapped' | 'candidate' | 'rejected'
  confidence: number
  evidence: string
  source: 'textbook' | 'model' | 'user' | 'legacy'
  taxonomyVersion: number
  modelRunId: string | null
  verificationStatus: VerificationStatus
  isLocked: boolean
  updatedAt: number
}

export interface ControlledTagMapping {
  candidate: AITagCandidate
  definition: TagDefinition | null
  mappingStatus: 'mapped' | 'unmapped' | 'candidate'
  verificationStatus: VerificationStatus
}

export function mergeKnowledgeCandidateOutputs(
  selected: AITagCandidate[],
  unresolved: AITagCandidate[],
): AITagCandidate[] {
  const seen = new Set<string>()
  return [
    ...selected,
    ...unresolved.map((candidate) => ({ ...candidate, canonicalTagId: null })),
  ].filter((candidate) => {
    const key = candidate.canonicalTagId || normalizeTagName(candidate.name)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export type ProblemTagOutcomeCode =
  | 'mapped'
  | 'needs_review'
  | 'unresolved'
  | 'no_textbook'
  | 'no_active_definitions'
  | 'no_candidate'

export interface ProblemTagOutcome {
  code: ProblemTagOutcomeCode
  title: string
  detail: string
}

export function summarizeProblemTagOutcome(input: {
  tags: ProblemTag[]
  definitions: TagDefinition[]
  selectedTextbookId: string | null
}): ProblemTagOutcome {
  const mapped = input.tags.filter((tag) => tag.mappingStatus === 'mapped')
  const unresolved = input.tags.filter((tag) => tag.mappingStatus !== 'mapped')
  if (unresolved.length) return {
    code: 'unresolved',
    title: '有 AI 标签待处理',
    detail: `${unresolved.length} 项可以直接保留或移除，不需要维护标签对应关系。`,
  }
  if (mapped.some((tag) => !tag.isLocked && tag.verificationStatus !== 'user_verified')) return {
    code: 'needs_review',
    title: 'AI 标签等待确认',
    detail: `${mapped.length} 项由 AI 添加，确认后会在重新分析时保持不变。`,
  }
  if (mapped.length) return {
    code: 'mapped',
    title: '标签已保存',
    detail: `${mapped.length} 项标签可用于整理和检索。`,
  }
  if (!input.selectedTextbookId) return {
    code: 'no_textbook',
    title: '未匹配教材',
    detail: '分析可以继续，但不会添加教材知识点标签。',
  }
  const activeDefinitions = input.definitions.filter((definition) =>
    definition.lifecycleStatus === 'active' && definition.archivedAt === null &&
    (definition.tagType !== 'knowledge' || definition.textbookId === input.selectedTextbookId))
  if (!activeDefinitions.length) return {
    code: 'no_active_definitions',
    title: '当前教材没有可用标签',
    detail: '请先在课程中批准知识结构，之后重新分析本题。',
  }
  return {
    code: 'no_candidate',
    title: 'AI 未提出标签候选',
    detail: '题目分析已完成，但本次输出没有可持久化的标签或难度结果。',
  }
}

export function normalizeTagName(value: string) {
  return value
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('zh-CN')
    .replace(/[\s·•,，、。:：;；()（）[\]【】_-]+/gu, '')
}

export function mapCandidatesToControlledTags(
  subject: string,
  tagType: HorizonTagType,
  candidates: AITagCandidate[],
  definitions: TagDefinition[],
  matchedTextbookId: string | null,
): ControlledTagMapping[] {
  const scoped = definitions.filter((definition) =>
    definition.subject === subject &&
    definition.tagType === tagType &&
    definition.lifecycleStatus === 'active' &&
    definition.archivedAt === null &&
    definition.mergedIntoId === null &&
    Number.isInteger(definition.taxonomyVersion) && definition.taxonomyVersion > 0 &&
    (tagType !== 'knowledge' || (
      matchedTextbookId !== null &&
      definition.knowledgeNodeId !== null &&
      definition.textbookId === matchedTextbookId
    ))
  )
  return candidates.map((candidate) => {
    const normalized = normalizeTagName(candidate.name)
    // A model-proposed controlled ID is authoritative only as a lookup key:
    // never fall back to a same-name tag when that ID is hallucinated or
    // belongs to another subject/textbook.
    const definition = candidate.canonicalTagId
      ? scoped.find((item) => item.id === candidate.canonicalTagId) ?? null
      : scoped.find((item) =>
        normalizeTagName(item.canonicalName) === normalized ||
        item.aliases.some((alias) => normalizeTagName(alias) === normalized)
      ) ?? null
    if (!definition) {
      return {
        candidate,
        definition: null,
        mappingStatus: tagType === 'knowledge' ? 'unmapped' : 'candidate',
        verificationStatus: 'needs_review',
      }
    }
    return {
      candidate,
      definition,
      mappingStatus: 'mapped',
      verificationStatus: 'needs_review',
    }
  })
}

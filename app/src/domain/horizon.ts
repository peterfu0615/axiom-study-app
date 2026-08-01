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
  confidence: number
  evidence: string
}

export interface TextbookRecognition {
  title: TextbookMetadataField
  subject: TextbookMetadataField
  grade: TextbookMetadataField
  volume: TextbookMetadataField
  publisher: TextbookMetadataField
  edition: TextbookMetadataField
  overallConfidence: number
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
      extractionMethod: 'pdf_text' | 'vision_ocr' | 'manual'
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
  providerTaskId: string | null
  structure: unknown | null
  tags: unknown | null
  audit: unknown | null
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
  currentTextbookId: string | null,
  confidenceThreshold = 0.72,
): ControlledTagMapping[] {
  const scoped = definitions.filter((definition) =>
    definition.subject === subject &&
    definition.tagType === tagType &&
    definition.lifecycleStatus === 'active' &&
    (tagType !== 'knowledge' || definition.textbookId === currentTextbookId)
  )
  return candidates.map((candidate) => {
    const normalized = normalizeTagName(candidate.name)
    const definition = scoped.find((item) =>
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
      verificationStatus: candidate.confidence >= confidenceThreshold
        ? 'ai_verified'
        : 'needs_review',
    }
  })
}

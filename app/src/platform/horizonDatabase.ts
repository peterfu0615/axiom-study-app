import { invoke } from '@tauri-apps/api/core'
import type { AIProblemAnalysis, HorizonTagType } from '../domain/models'
import {
  mapCandidatesToControlledTags,
  normalizeTagName,
  type CurriculumImportJob,
  type KnowledgeNode,
  type KnowledgeEdge,
  type ProblemTag,
  type TagDefinition,
  type Textbook,
  type TextbookRecognition,
} from '../domain/horizon'
import {
  getTextbookRecognitionProvider,
  getCurriculumAnalysisProvider,
} from '../ai/provider'
import {
  buildCurriculumAuditPrompt,
  buildCurriculumTagPrompt,
  chunkTextbookPages,
  CURRICULUM_AUDIT_PROMPT_VERSION,
  CURRICULUM_AUDIT_SCHEMA_VERSION,
  CURRICULUM_TAG_PROMPT_VERSION,
  CURRICULUM_TAG_SCHEMA_VERSION,
  curriculumAuditJSONSchema,
  curriculumTagsJSONSchema,
  parseCurriculumAudit,
  parseCurriculumTags,
  reconcileCurriculumTagCandidates,
  type CurriculumTagAnalysis,
} from '../ai/curriculumAnalysis'
import {
  TEXTBOOK_RECOGNITION_PROMPT_VERSION,
  TEXTBOOK_RECOGNITION_SCHEMA_VERSION,
} from '../ai/textbookRecognitionContract'
import { inferMissingTextbookRecognition } from '../ai/textbookRecognitionInference'
import { normalizeTextbookRecognitionChapters } from '../ai/textbookRecognitionParser'
import {
  normalizeTextbookStructure,
  resolveKnowledgeChapterIndex,
  type NormalizedCurriculumChapter,
  type CurriculumStructureTagReference,
} from '../features/curriculum/curriculumStructure'
import {
  completeCurriculumImportAttempt,
  bindRelabelBatchItemModelRun,
  claimRelabelBatchItem,
  createCurriculumImportAttempt,
  bulkReviewCurriculumTags,
  failCurriculumImportAttempt,
  updateCurriculumImportProgress,
  importTextbookSource,
  cleanupTextbookImportTemp,
  mergeKnowledgeNodes,
  mergeTagDefinitions,
  promoteTextbookSource,
  recoverRelabelBatchItems,
  removeTextbookSource,
  verifyTextbookSource,
  type ImportedTextbookSource,
  type CurriculumAIStage,
  type CurriculumImportAttemptLease,
  type TextbookExtractionProgress,
} from './native'
import {
  resolveProblemTextbook,
  type ProblemTextbookMatch,
} from '../domain/problemTextbook'

interface ExecuteResult {
  rowsAffected: number
  lastInsertId: number
}

const execute = (sql: string, params: unknown[] = []) =>
  invoke<ExecuteResult>('db_execute', { sql, params })
const select = <T>(sql: string, params: unknown[] = []) =>
  invoke<T>('db_select', { sql, params })
const id = () => crypto.randomUUID()
const bool = (value: unknown) => Number(value) === 1
const nullableString = (value: unknown) => value == null ? null : String(value)
const nullableNumber = (value: unknown) => value == null ? null : Number(value)

function parseJSON<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || !value.trim()) return fallback
  try { return JSON.parse(value) as T } catch { return fallback }
}

function sourceNameFromPath(sourcePath: string) {
  return sourcePath.split(/[\\/]/u).filter(Boolean).at(-1) || '未命名教材'
}

interface PersistedKnowledgeReference {
  id: string
  chapterIndex: number
  name: string
  pageNumbers: number[]
}

function structureTagReference(candidate: CurriculumTagAnalysis['candidates'][number]): CurriculumStructureTagReference {
  return {
    tagType: candidate.tagType,
    canonicalName: candidate.canonicalName,
    description: candidate.description,
    knowledgeNames: candidate.knowledgeNames,
    chapterName: candidate.chapterName,
    pageNumbers: candidate.pageNumbers,
    evidenceText: candidate.evidenceText,
    confidence: candidate.confidence,
  }
}

function findPersistedKnowledgeReference(
  candidate: CurriculumTagAnalysis['candidates'][number],
  structure: NormalizedCurriculumChapter[],
  references: PersistedKnowledgeReference[],
) {
  const chapterIndex = resolveKnowledgeChapterIndex(structure, structureTagReference(candidate))
  const names = [candidate.canonicalName, ...candidate.knowledgeNames].map(normalizeTagName)
  const inChapter = references.find((reference) =>
    (chapterIndex < 0 || reference.chapterIndex === chapterIndex) && names.includes(normalizeTagName(reference.name)),
  )
  return inChapter ?? references.find((reference) => names.includes(normalizeTagName(reference.name))) ?? null
}

// Re-importing the same textbook must merge into the existing tree instead of
// failing on the sibling unique index (migration 0026).  Find an active
// sibling whose normalized name matches before inserting.
async function findActiveSiblingNodeId(
  textbookId: string,
  parentId: string | null,
  canonicalName: string,
): Promise<string | null> {
  const rows = await select<Array<{ id: string }>>(
    `SELECT id FROM knowledge_nodes
     WHERE textbook_id = $1
       AND (($2 IS NULL AND parent_id IS NULL) OR parent_id = $2)
       AND archived_at IS NULL AND merged_into_id IS NULL
       AND lower(trim(canonical_name)) = lower(trim($3))
     ORDER BY created_at, id
     LIMIT 1`,
    [textbookId, parentId, canonicalName],
  )
  return rows[0]?.id ?? null
}

async function persistNormalizedKnowledgeNodes(input: {
  textbookId: string
  subject: string
  sourcePath: string
  extractionMethod: ImportedTextbookSource['extraction']['extractionMethod']
  now: number
  structure: NormalizedCurriculumChapter[]
}) {
  const references: PersistedKnowledgeReference[] = []
  for (const [chapterIndex, chapter] of input.structure.entries()) {
    const existingChapterId = await findActiveSiblingNodeId(input.textbookId, null, chapter.title)
    const chapterId = existingChapterId ?? id()
    if (!existingChapterId) {
      await execute(
        `INSERT INTO knowledge_nodes (
          id, textbook_id, subject, canonical_name, node_type, parent_id, path,
          sort_order, description, source_page_start, source_page_end, evidence_text, source_path,
          extraction_method, confidence, verification_status, is_unclassified, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, 'chapter', NULL, $4, $5, NULL, $6, $7, $8, $9, $10,
          $11, 'needs_review', $12, $13, $13)`,
        [chapterId, input.textbookId, input.subject, chapter.title, chapterIndex,
          chapter.pageStart, chapter.pageEnd, chapter.evidenceText, input.sourcePath,
          input.extractionMethod, chapter.confidence, chapter.isUnclassified ? 1 : 0, input.now],
      )
    }
    for (const [sortOrder, point] of chapter.knowledgePoints.entries()) {
      const pageStart = point.pageNumbers[0] ?? null
      const pageEnd = point.pageNumbers.at(-1) ?? null
      const existingNodeId = await findActiveSiblingNodeId(input.textbookId, chapterId, point.name)
      if (existingNodeId) {
        references.push({ id: existingNodeId, chapterIndex, name: point.name, pageNumbers: point.pageNumbers })
        continue
      }
      const nodeId = id()
      await execute(
        `INSERT INTO knowledge_nodes (
          id, textbook_id, subject, canonical_name, node_type, parent_id, path,
          sort_order, description, source_page_start, source_page_end, evidence_text, source_path,
          extraction_method, confidence, verification_status, is_unclassified, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, 'knowledge', $5, $6, $7, $8, $9, $10, $11, $12,
          $13, $14, 'needs_review', 0, $15, $15)`,
        [nodeId, input.textbookId, input.subject, point.name, chapterId,
          `${chapter.title}/${point.name}`, sortOrder, point.description, pageStart,
          pageEnd, point.evidenceText, input.sourcePath, input.extractionMethod,
          point.confidence, input.now],
      )
      references.push({ id: nodeId, chapterIndex, name: point.name, pageNumbers: point.pageNumbers })
    }
  }
  return references
}

async function inputHash(value: unknown) {
  const source = new TextEncoder().encode(JSON.stringify(value))
  const digest = await crypto.subtle.digest('SHA-256', source)
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

let transactionChain = Promise.resolve()

async function transaction<T>(operation: () => Promise<T>): Promise<T> {
  // db_execute is serialized per IPC call in Rust, not for the lifetime of a
  // SQLite transaction.  Queue every Horizon transaction in this module so a
  // second BEGIN cannot land between the first transaction's statements.
  const next = transactionChain.then(async () => {
    await execute('BEGIN IMMEDIATE')
    try {
      const value = await operation()
      await execute('COMMIT')
      return value
    } catch (error) {
      await execute('ROLLBACK').catch(() => {})
      throw error
    }
  })
  transactionChain = next.then(() => undefined, () => undefined)
  return next
}

async function ensureTaxonomyVersion(subject: string): Promise<number> {
  const scopedSubject = subject.trim()
  const rows = await select<Array<{ version: number }>>(
    `SELECT version FROM taxonomy_versions
     WHERE subject = $1 AND status = 'published' ORDER BY version DESC LIMIT 1`,
    [scopedSubject],
  )
  if (rows[0]) return Number(rows[0].version)
  await execute(
    `INSERT OR IGNORE INTO taxonomy_versions (
      id, subject, version, status, note, created_at, published_at
    ) VALUES ($1, $2, 1, 'published', 'Horizon foundation', $3, $3)`,
    [id(), scopedSubject, Date.now()],
  )
  return 1
}

function rowToTextbook(row: Record<string, unknown>): Textbook {
  return {
    id: String(row.id),
    subject: String(row.subject),
    title: String(row.title),
    grade: nullableString(row.grade),
    volume: nullableString(row.volume),
    publisher: nullableString(row.publisher),
    edition: nullableString(row.edition),
    sourceType: String(row.source_type) as Textbook['sourceType'],
    sourcePath: nullableString(row.source_path),
    contentHash: nullableString(row.content_hash),
    extractionStatus: String(row.extraction_status) as Textbook['extractionStatus'],
    extractionMethod: nullableString(row.extraction_method) as Textbook['extractionMethod'],
    isCurrent: bool(row.is_current),
    archivedAt: nullableNumber(row.archived_at),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}

function rowToCurriculumImportJob(row: Record<string, unknown>): CurriculumImportJob {
  const storedRecognition = parseJSON<Record<string, unknown> | null>(row.metadata_json, null)
  return {
    id: String(row.id),
    originalSourcePath: String(row.original_source_path),
    sourcePath: String(row.source_path),
    sourceName: String(row.source_name),
    sourceType: nullableString(row.source_type) as CurriculumImportJob['sourceType'],
    contentHash: nullableString(row.content_hash),
    status: String(row.status) as CurriculumImportJob['status'],
    stage: String(row.resume_stage) as CurriculumImportJob['stage'],
    pageCount: nullableNumber(row.page_count),
    extractionMethod: nullableString(row.extraction_method) as CurriculumImportJob['extractionMethod'],
    extraction: parseJSON<CurriculumImportJob['extraction']>(row.extraction_json, null),
    recognition: storedRecognition
      ? {
          ...storedRecognition,
          chapters: normalizeTextbookRecognitionChapters(storedRecognition),
        } as TextbookRecognition
      : null,
    provider: nullableString(row.provider),
    model: nullableString(row.model),
    promptVersion: nullableString(row.prompt_version),
    schemaVersion: nullableString(row.schema_version),
    inputHash: nullableString(row.input_hash),
    rawOutput: nullableString(row.raw_output),
    errorMessage: nullableString(row.error_message),
    providerTaskId: nullableString(row.provider_task_id),
    structure: parseJSON<unknown | null>(row.structure_json, null),
    tags: parseJSON<unknown | null>(row.tags_json, null),
    audit: parseJSON<unknown | null>(row.audit_json, null),
    progressCurrent: Number(row.progress_current ?? 0),
    progressTotal: Math.max(1, Number(row.progress_total ?? 1)),
    progressFraction: Math.min(1, Math.max(0, Number(row.progress_fraction ?? 0))),
    progressLabel: String(row.progress_label ?? ''),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}

function rowToKnowledgeNode(row: Record<string, unknown>): KnowledgeNode {
  return {
    id: String(row.id),
    textbookId: String(row.textbook_id),
    subject: String(row.subject),
    canonicalName: String(row.canonical_name),
    nodeType: String(row.node_type) as KnowledgeNode['nodeType'],
    parentId: nullableString(row.parent_id),
    path: String(row.path || ''),
    sortOrder: Number(row.sort_order),
    curriculumVersion: Number(row.curriculum_version),
    description: nullableString(row.description),
    sourcePageStart: nullableNumber(row.source_page_start),
    sourcePageEnd: nullableNumber(row.source_page_end),
    evidenceText: nullableString(row.evidence_text),
    sourcePath: nullableString(row.source_path),
    extractionMethod: String(row.extraction_method) as KnowledgeNode['extractionMethod'],
    confidence: Number(row.confidence),
    verificationStatus: String(row.verification_status) as KnowledgeNode['verificationStatus'],
    mergedIntoId: nullableString(row.merged_into_id),
    archivedAt: nullableNumber(row.archived_at),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    isUnclassified: bool(row.is_unclassified),
  }
}

function rowToTagDefinition(row: Record<string, unknown>): TagDefinition {
  return {
    id: String(row.id),
    subject: String(row.subject),
    tagType: String(row.tag_type) as TagDefinition['tagType'],
    canonicalName: String(row.canonical_name),
    aliases: String(row.aliases || '').split('\u001f').filter(Boolean),
    description: nullableString(row.description),
    parentId: nullableString(row.parent_id),
    knowledgeNodeId: nullableString(row.knowledge_node_id),
    textbookId: nullableString(row.textbook_id),
    source: String(row.origin_kind || 'user_created') as TagDefinition['source'],
    taxonomyVersion: Number(row.taxonomy_version),
    verificationStatus: String(row.verification_status) as TagDefinition['verificationStatus'],
    lifecycleStatus: String(row.lifecycle_status) as TagDefinition['lifecycleStatus'],
    methodClass: nullableString(row.method_class) as TagDefinition['methodClass'],
    mergedIntoId: nullableString(row.merged_into_id),
    archivedAt: nullableNumber(row.archived_at),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}

export async function listHorizonSubjects(): Promise<string[]> {
  const rows = await select<Array<{ subject: string }>>(
    `SELECT subject FROM textbooks WHERE archived_at IS NULL
     UNION
     SELECT trim(COALESCE(NULLIF(user_subject, ''), NULLIF(ai_subject, ''), NULLIF(subject, '')))
     FROM problems
     WHERE status = 'saved' AND deleted_at IS NULL
       AND trim(COALESCE(NULLIF(user_subject, ''), NULLIF(ai_subject, ''), NULLIF(subject, ''))) != ''
     ORDER BY subject`,
  )
  return rows.map((row) => String(row.subject)).filter(Boolean)
}

export async function listTextbooks(subject?: string): Promise<Textbook[]> {
  const rows = await select<Record<string, unknown>[]>(
    `SELECT * FROM textbooks
     WHERE archived_at IS NULL AND ($1 = '' OR subject = $1)
     ORDER BY subject, updated_at DESC`,
    [subject?.trim() ?? ''],
  )
  return rows.map(rowToTextbook)
}

export interface ProblemTextbookMatchView extends ProblemTextbookMatch {
  problemId: string
  subject: string
  locked: boolean
  candidates: Textbook[]
}

export async function getProblemTextbookMatch(problemId: string): Promise<ProblemTextbookMatchView | null> {
  const rows = await select<Record<string, unknown>[]>(
    `SELECT p.id, trim(COALESCE(NULLIF(p.user_subject, ''), NULLIF(p.ai_subject, ''), NULLIF(p.subject, ''))) AS effective_subject,
       p.matched_textbook_id, p.textbook_match_confidence, p.textbook_match_reason,
       p.textbook_match_source, p.textbook_match_locked, p.textbook_match_updated_at,
       t.id AS textbook_id, t.subject AS textbook_subject, t.title AS textbook_title,
       t.grade AS textbook_grade, t.volume AS textbook_volume, t.publisher AS textbook_publisher,
       t.edition AS textbook_edition, t.source_type AS textbook_source_type,
       t.source_path AS textbook_source_path, t.content_hash AS textbook_content_hash,
       t.extraction_status AS textbook_extraction_status, t.extraction_method AS textbook_extraction_method,
       t.is_current AS textbook_is_current, t.archived_at AS textbook_archived_at,
       t.created_at AS textbook_created_at, t.updated_at AS textbook_updated_at
     FROM problems p
     LEFT JOIN textbooks t ON t.id = p.matched_textbook_id
     WHERE p.id = $1 LIMIT 1`,
    [problemId],
  )
  const row = rows[0]
  if (!row) return null
  const subject = String(row.effective_subject || '')
  const candidateRows = subject
    ? await select<Record<string, unknown>[]>(
      `SELECT * FROM textbooks WHERE subject = $1 AND archived_at IS NULL ORDER BY updated_at DESC`,
      [subject],
    )
    : []
  const textbook = row.textbook_id ? rowToTextbook({
    id: row.textbook_id, subject: row.textbook_subject, title: row.textbook_title,
    grade: row.textbook_grade, volume: row.textbook_volume, publisher: row.textbook_publisher,
    edition: row.textbook_edition, source_type: row.textbook_source_type,
    source_path: row.textbook_source_path, content_hash: row.textbook_content_hash,
    extraction_status: row.textbook_extraction_status, extraction_method: row.textbook_extraction_method,
    is_current: row.textbook_is_current, archived_at: row.textbook_archived_at,
    created_at: row.textbook_created_at, updated_at: row.textbook_updated_at,
  }) : null
  return {
    textbook,
    confidence: Number(row.textbook_match_confidence ?? 0),
    reason: nullableString(row.textbook_match_reason),
    source: String(row.textbook_match_source || 'unresolved') as ProblemTextbookMatch['source'],
    problemId,
    subject,
    locked: bool(row.textbook_match_locked),
    candidates: candidateRows.map(rowToTextbook),
  }
}

export async function setProblemTextbookMatch(
  problemId: string,
  textbookId: string | null,
  lock = true,
) {
  const now = Date.now()
  return transaction(async () => {
    const problems = await select<Array<{ subject: string }>>(
      `SELECT trim(COALESCE(NULLIF(user_subject, ''), NULLIF(ai_subject, ''), NULLIF(subject, ''))) AS subject
       FROM problems WHERE id = $1 LIMIT 1`, [problemId],
    )
    const subject = String(problems[0]?.subject || '')
    if (!subject) throw new Error('题目尚未确认科目')
    if (textbookId) {
      const textbooks = await select<Array<Record<string, unknown>>>(
        `SELECT * FROM textbooks WHERE id = $1 AND subject = $2 AND archived_at IS NULL LIMIT 1`,
        [textbookId, subject],
      )
      if (!textbooks[0]) throw new Error('只能选择当前科目的未归档教材')
      await execute(
        `UPDATE problems SET matched_textbook_id = $1, textbook_match_confidence = 1,
         textbook_match_reason = '用户手动选择', textbook_match_source = 'user',
         textbook_match_locked = $2, textbook_match_updated_at = $3, updated_at = $3
         WHERE id = $4`, [textbookId, lock ? 1 : 0, now, problemId],
      )
    } else {
      await execute(
        `UPDATE problems SET matched_textbook_id = NULL, textbook_match_confidence = 0,
         textbook_match_reason = '用户清除教材匹配', textbook_match_source = 'unresolved',
         textbook_match_locked = 0, textbook_match_updated_at = $1, updated_at = $1
         WHERE id = $2`, [now, problemId],
      )
    }
    return getProblemTextbookMatch(problemId)
  })
}

export async function setCurrentTextbook(textbook: Pick<Textbook, 'id' | 'subject'>) {
  // Kept only for legacy integrations. New flows never call this function and
  // no problem routing depends on the compatibility is_current column.
  await transaction(async () => {
    await execute('UPDATE textbooks SET is_current = 0 WHERE subject = $1', [textbook.subject])
    await execute(
      `UPDATE textbooks SET is_current = 1, updated_at = $1
       WHERE id = $2 AND subject = $3 AND archived_at IS NULL`,
      [Date.now(), textbook.id, textbook.subject],
    )
  })
}

export async function createManualTextbook(subject: string, title: string) {
  const now = Date.now()
  const textbookId = id()
  await ensureTaxonomyVersion(subject)
  await transaction(async () => {
    await execute(
      `INSERT INTO textbooks (
        id, subject, title, source_type, extraction_status, extraction_method,
        is_current, created_at, updated_at
      ) VALUES ($1, $2, $3, 'manual', 'needs_review', 'manual', 0, $4, $4)`,
      [textbookId, subject.trim(), title.trim(), now],
    )
  })
  return textbookId
}

export async function importTextbook(
  subject: string,
  title: string,
  sourcePath: string,
) {
  const imported = await importTextbookSource(sourcePath)
  const textbookId = id()
  const now = Date.now()
  await ensureTaxonomyVersion(subject)
  try {
    await transaction(async () => {
    await execute(
      `INSERT INTO textbooks (
        id, subject, title, source_type, source_path, content_hash,
        extraction_status, extraction_method, is_current, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, 'needs_review', $7, 0, $8, $8)`,
      [
        textbookId,
        subject.trim(),
        title.trim(),
        imported.sourceType,
        imported.sourcePath,
        imported.contentHash,
        imported.extraction.extractionMethod,
        now,
      ],
    )
    for (const page of imported.extraction.pages) {
      await execute(
        `INSERT INTO textbook_pages (
          id, textbook_id, subject, page_number, evidence_text, source_path,
          extraction_method, confidence, verification_status, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'needs_review', $9, $9)`,
        [
          id(), textbookId, subject.trim(), page.pageNumber,
          page.evidenceText, imported.sourcePath, page.extractionMethod,
          page.confidence, now,
        ],
      )
    }
    await persistNormalizedKnowledgeNodes({
      textbookId, subject: subject.trim(), sourcePath: imported.sourcePath,
      extractionMethod: imported.extraction.extractionMethod, now,
      structure: normalizeTextbookStructure({ outline: imported.extraction.outline }),
    })
    })
  } catch (error) {
    await removeTextbookSource(imported.sourcePath).catch(() => {})
    throw error
  }
  return textbookId
}

export async function prepareCurriculumImport(
  sourcePath: string,
  requestId: string,
  onProgress?: (progress: TextbookExtractionProgress) => void,
) {
  // File selection, copying, PDF text extraction, Vision OCR and input assembly
  // deliberately happen without a curriculum_import_jobs row. A restart simply
  // clears the native temporary directory instead of exposing a false resume.
  return importTextbookSource(sourcePath, requestId, onProgress)
}

export async function getCurriculumImportJob(jobId: string): Promise<CurriculumImportJob | null> {
  const rows = await select<Record<string, unknown>[]>(
    'SELECT * FROM curriculum_import_jobs WHERE id = $1', [jobId],
  )
  return rows[0] ? rowToCurriculumImportJob(rows[0]) : null
}

export async function listCurriculumImportJobs(): Promise<CurriculumImportJob[]> {
  const rows = await select<Record<string, unknown>[]>(
    `SELECT * FROM curriculum_import_jobs ORDER BY updated_at DESC LIMIT 1`,
  )
  return rows.map(rowToCurriculumImportJob)
}

export async function getCurriculumImportResumeSlot() {
  return (await listCurriculumImportJobs())[0] ?? null
}

export async function reconcileCurriculumImportResumeSlot() {
  // Migration 0018 performs the legacy multi-row reconciliation. This startup
  // guard removes malformed rows if a database was edited outside Axiom.
  const rows = await select<Array<{ id: string; source_path: string }>>(
    `SELECT id, source_path FROM curriculum_import_jobs
     WHERE content_hash = '' OR extraction_json = '' OR provider = '' OR model = ''
     ORDER BY updated_at DESC`,
  )
  for (const row of rows) {
    await execute('DELETE FROM curriculum_import_jobs WHERE id = $1', [row.id])
    await removeTextbookSource(row.source_path).catch(() => {})
  }
  const slot = await getCurriculumImportResumeSlot()
  await cleanupTextbookImportTemp(slot ? [slot.sourcePath] : [])
  return slot
}

async function assertImportJobActive(jobId: string) {
  const job = await getCurriculumImportJob(jobId)
  if (!job) throw new Error('找不到教材导入任务')
  return job
}

export async function cancelCurriculumImportJob(jobId: string) {
  const job = await getCurriculumImportJob(jobId)
  if (!job) return
  await execute('DELETE FROM curriculum_import_jobs WHERE id = $1', [jobId])
  await removeTextbookSource(job.sourcePath).catch(() => {})
}

type CurriculumAIAnalysisStage = Exclude<CurriculumImportJob['stage'], 'waiting_for_review'>

function readableAttemptError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  // Provider failures are user-visible and persisted for recovery.  Do not
  // preserve a token-shaped value should a non-conforming provider echo it.
  return message
    .replace(/\bBearer\s+[A-Za-z0-9._~-]+/giu, 'Bearer [已隐藏]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/gu, 'sk-[已隐藏]')
}

function attemptIdentity(
  jobId: string,
  stage: CurriculumAIAnalysisStage,
  lease: CurriculumImportAttemptLease,
) {
  return {
    jobId,
    stage: stage as CurriculumAIStage,
    attemptId: lease.attemptId,
    attemptNumber: lease.attemptNumber,
    runToken: lease.runToken,
    runGeneration: lease.runGeneration,
  }
}

async function persistCurriculumProgress(
  jobId: string,
  stage: CurriculumAIAnalysisStage,
  lease: CurriculumImportAttemptLease,
  progress: { current: number; total: number; fraction: number; label: string },
) {
  return updateCurriculumImportProgress({
    ...attemptIdentity(jobId, stage, lease),
    progressCurrent: progress.current,
    progressTotal: progress.total,
    progressFraction: progress.fraction,
    progressLabel: progress.label,
  })
}

async function failCurriculumAttempt(
  jobId: string,
  stage: CurriculumAIAnalysisStage,
  lease: CurriculumImportAttemptLease,
  error: unknown,
) {
  await failCurriculumImportAttempt({
    ...attemptIdentity(jobId, stage, lease),
    errorMessage: readableAttemptError(error),
  })
}

async function runStructureStage(
  jobId: string,
  options: {
    inFlightRequest?: ReturnType<ReturnType<typeof getTextbookRecognitionProvider>['recognizeTextbook']>
    restartActiveAttempt?: boolean
  } = {},
): Promise<CurriculumImportJob | null> {
  const lease = await createCurriculumImportAttempt({
    jobId,
    stage: 'ai_analyzing_structure',
    promptVersion: TEXTBOOK_RECOGNITION_PROMPT_VERSION,
    schemaVersion: TEXTBOOK_RECOGNITION_SCHEMA_VERSION,
    restartActiveAttempt: options.restartActiveAttempt,
  })
  if (!lease.created) return getCurriculumImportJob(jobId)
  const initial = await assertImportJobActive(jobId)
  try {
    await persistCurriculumProgress(jobId, 'ai_analyzing_structure', lease, {
      current: 0, total: 1, fraction: .05, label: '正在识别教材结构',
    })
    const recognitionInput = {
      sourceName: initial.sourceName,
      pageCount: initial.extraction?.pageCount ?? 0,
      outline: initial.extraction?.outline ?? [],
      pages: initial.extraction?.pages ?? [],
    }
    const provider = getTextbookRecognitionProvider()
    const result = await (options.inFlightRequest ?? provider.recognizeTextbook(recognitionInput))
    const recognition = inferMissingTextbookRecognition(result.recognition, recognitionInput)
    if (!recognition.subject.value) {
      throw new Error('AI 未能识别教材科目，请在重试前检查 PDF 文字提取结果。')
    }
    const applied = await completeCurriculumImportAttempt({
      ...attemptIdentity(jobId, 'ai_analyzing_structure', lease),
      metadataJson: JSON.stringify(recognition),
      structureJson: JSON.stringify({
        chapters: recognition.chapters,
        legacy_outline: initial.extraction?.outline ?? [],
      }),
      rawOutput: result.rawOutput,
    })
    if (!applied) return getCurriculumImportJob(jobId)
  } catch (error) {
    await failCurriculumAttempt(jobId, 'ai_analyzing_structure', lease, error)
    return getCurriculumImportJob(jobId)
  }
  const next = await getCurriculumImportJob(jobId)
  return next?.stage === 'ai_generating_tags' ? runTagStage(jobId) : next
}

async function runTagStage(
  jobId: string,
  restartActiveAttempt = false,
): Promise<CurriculumImportJob | null> {
  const job = await assertImportJobActive(jobId)
  const lease = await createCurriculumImportAttempt({
    jobId,
    stage: 'ai_generating_tags',
    promptVersion: CURRICULUM_TAG_PROMPT_VERSION,
    schemaVersion: CURRICULUM_TAG_SCHEMA_VERSION,
    restartActiveAttempt,
  })
  if (!lease.created) return getCurriculumImportJob(jobId)
  try {
    if (!job.recognition || !job.extraction) throw new Error('知识结构阶段结果不完整')
    const subject = job.recognition.subject.value?.trim()
    if (!subject) throw new Error('请先识别并确认教材科目')
    const existing = await listTagDefinitions(subject)
    const provider = getCurriculumAnalysisProvider(job.provider ?? undefined, job.model ?? undefined)
    const existingTags = existing.map((tag) => ({
      id: tag.id, tagType: tag.tagType, canonicalName: tag.canonicalName, aliases: tag.aliases,
    }))
    const chunks = chunkTextbookPages(job.extraction.pages, job.extraction.outline)
    const totalChunks = Math.max(1, chunks.length)
    await persistCurriculumProgress(jobId, 'ai_generating_tags', lease, {
      current: 0, total: totalChunks, fraction: .3, label: '标签创建中',
    })
    const results = []
    const parsedChunks = []
    for (const [index, pages] of chunks.entries()) {
      const result = await provider.analyzeCurriculumStage({
        prompt: buildCurriculumTagPrompt({
          recognition: job.recognition, outline: job.structure, pages, existingTags,
        }),
        jsonSchema: curriculumTagsJSONSchema,
      })
      results.push(result)
      parsedChunks.push(parseCurriculumTags(result.rawOutput, subject))
      const current = index + 1
      await persistCurriculumProgress(jobId, 'ai_generating_tags', lease, {
        current, total: totalChunks,
        fraction: .3 + .55 * current / totalChunks,
        label: `标签创建中 · ${current}/${totalChunks}`,
      })
    }
    const parsed: CurriculumTagAnalysis = {
      subject,
      candidates: parsedChunks.flatMap((chunk) => chunk.candidates),
      warnings: parsedChunks.flatMap((chunk) => chunk.warnings),
    }
    const tags: CurriculumTagAnalysis = {
      ...parsed,
      candidates: reconcileCurriculumTagCandidates(parsed.candidates, existingTags),
    }
    const rawOutput = JSON.stringify(results.map((result) => result.rawOutput))
    const applied = await completeCurriculumImportAttempt({
      ...attemptIdentity(jobId, 'ai_generating_tags', lease),
      tagsJson: JSON.stringify(tags),
      providerTaskId: results.at(-1)?.providerTaskId ?? null,
      rawOutput,
    })
    if (!applied) return getCurriculumImportJob(jobId)
  } catch (error) {
    await failCurriculumAttempt(jobId, 'ai_generating_tags', lease, error)
    return getCurriculumImportJob(jobId)
  }
  return runAuditStage(jobId)
}

async function runAuditStage(
  jobId: string,
  restartActiveAttempt = false,
): Promise<CurriculumImportJob | null> {
  const job = await assertImportJobActive(jobId)
  const lease = await createCurriculumImportAttempt({
    jobId,
    stage: 'ai_auditing',
    promptVersion: CURRICULUM_AUDIT_PROMPT_VERSION,
    schemaVersion: CURRICULUM_AUDIT_SCHEMA_VERSION,
    restartActiveAttempt,
  })
  if (!lease.created) return getCurriculumImportJob(jobId)
  try {
    await persistCurriculumProgress(jobId, 'ai_auditing', lease, {
      current: 0, total: 1, fraction: .85, label: '正在检查分析结果',
    })
    const tags = job.tags as CurriculumTagAnalysis | null
    const subject = job.recognition?.subject.value?.trim()
    if (!tags || !subject) throw new Error('标签生成阶段结果不完整')
    const provider = getCurriculumAnalysisProvider(job.provider ?? undefined, job.model ?? undefined)
    const result = await provider.analyzeCurriculumStage({
      prompt: buildCurriculumAuditPrompt({
        subject, candidates: tags.candidates,
        knowledgeNames: tags.candidates.filter((tag) => tag.tagType === 'knowledge').map((tag) => tag.canonicalName),
      }),
      jsonSchema: curriculumAuditJSONSchema,
    })
    const audit = parseCurriculumAudit(result.rawOutput)
    const applied = await completeCurriculumImportAttempt({
      ...attemptIdentity(jobId, 'ai_auditing', lease),
      auditJson: JSON.stringify(audit),
      providerTaskId: result.providerTaskId,
      rawOutput: result.rawOutput,
    })
    if (!applied) return getCurriculumImportJob(jobId)
  } catch (error) {
    await failCurriculumAttempt(jobId, 'ai_auditing', lease, error)
  }
  return getCurriculumImportJob(jobId)
}

export async function createCurriculumImportJob(
  originalSourcePath: string,
  imported: ImportedTextbookSource,
) {
  const existing = await getCurriculumImportResumeSlot()
  if (existing) {
    await removeTextbookSource(imported.sourcePath).catch(() => {})
    throw new Error('上次教材分析尚未完成。开始新教材前请先继续或放弃上次结果。')
  }
  let provider: ReturnType<typeof getTextbookRecognitionProvider>
  try {
    provider = getTextbookRecognitionProvider()
  } catch (error) {
    await removeTextbookSource(imported.sourcePath).catch(() => {})
    throw error
  }
  const recognitionInput = {
    sourceName: sourceNameFromPath(originalSourcePath),
    pageCount: imported.extraction.pageCount,
    outline: imported.extraction.outline,
    pages: imported.extraction.pages,
  }
  const now = Date.now()
  const jobId = id()
  // Calling the provider creates the native/network request before the durable
  // slot is inserted. Thus a crash during extraction never leaves a checkpoint.
  const inFlightRequest = provider.recognizeTextbook(recognitionInput)
  try {
    await execute(
      `INSERT INTO curriculum_import_jobs (
        id, original_source_path, source_path, source_name, source_type, content_hash,
        status, resume_stage, page_count, extraction_method, extraction_json,
        provider, model, prompt_version, schema_version, input_hash,
        progress_current, progress_total, progress_fraction, progress_label,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, 'ai_analyzing_structure',
        'ai_analyzing_structure', $7, $8, $9, $10, $11, $12, $13, $14,
        0, 1, 0.05, '正在识别教材结构', $15, $15)`,
      [jobId, originalSourcePath, imported.sourcePath, sourceNameFromPath(originalSourcePath),
        imported.sourceType, imported.contentHash, imported.extraction.pageCount,
        imported.extraction.extractionMethod, JSON.stringify(imported.extraction), provider.id,
        provider.model, TEXTBOOK_RECOGNITION_PROMPT_VERSION,
        TEXTBOOK_RECOGNITION_SCHEMA_VERSION, await inputHash(recognitionInput), now],
    )
  } catch (error) {
    void inFlightRequest.catch(() => {})
    await removeTextbookSource(imported.sourcePath).catch(() => {})
    throw error
  }
  // Do not hold the import screen until every chapter has been analyzed.  The
  // durable row is already present and the stage runner owns all attempt and
  // late-result checks, so the UI can poll the single slot while this pipeline
  // advances through structure, tags, and audit in the background.
  void runStructureStage(jobId, { inFlightRequest }).catch(async (error) => {
    await execute(
      `UPDATE curriculum_import_jobs SET status = 'ai_failed_recoverable',
       resume_stage = 'waiting_for_review', error_message = $1,
       progress_label = '分析已暂停', updated_at = $2
       WHERE id = $3`,
      [readableAttemptError(error), Date.now(), jobId],
    ).catch(() => {})
  })
  return getCurriculumImportJob(jobId)
}

export async function runCurriculumImportJob(
  jobId: string,
  { restartActiveAttempt = false }: { restartActiveAttempt?: boolean } = {},
) {
  const job = await assertImportJobActive(jobId)
  try {
    await verifyTextbookSource(job.originalSourcePath, job.contentHash ?? '')
  } catch (error) {
    await execute(
      `UPDATE curriculum_import_jobs SET status = 'ai_failed_recoverable',
       error_message = $1, progress_label = '分析已暂停',
       updated_at = $2 WHERE id = $3`,
      [String(error), Date.now(), jobId],
    )
    return getCurriculumImportJob(jobId)
  }
  if (job.stage === 'waiting_for_review') {
    if (job.status === 'ai_failed_recoverable') {
      await execute(
        `UPDATE curriculum_import_jobs SET status = 'waiting_for_review',
         error_message = NULL, progress_current = 1, progress_total = 1,
         progress_fraction = 1, progress_label = '分析完成',
         updated_at = $1 WHERE id = $2`,
        [Date.now(), jobId],
      )
      return getCurriculumImportJob(jobId)
    }
    return job
  }
  // Providers without a server-side resumable task restart only the current
  // safe stage. A new attempt prevents a late response from replacing it.
  if (job.stage === 'ai_generating_tags') return runTagStage(jobId, restartActiveAttempt)
  if (job.stage === 'ai_auditing') return runAuditStage(jobId, restartActiveAttempt)
  return runStructureStage(jobId, { restartActiveAttempt })
}

export async function retryCurriculumImportJob(jobId: string) {
  return runCurriculumImportJob(jobId, { restartActiveAttempt: true })
}

export interface TextbookImportConfirmation {
  subject: string
  title: string
  grade?: string | null
  volume?: string | null
  publisher?: string | null
  edition?: string | null
  outline?: ImportedTextbookSource['extraction']['outline']
}

export async function saveCurriculumImportOutline(
  jobId: string,
  outline: ImportedTextbookSource['extraction']['outline'],
) {
  const job = await assertImportJobActive(jobId)
  if (!job.extraction) throw new Error('目录提取尚未完成')
  const extraction = { ...job.extraction, outline }
  await execute(
    `UPDATE curriculum_import_jobs SET extraction_json = $1,
     updated_at = $2 WHERE id = $3 AND status = 'waiting_for_review'`,
    [JSON.stringify(extraction), Date.now(), jobId],
  )
  return getCurriculumImportJob(jobId)
}

async function persistImportedTextbook(
  imported: ImportedTextbookSource,
  confirmation: TextbookImportConfirmation,
  tagAnalysis: CurriculumTagAnalysis | null,
  rejectedTagNames: string[],
  recognition: TextbookRecognition | null,
) {
  const subject = confirmation.subject.trim()
  const title = confirmation.title.trim()
  if (!subject || !title) throw new Error('请确认教材名称和科目')
  const textbookId = id()
  const now = Date.now()
  const outline = confirmation.outline ?? imported.extraction.outline
  const rejected = new Set(rejectedTagNames.map(normalizeTagName))
  const acceptedCandidates = (tagAnalysis?.candidates ?? []).filter(
    (candidate) => !rejected.has(normalizeTagName(candidate.canonicalName)),
  )
  const structure = normalizeTextbookStructure({
    chapters: recognition?.chapters,
    outline,
    tagCandidates: acceptedCandidates.map(structureTagReference),
  })
  await ensureTaxonomyVersion(subject)
  await transaction(async () => {
    await execute(
      `INSERT INTO textbooks (
        id, subject, title, grade, volume, publisher, edition, source_type, source_path,
        content_hash, extraction_status, extraction_method, is_current, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'needs_review', $11, 0, $12, $12)`,
      [
        textbookId, subject, title, confirmation.grade?.trim() || null,
        confirmation.volume?.trim() || null, confirmation.publisher?.trim() || null,
        confirmation.edition?.trim() || null, imported.sourceType, imported.sourcePath,
        imported.contentHash, imported.extraction.extractionMethod, now,
      ],
    )
    for (const page of imported.extraction.pages) {
      await execute(
        `INSERT INTO textbook_pages (
          id, textbook_id, subject, page_number, evidence_text, source_path,
          extraction_method, confidence, verification_status, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'needs_review', $9, $9)`,
        [id(), textbookId, subject, page.pageNumber, page.evidenceText, imported.sourcePath,
          page.extractionMethod, page.confidence, now],
      )
    }
    const references = await persistNormalizedKnowledgeNodes({
      textbookId, subject, sourcePath: imported.sourcePath,
      extractionMethod: imported.extraction.extractionMethod, now, structure,
    })
    for (const candidate of acceptedCandidates) {
      const reference = findPersistedKnowledgeReference(candidate, structure, references)
      const knowledgeNodeId = candidate.tagType === 'knowledge' ? reference?.id ?? null : null
      if (candidate.existingTagId) {
        if (candidate.tagType === 'knowledge' && knowledgeNodeId) {
          await execute(
            `UPDATE tag_definitions SET knowledge_node_id = COALESCE(knowledge_node_id, $1), updated_at = $2
             WHERE id = $3 AND subject = $4`,
            [knowledgeNodeId, now, candidate.existingTagId, subject],
          )
        }
        const linkReferences = candidate.tagType === 'knowledge' && reference
          ? [reference]
          : references.filter((item) => candidate.knowledgeNames.some(
            (name) => normalizeTagName(name) === normalizeTagName(item.name),
          ))
        for (const linked of linkReferences) {
          await execute(
            `INSERT OR IGNORE INTO curriculum_tag_knowledge_links (
              tag_id, knowledge_node_id, source, confidence, created_at
            ) VALUES ($1, $2, 'ai_inferred', $3, $4)`,
            [candidate.existingTagId, linked.id, candidate.confidence, now],
          )
        }
        continue
      }
      const tagId = id()
      const legacySource = candidate.origin === 'textbook_extracted' ? 'textbook' : 'model'
      await execute(
        `INSERT OR IGNORE INTO tag_definitions (
          id, subject, tag_type, canonical_name, description, knowledge_node_id,
          source, origin_kind, taxonomy_version, verification_status, lifecycle_status,
          method_class, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, 'needs_review', 'candidate',
          $9, $10, $10)`,
        [tagId, subject, candidate.tagType, candidate.canonicalName, candidate.description,
          knowledgeNodeId, legacySource, candidate.origin,
          candidate.tagType === 'method' ? 'optional' : null, now],
      )
      const tagRows = await select<Array<{ id: string }>>(
        `SELECT id FROM tag_definitions WHERE subject = $1 AND tag_type = $2
         AND canonical_name = $3 COLLATE NOCASE LIMIT 1`,
        [subject, candidate.tagType, candidate.canonicalName],
      )
      const persistedTagId = tagRows[0]?.id
      if (!persistedTagId) continue
      for (const alias of candidate.aliases) await execute(
        `INSERT OR IGNORE INTO tag_aliases (id, subject, tag_id, alias, source, created_at)
         VALUES ($1, $2, $3, $4, 'model', $5)`,
        [id(), subject, persistedTagId, alias, now],
      )
      for (const knowledgeName of candidate.knowledgeNames) {
        const linked = references.find((item) => normalizeTagName(item.name) === normalizeTagName(knowledgeName))
        if (linked) await execute(
          `INSERT OR IGNORE INTO curriculum_tag_knowledge_links (
            tag_id, knowledge_node_id, source, confidence, created_at
          ) VALUES ($1, $2, $3, $4, $5)`,
          [persistedTagId, linked.id,
            candidate.origin === 'textbook_extracted' ? 'textbook_extracted' : 'ai_inferred',
            candidate.confidence, now],
        )
      }
    }
  })
  return textbookId
}

export async function confirmCurriculumImportJob(
  jobId: string,
  confirmation: TextbookImportConfirmation,
) {
  const job = await assertImportJobActive(jobId)
  if (!job.extraction || !job.contentHash || !job.sourceType || !job.extractionMethod) {
    throw new Error('教材内容尚未提取完成')
  }
  const imported: ImportedTextbookSource = {
    sourcePath: await promoteTextbookSource(job.sourcePath),
    contentHash: job.contentHash,
    byteLength: 0,
    sourceType: job.sourceType === 'directory_image' ? 'directory_image' : 'pdf',
    extraction: job.extraction,
  }
  await execute('UPDATE curriculum_import_jobs SET source_path = $1, updated_at = $2 WHERE id = $3',
    [imported.sourcePath, Date.now(), jobId])
  const rawTagAnalysis = job.tags as CurriculumTagAnalysis | null
  const tagAnalysis = rawTagAnalysis
    ? {
        ...rawTagAnalysis,
        candidates: reconcileCurriculumTagCandidates(rawTagAnalysis.candidates,
          (await listTagDefinitions(confirmation.subject.trim())).map((tag) => ({
            id: tag.id, tagType: tag.tagType, canonicalName: tag.canonicalName, aliases: tag.aliases,
          }))),
      }
    : null
  const rejectedTagNames = job.audit && typeof job.audit === 'object' &&
    Array.isArray((job.audit as { rejectedNames?: unknown }).rejectedNames)
    ? (job.audit as { rejectedNames: string[] }).rejectedNames : []
  const textbookId = await persistImportedTextbook(
    imported, confirmation, tagAnalysis, rejectedTagNames, job.recognition,
  )
  await execute('DELETE FROM curriculum_import_jobs WHERE id = $1', [jobId])
  return textbookId
}

export async function listKnowledgeNodes(textbookId: string): Promise<KnowledgeNode[]> {
  const rows = await select<Record<string, unknown>[]>(
    `SELECT * FROM knowledge_nodes
     WHERE textbook_id = $1 AND archived_at IS NULL
     ORDER BY path, sort_order`,
    [textbookId],
  )
  return rows.map(rowToKnowledgeNode)
}

export async function listKnowledgeEdges(textbookId: string): Promise<KnowledgeEdge[]> {
  const rows = await select<Record<string, unknown>[]>(
    `SELECT edge.* FROM knowledge_edges edge
     JOIN knowledge_nodes source ON source.id = edge.from_node_id
     WHERE source.textbook_id = $1 ORDER BY edge.created_at`, [textbookId],
  )
  return rows.map((row) => ({
    id: String(row.id), subject: String(row.subject),
    fromNodeId: String(row.from_node_id), toNodeId: String(row.to_node_id),
    relationType: String(row.relation_type) as KnowledgeEdge['relationType'],
    confidence: Number(row.confidence), source: String(row.source) as KnowledgeEdge['source'],
    verificationStatus: String(row.verification_status) as KnowledgeEdge['verificationStatus'],
  }))
}

export async function addKnowledgeEdge(
  subject: string,
  fromNodeId: string,
  toNodeId: string,
  relationType: KnowledgeEdge['relationType'],
) {
  await execute(
    `INSERT INTO knowledge_edges (
      id, subject, from_node_id, to_node_id, relation_type, confidence,
      source, verification_status, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, 1, 'user', 'user_verified', $6, $6)`,
    [id(), subject, fromNodeId, toNodeId, relationType, Date.now()],
  )
}

export async function moveKnowledgeNode(input: {
  id: string
  textbookId: string
  subject: string
  canonicalName: string
  nodeType: KnowledgeNode['nodeType']
  parentId: string | null
  description?: string
}) {
  const rows = await select<Record<string, unknown>[]>(
    `SELECT * FROM knowledge_nodes
     WHERE id = $1 AND subject = $2 AND textbook_id = $3 AND archived_at IS NULL`,
    [input.id, input.subject, input.textbookId],
  )
  const node = rows[0]
  if (!node) throw new Error('找不到需要移动的知识节点')
  let parent: Record<string, unknown> | null = null
  if (input.parentId) {
    const parents = await select<Record<string, unknown>[]>(
      `SELECT * FROM knowledge_nodes
       WHERE id = $1 AND subject = $2 AND textbook_id = $3 AND archived_at IS NULL`,
      [input.parentId, input.subject, input.textbookId],
    )
    parent = parents[0] ?? null
    if (!parent) throw new Error('目标章节不属于当前教材')
    if (String(parent.node_type) !== 'chapter') throw new Error('知识点只能归属于章节或单元')
    if (String(parent.id) === input.id) throw new Error('节点不能移动到自身')
    const descendants = await select<Array<{ id: string }>>(
      `WITH RECURSIVE tree(id) AS (
         SELECT id FROM knowledge_nodes WHERE id = $1
         UNION ALL
         SELECT node.id FROM knowledge_nodes node JOIN tree ON node.parent_id = tree.id
       ) SELECT id FROM tree`,
      [input.id],
    )
    if (descendants.some((item) => item.id === String(parent?.id))) {
      throw new Error('节点不能移动到自己的子节点中')
    }
  }
  const canonicalName = input.canonicalName.trim()
  if (!canonicalName) throw new Error('节点名称不能为空')
  const nextNodeType: KnowledgeNode['nodeType'] = input.parentId ? 'knowledge' : 'chapter'
  if (nextNodeType === 'chapter' && String(node.node_type) !== 'chapter') {
    throw new Error('根级只能保存章节或单元')
  }
  if (nextNodeType === 'knowledge' && String(node.node_type) === 'chapter') {
    throw new Error('章节或单元不能移动到知识点层级')
  }
  const oldPath = String(node.path || node.canonical_name)
  const nextPath = parent
    ? `${String(parent.path || parent.canonical_name)}/${canonicalName}`
    : canonicalName
  const now = Date.now()
  const siblingRows = await select<Array<{ sort_order: number }>>(
    `SELECT COALESCE(max(sort_order), -1) AS sort_order FROM knowledge_nodes
     WHERE textbook_id = $1 AND subject = $2
       AND (($3 IS NULL AND parent_id IS NULL) OR parent_id = $3)
       AND id != $4 AND archived_at IS NULL`,
    [input.textbookId, input.subject, input.parentId, input.id],
  )
  const sortOrder = Number(siblingRows[0]?.sort_order ?? -1) + 1
  await transaction(async () => {
    await execute(
      `UPDATE knowledge_nodes
       SET canonical_name = CASE WHEN id = $1 THEN $2 ELSE canonical_name END,
           node_type = CASE WHEN id = $1 THEN $3 ELSE node_type END,
           parent_id = CASE WHEN id = $1 THEN $4 ELSE parent_id END,
           description = CASE WHEN id = $1 THEN $5 ELSE description END,
           sort_order = CASE WHEN id = $1 THEN $6 ELSE sort_order END,
           path = CASE
             WHEN id = $1 THEN $7
             ELSE $7 || substr(path, length($8) + 1)
           END,
           updated_at = $9
       WHERE (id = $1 OR path LIKE $8 || '/%')
         AND textbook_id = $10 AND subject = $11`,
      [
        input.id, canonicalName, nextNodeType, input.parentId,
        input.description?.trim() || null, sortOrder, nextPath, oldPath, now,
        input.textbookId, input.subject,
      ],
    )
  })
  return input.id
}

export async function saveKnowledgeNode(input: {
  id?: string
  textbookId: string
  subject: string
  canonicalName: string
  nodeType: KnowledgeNode['nodeType']
  parentId: string | null
  description?: string
}) {
  const now = Date.now()
  if (input.id) {
    return moveKnowledgeNode({ ...input, id: input.id })
  }
  const nodeId = id()
  const parentRows = input.parentId
    ? await select<Record<string, unknown>[]>(
      `SELECT path, canonical_name, node_type FROM knowledge_nodes
       WHERE id = $1 AND textbook_id = $2 AND subject = $3 AND archived_at IS NULL`,
      [input.parentId, input.textbookId, input.subject],
    )
    : []
  if (input.parentId && !parentRows[0]) throw new Error('目标章节不属于当前教材')
  if (input.parentId && String(parentRows[0]?.node_type) !== 'chapter') {
    throw new Error('知识点只能归属于章节或单元')
  }
  const parent = parentRows[0]
  const siblings = await select<Array<{ sort_order: number }>>(
    `SELECT COALESCE(max(sort_order), -1) AS sort_order FROM knowledge_nodes
     WHERE textbook_id = $1 AND subject = $2
       AND (($3 IS NULL AND parent_id IS NULL) OR parent_id = $3)
       AND archived_at IS NULL`,
    [input.textbookId, input.subject, input.parentId],
  )
  const name = input.canonicalName.trim()
  if (!name) throw new Error('节点名称不能为空')
  const path = parent ? `${String(parent.path || parent.canonical_name)}/${name}` : name
  await execute(
    `INSERT INTO knowledge_nodes (
      id, textbook_id, subject, canonical_name, node_type, parent_id, path,
      sort_order, description, extraction_method, confidence, verification_status, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'manual', 1, 'user_verified', $10, $10)`,
    [nodeId, input.textbookId, input.subject, name, input.parentId ? 'knowledge' : 'chapter', input.parentId, path,
      Number(siblings[0]?.sort_order ?? -1) + 1, input.description?.trim() || null, now],
  )
  return nodeId
}

export async function confirmKnowledgeNode(node: KnowledgeNode) {
  const now = Date.now()
  const taxonomyVersion = await ensureTaxonomyVersion(node.subject)
  await transaction(async () => {
    await execute(
      `UPDATE knowledge_nodes SET verification_status = 'user_verified',
       confidence = 1, updated_at = $1 WHERE id = $2 AND subject = $3`,
      [now, node.id, node.subject],
    )
    if (node.nodeType === 'knowledge' || ['definition', 'formula', 'theorem', 'property'].includes(node.nodeType)) {
      await execute(
        `INSERT INTO tag_definitions (
          id, subject, tag_type, canonical_name, knowledge_node_id, source,
          taxonomy_version, verification_status, lifecycle_status, created_at, updated_at
        ) VALUES ($1, $2, 'knowledge', $3, $4, 'textbook', $5,
          'user_verified', 'active', $6, $6)
        ON CONFLICT(subject, tag_type, canonical_name) DO UPDATE SET
          knowledge_node_id = excluded.knowledge_node_id,
          verification_status = 'user_verified', lifecycle_status = 'active',
          archived_at = NULL, updated_at = excluded.updated_at`,
        [id(), node.subject, node.canonicalName, node.id, taxonomyVersion, now],
      )
    }
  })
}

export async function archiveKnowledgeNode(node: KnowledgeNode) {
  await execute(
    `UPDATE knowledge_nodes SET archived_at = $1, updated_at = $1
     WHERE id = $2 AND subject = $3`,
    [Date.now(), node.id, node.subject],
  )
}

export { mergeKnowledgeNodes }

export async function listTagDefinitions(
  subject: string,
  tagType?: HorizonTagType,
): Promise<TagDefinition[]> {
  const rows = await select<Record<string, unknown>[]>(
    `SELECT td.*, kn.textbook_id,
       COALESCE(group_concat(ta.alias, char(31)), '') AS aliases
     FROM tag_definitions td
     LEFT JOIN knowledge_nodes kn ON kn.id = td.knowledge_node_id
     LEFT JOIN tag_aliases ta ON ta.tag_id = td.id AND ta.subject = td.subject
     WHERE td.subject = $1 AND ($2 = '' OR td.tag_type = $2)
     GROUP BY td.id
     ORDER BY td.tag_type, td.lifecycle_status, td.canonical_name`,
    [subject, tagType ?? ''],
  )
  return rows.map(rowToTagDefinition)
}

export interface TagDefinitionSummary extends TagDefinition {
  problemCount: number
}

export interface CurriculumTagStats {
  knowledgeCount: number
  methodCount: number
  modelCount: number
  errorCount: number
  needsReviewCount: number
  unmappedCount: number
  linkedProblemCount: number
}

export async function listTagDefinitionSummaries(
  subject: string,
  tagType: HorizonTagType,
  textbookId: string | null,
): Promise<TagDefinitionSummary[]> {
  const rows = await select<Record<string, unknown>[]>(
    `SELECT td.*, kn.textbook_id,
       COALESCE((SELECT group_concat(alias, char(31)) FROM tag_aliases
                 WHERE tag_id = td.id AND subject = td.subject), '') AS aliases,
       count(DISTINCT pt.problem_id) AS problem_count
     FROM tag_definitions td
     LEFT JOIN knowledge_nodes kn ON kn.id = td.knowledge_node_id
     LEFT JOIN problem_tags pt ON pt.tag_id = td.id AND pt.subject = td.subject
       AND pt.superseded_at IS NULL
     WHERE td.subject = $1 AND td.tag_type = $2
       AND ($2 != 'knowledge' OR ($3 != '' AND kn.textbook_id = $3))
     GROUP BY td.id
     ORDER BY td.lifecycle_status = 'candidate' DESC, td.canonical_name COLLATE NOCASE`,
    [subject, tagType, textbookId ?? ''],
  )
  return rows.map((row) => ({ ...rowToTagDefinition(row), problemCount: Number(row.problem_count) }))
}

export async function getCurriculumTagStats(
  subject: string,
  textbookId: string | null,
): Promise<CurriculumTagStats> {
  const [definitions, review, unmapped, linked] = await Promise.all([
    select<Array<{ tag_type: HorizonTagType; count: number }>>(
      `SELECT td.tag_type, count(*) AS count
       FROM tag_definitions td
       LEFT JOIN knowledge_nodes kn ON kn.id = td.knowledge_node_id
       WHERE td.subject = $1 AND td.lifecycle_status NOT IN ('archived', 'merged', 'rejected')
         AND (td.tag_type != 'knowledge' OR ($2 != '' AND kn.textbook_id = $2))
       GROUP BY td.tag_type`,
      [subject, textbookId ?? ''],
    ),
    select<Array<{ count: number }>>(
      `SELECT count(*) AS count FROM (
         SELECT td.id FROM tag_definitions td
         LEFT JOIN knowledge_nodes kn ON kn.id = td.knowledge_node_id
         WHERE td.subject = $1
           AND (td.verification_status = 'needs_review' OR td.lifecycle_status = 'candidate')
           AND (td.tag_type != 'knowledge' OR ($2 != '' AND kn.textbook_id = $2))
         UNION ALL
         SELECT pt.id FROM problem_tags pt
         WHERE pt.subject = $1 AND pt.superseded_at IS NULL
           AND (pt.verification_status = 'needs_review' OR pt.mapping_status != 'mapped')
       )`,
      [subject, textbookId ?? ''],
    ),
    select<Array<{ count: number }>>(
      `SELECT count(*) AS count FROM problem_tags
       WHERE subject = $1 AND superseded_at IS NULL AND mapping_status != 'mapped'`,
      [subject],
    ),
    select<Array<{ count: number }>>(
      `SELECT count(DISTINCT problem_id) AS count FROM problem_tags
       WHERE subject = $1 AND superseded_at IS NULL`, [subject],
    ),
  ])
  const counts = new Map(definitions.map((item) => [item.tag_type, Number(item.count)]))
  return {
    knowledgeCount: counts.get('knowledge') ?? 0,
    methodCount: counts.get('method') ?? 0,
    modelCount: counts.get('model') ?? 0,
    errorCount: counts.get('error') ?? 0,
    needsReviewCount: Number(review[0]?.count ?? 0),
    unmappedCount: Number(unmapped[0]?.count ?? 0),
    linkedProblemCount: Number(linked[0]?.count ?? 0),
  }
}

export interface TagReviewItem {
  id: string
  problemId: string
  tagId: string | null
  tagType?: HorizonTagType
  candidateName: string
  confidence: number
  evidence: string
  source?: ProblemTag['source']
  currentTargetName?: string | null
  textbookId?: string | null
  textbookTitle?: string | null
  mappingStatus: ProblemTag['mappingStatus']
  verificationStatus: ProblemTag['verificationStatus']
  isLocked: boolean
}

export async function listTagReviewItems(
  subject: string,
  tagType: HorizonTagType,
  textbookId: string | null = null,
) {
  const rows = await select<Record<string, unknown>[]>(
    `SELECT pt.*, COALESCE(td.canonical_name, pt.candidate_name, '') AS current_target_name,
       p.matched_textbook_id AS problem_textbook_id,
       matched.title AS matched_textbook_title
     FROM problem_tags pt
     JOIN problems p ON p.id = pt.problem_id
     LEFT JOIN tag_definitions td ON td.id = pt.tag_id
     LEFT JOIN textbooks matched ON matched.id = p.matched_textbook_id
     WHERE pt.subject = $1 AND pt.tag_type = $2
       AND pt.superseded_at IS NULL
       AND (pt.mapping_status IN ('unmapped', 'candidate', 'rejected')
         OR pt.verification_status IN ('needs_review', 'ai_verified', 'rejected'))
       AND (pt.tag_type != 'knowledge' OR ($3 != '' AND p.matched_textbook_id = $3))
     ORDER BY pt.updated_at DESC`,
    [subject, tagType, textbookId?.trim() ?? ''],
  )
  return rows.map((row): TagReviewItem => ({
    id: String(row.id), problemId: String(row.problem_id), tagId: nullableString(row.tag_id),
    tagType: String(row.tag_type) as HorizonTagType,
    candidateName: String(row.candidate_name ?? ''), confidence: Number(row.confidence),
    evidence: String(row.evidence ?? ''),
    source: String(row.source || 'model') as ProblemTag['source'],
    currentTargetName: nullableString(row.current_target_name),
    textbookId: nullableString(row.problem_textbook_id),
    textbookTitle: nullableString(row.matched_textbook_title),
    mappingStatus: String(row.mapping_status) as TagReviewItem['mappingStatus'],
    verificationStatus: String(row.verification_status) as TagReviewItem['verificationStatus'],
    isLocked: bool(row.is_locked),
  }))
}

export async function getCurriculumReviewCount(subject: string, textbookId: string | null) {
  const rows = await select<Array<{ count: number }>>(
    `SELECT count(*) AS count FROM (
       SELECT td.id
       FROM tag_definitions td
       LEFT JOIN knowledge_nodes kn ON kn.id = td.knowledge_node_id
       WHERE td.subject = $1
         AND td.lifecycle_status NOT IN ('archived', 'merged', 'rejected')
         AND td.verification_status NOT IN ('user_verified', 'rejected')
         AND (td.lifecycle_status = 'candidate' OR td.verification_status = 'needs_review')
         AND (td.tag_type != 'knowledge' OR ($2 != '' AND kn.textbook_id = $2 AND kn.archived_at IS NULL))
       UNION ALL
       SELECT pt.id
       FROM problem_tags pt
       JOIN problems p ON p.id = pt.problem_id
       WHERE pt.subject = $1 AND pt.superseded_at IS NULL
         AND pt.is_locked = 0
         AND pt.verification_status NOT IN ('user_verified', 'rejected')
         AND (pt.mapping_status IN ('unmapped', 'candidate')
           OR pt.verification_status IN ('needs_review', 'ai_verified'))
         AND (pt.tag_type != 'knowledge' OR ($2 != '' AND p.matched_textbook_id = $2))
     )`,
    [subject, textbookId?.trim() ?? ''],
  )
  return Number(rows[0]?.count ?? 0)
}

export async function createTagDefinition(input: {
  subject: string
  tagType: HorizonTagType
  canonicalName: string
  description?: string
  methodClass?: 'core' | 'optional' | null
  approved?: boolean
}) {
  const now = Date.now()
  const tagId = id()
  const taxonomyVersion = await ensureTaxonomyVersion(input.subject)
  await execute(
    `INSERT INTO tag_definitions (
      id, subject, tag_type, canonical_name, description, source, origin_kind,
      verification_status, lifecycle_status, method_class, taxonomy_version,
      created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, 'user', 'user_created', $6, $7, $8, $9, $10, $10)`,
    [tagId, input.subject, input.tagType, input.canonicalName.trim(),
      input.description?.trim() || null,
      input.approved ? 'user_verified' : 'needs_review',
      input.approved ? 'active' : 'candidate', input.methodClass ?? null,
      taxonomyVersion, now],
  )
  return tagId
}

export async function reviewTagDefinition(
  tag: TagDefinition,
  decision: 'approve' | 'reject' | 'archive',
) {
  const lifecycle = decision === 'approve' ? 'active' : decision === 'reject' ? 'rejected' : 'archived'
  const verification = decision === 'approve' ? 'user_verified' : 'rejected'
  const now = Date.now()
  const taxonomyVersion = await ensureTaxonomyVersion(tag.subject)
  await execute(
    `UPDATE tag_definitions SET lifecycle_status = $1, verification_status = $2,
     archived_at = $3, taxonomy_version = $4, updated_at = $5
     WHERE id = $6 AND subject = $7`,
    [lifecycle, verification, decision === 'archive' ? now : null,
      taxonomyVersion, now, tag.id, tag.subject],
  )
}

export type BulkReviewDecision = 'approve' | 'reject'

export async function bulkReviewTagScope(input: {
  subject: string
  tagType: HorizonTagType
  textbookId: string | null
  definitionIds: string[]
  problemTagIds: string[]
  decision: BulkReviewDecision
}) {
  return bulkReviewCurriculumTags({
    subject: input.subject,
    tagType: input.tagType,
    textbookId: input.textbookId,
    definitionIds: input.definitionIds,
    problemTagIds: input.problemTagIds,
    decision: input.decision,
  })
}

export async function publishTaxonomyVersion(subject: string, note: string) {
  const now = Date.now()
  return transaction(async () => {
    const rows = await select<Array<{ version: number }>>(
      'SELECT COALESCE(max(version), 0) AS version FROM taxonomy_versions WHERE subject = $1',
      [subject],
    )
    const version = Number(rows[0]?.version || 0) + 1
    await execute(
      `UPDATE taxonomy_versions SET status = 'retired'
       WHERE subject = $1 AND status = 'published'`, [subject],
    )
    await execute(
      `INSERT INTO taxonomy_versions (
        id, subject, version, status, note, created_at, published_at
      ) VALUES ($1, $2, $3, 'published', $4, $5, $5)`,
      [id(), subject, version, note.trim() || null, now],
    )
    return version
  })
}

export async function addTagAlias(tag: TagDefinition, alias: string) {
  await execute(
    `INSERT INTO tag_aliases (id, subject, tag_id, alias, source, created_at)
     VALUES ($1, $2, $3, $4, 'user', $5)`,
    [id(), tag.subject, tag.id, alias.trim(), Date.now()],
  )
}

export { mergeTagDefinitions }

export async function listProblemTags(problemId: string): Promise<ProblemTag[]> {
  const rows = await select<Record<string, unknown>[]>(
    `SELECT pt.*, COALESCE(td.canonical_name, pt.candidate_name, '') AS canonical_name
     FROM problem_tags pt LEFT JOIN tag_definitions td ON td.id = pt.tag_id
     WHERE pt.problem_id = $1 AND pt.superseded_at IS NULL
     ORDER BY pt.tag_type, pt.role, canonical_name`,
    [problemId],
  )
  return rows.map((row) => ({
    id: String(row.id),
    problemId: String(row.problem_id),
    subject: String(row.subject),
    tagType: String(row.tag_type) as ProblemTag['tagType'],
    tagId: nullableString(row.tag_id),
    canonicalName: String(row.canonical_name),
    role: String(row.role) as ProblemTag['role'],
    mappingStatus: String(row.mapping_status) as ProblemTag['mappingStatus'],
    confidence: Number(row.confidence),
    evidence: String(row.evidence),
    source: String(row.source) as ProblemTag['source'],
    taxonomyVersion: Number(row.taxonomy_version),
    modelRunId: nullableString(row.model_run_id),
    verificationStatus: String(row.verification_status) as ProblemTag['verificationStatus'],
    isLocked: bool(row.is_locked),
    updatedAt: Number(row.updated_at),
  }))
}

export async function confirmProblemTag(problemTagId: string, tagId?: string) {
  const now = Date.now()
  if (tagId) {
    const rows = await select<Array<{
      problem_subject: string
      problem_textbook_id: string | null
      problem_tag_type: HorizonTagType
      tag_subject: string
      tag_type: HorizonTagType
      tag_textbook_id: string | null
      tag_lifecycle_status: TagDefinition['lifecycleStatus']
      tag_archived_at: number | null
    }>>(
      `SELECT pt.subject AS problem_subject, pt.tag_type AS problem_tag_type,
          p.matched_textbook_id AS problem_textbook_id,
          td.subject AS tag_subject, td.tag_type, tag_node.textbook_id AS tag_textbook_id,
          td.lifecycle_status AS tag_lifecycle_status, td.archived_at AS tag_archived_at
       FROM problem_tags pt
       JOIN problems p ON p.id = pt.problem_id
       JOIN tag_definitions td ON td.id = $1
       LEFT JOIN knowledge_nodes tag_node ON tag_node.id = td.knowledge_node_id
       WHERE pt.id = $2 AND pt.superseded_at IS NULL LIMIT 1`,
      [tagId, problemTagId],
    )
    const target = rows[0]
    if (!target || target.problem_subject !== target.tag_subject ||
      target.problem_tag_type !== target.tag_type ||
      target.tag_lifecycle_status !== 'active' || target.tag_archived_at !== null ||
      (target.tag_type === 'knowledge' &&
        (!target.problem_textbook_id || target.problem_textbook_id !== target.tag_textbook_id))) {
      throw new Error('标签不属于本题的科目或匹配教材，无法确认')
    }
    await execute(
      `UPDATE problem_tags SET tag_id = $1, candidate_name = NULL,
       mapping_status = 'mapped', source = 'user', verification_status = 'user_verified',
       is_locked = 1, confidence = 1, updated_at = $2 WHERE id = $3`,
      [tagId, now, problemTagId],
    )
  } else {
    const rows = await select<Array<{
      problem_tag_type: HorizonTagType
      problem_subject: string
      problem_textbook_id: string | null
      tag_subject: string
      tag_type: HorizonTagType
      tag_textbook_id: string | null
      tag_lifecycle_status: TagDefinition['lifecycleStatus']
      tag_archived_at: number | null
      tag_id: string | null
    }>>(
      `SELECT pt.tag_id, pt.tag_type AS problem_tag_type,
          pt.subject AS problem_subject, p.matched_textbook_id AS problem_textbook_id,
          td.subject AS tag_subject, td.tag_type, tag_node.textbook_id AS tag_textbook_id,
          td.lifecycle_status AS tag_lifecycle_status, td.archived_at AS tag_archived_at
       FROM problem_tags pt
       JOIN problems p ON p.id = pt.problem_id
       LEFT JOIN tag_definitions td ON td.id = pt.tag_id
       LEFT JOIN knowledge_nodes tag_node ON tag_node.id = td.knowledge_node_id
       WHERE pt.id = $1 AND pt.superseded_at IS NULL LIMIT 1`,
      [problemTagId],
    )
    const target = rows[0]
    if (!target || !target.tag_id || target.problem_subject !== target.tag_subject ||
      target.problem_tag_type !== target.tag_type ||
      target.tag_lifecycle_status !== 'active' || target.tag_archived_at !== null ||
      (target.tag_type === 'knowledge' &&
        (!target.problem_textbook_id || target.problem_textbook_id !== target.tag_textbook_id))) {
      throw new Error('标签不属于本题的科目或匹配教材，无法确认')
    }
    await execute(
      `UPDATE problem_tags SET source = 'user', verification_status = 'user_verified',
       is_locked = 1, updated_at = $1 WHERE id = $2 AND tag_id IS NOT NULL`,
      [now, problemTagId],
    )
  }
}

export async function rejectProblemTag(problemTagId: string) {
  const now = Date.now()
  await execute(
    `UPDATE problem_tags SET mapping_status = 'rejected', tag_id = NULL,
       candidate_name = COALESCE(NULLIF(candidate_name, ''), '已驳回映射'),
       verification_status = 'rejected', is_locked = 1, source = 'user', updated_at = $1
     WHERE id = $2 AND superseded_at IS NULL AND is_locked = 0
       AND verification_status NOT IN ('user_verified', 'rejected')`,
    [now, problemTagId],
  )
}

export async function removeProblemTag(problemTagId: string) {
  await execute(
    `UPDATE problem_tags SET superseded_at = $1, updated_at = $1 WHERE id = $2`,
    [Date.now(), problemTagId],
  )
}

export async function addProblemTag(
  problemId: string,
  subject: string,
  tag: TagDefinition,
  role: 'primary' | 'secondary' = 'secondary',
) {
  if (tag.subject !== subject) throw new Error('不能把其他科目的标签添加到本题')
  if (tag.tagType === 'knowledge') {
    const rows = await select<Array<{ matched_textbook_id: string | null }>>(
      `SELECT matched_textbook_id FROM problems WHERE id = $1 AND trim(COALESCE(NULLIF(user_subject, ''), NULLIF(ai_subject, ''), NULLIF(subject, ''))) = $2`,
      [problemId, subject],
    )
    if (!rows[0]?.matched_textbook_id || tag.textbookId !== rows[0].matched_textbook_id) {
      throw new Error('题目尚未匹配教材，知识点不能跨教材添加')
    }
  }
  const now = Date.now()
  await execute(
    `INSERT INTO problem_tags (
      id, problem_id, subject, tag_type, tag_id, candidate_name, role,
      mapping_status, confidence, evidence, source, taxonomy_version,
      verification_status, is_locked, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, NULL, $6, 'mapped', 1,
      '用户在题目详情中添加', 'user', $7, 'user_verified', 1, $8, $8)`,
    [id(), problemId, subject, tag.tagType, tag.id, role, tag.taxonomyVersion, now],
  )
}

export interface ProblemDifficultyView {
  id: string
  level: 'basic' | 'intermediate' | 'advanced'
  score: number | null
  reason: string
  confidence: number
  source: 'model' | 'user' | 'legacy'
  verificationStatus: string
  isLocked: boolean
}

export async function getProblemDifficulty(problemId: string): Promise<ProblemDifficultyView | null> {
  const rows = await select<Record<string, unknown>[]>(
    `SELECT * FROM problem_difficulties
     WHERE problem_id = $1 AND superseded_at IS NULL LIMIT 1`, [problemId],
  )
  const row = rows[0]
  return row ? {
    id: String(row.id), level: String(row.level) as ProblemDifficultyView['level'],
    score: nullableNumber(row.score), reason: String(row.reason || ''),
    confidence: Number(row.confidence), source: String(row.source) as ProblemDifficultyView['source'],
    verificationStatus: String(row.verification_status), isLocked: bool(row.is_locked),
  } : null
}

export async function confirmProblemDifficulty(
  difficultyId: string,
  level?: ProblemDifficultyView['level'],
) {
  await execute(
    `UPDATE problem_difficulties SET level = COALESCE($1, level), source = 'user',
     verification_status = 'user_verified', is_locked = 1, confidence = 1,
     updated_at = $2 WHERE id = $3 AND superseded_at IS NULL`,
    [level ?? null, Date.now(), difficultyId],
  )
}

export async function applyControlledProblemAnalysis(
  problemId: string,
  modelRunId: string,
  analysis: AIProblemAnalysis,
) {
  const problems = await select<Array<{
    effective_subject: string
    matched_textbook_id: string | null
    textbook_match_locked: number
  }>>(
    `SELECT trim(COALESCE(NULLIF(user_subject, ''), NULLIF(ai_subject, ''), NULLIF(subject, ''))) AS effective_subject,
       matched_textbook_id, textbook_match_locked
     FROM problems WHERE id = $1`,
    [problemId],
  )
  const subject = String(problems[0]?.effective_subject || '')
  if (!subject) return
  if (analysis.subject.trim() && analysis.subject.trim().toLocaleLowerCase('zh-CN') !== subject.toLocaleLowerCase('zh-CN')) {
    return
  }
  const textbooks = (await select<Record<string, unknown>[]>(
    `SELECT * FROM textbooks WHERE subject = $1 ORDER BY updated_at DESC`, [subject],
  )).map(rowToTextbook)
  const legacyCurrentTextbookId = textbooks.find((book) => book.isCurrent && book.archivedAt === null)?.id ?? null
  const textbookMatch = resolveProblemTextbook({
    subject,
    lockedTextbookId: Number(problems[0]?.textbook_match_locked ?? 0) === 1
      ? nullableString(problems[0]?.matched_textbook_id)
      : null,
    hint: analysis.textbookHint ?? null,
    textbooks,
    legacyCurrentTextbookId,
  })
  const definitions = await listTagDefinitions(subject)
  const taxonomyVersion = await ensureTaxonomyVersion(subject)
  const candidateGroups: Array<[HorizonTagType, typeof analysis.knowledgeTags]> = [
    ['knowledge', analysis.knowledgeTags ?? []],
    ['method', analysis.methodTags ?? []],
    ['model', analysis.modelTags ?? []],
    ['error', analysis.errorCategories ?? []],
  ]
  const now = Date.now()
  await transaction(async () => {
    if (Number(problems[0]?.textbook_match_locked ?? 0) !== 1) {
      await execute(
        `UPDATE problems SET matched_textbook_id = $1, textbook_match_confidence = $2,
         textbook_match_reason = $3, textbook_match_source = $4, textbook_match_locked = 0,
         textbook_match_updated_at = $5, updated_at = $5 WHERE id = $6`,
        [textbookMatch.textbook?.id ?? null, textbookMatch.confidence, textbookMatch.reason,
          textbookMatch.source, now, problemId],
      )
    }
    await execute(
      `UPDATE problem_tags SET superseded_at = $1, updated_at = $1
       WHERE problem_id = $2 AND superseded_at IS NULL AND source = 'model'
         AND is_locked = 0 AND verification_status != 'user_verified'`,
      [now, problemId],
    )
    for (const [tagType, candidates = []] of candidateGroups) {
      const mappings = mapCandidatesToControlledTags(
        subject, tagType, candidates, definitions, textbookMatch.textbook?.id ?? null,
      )
      for (const mapping of mappings) {
        if (!mapping.definition) {
          await execute(
            `INSERT OR IGNORE INTO tag_definitions (
              id, subject, tag_type, canonical_name, source, verification_status,
              lifecycle_status, method_class, taxonomy_version, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, 'model', 'needs_review', 'candidate', $5, $6, $7, $7)`,
            [id(), subject, tagType, mapping.candidate.name,
              tagType === 'method' ? (mapping.candidate.role === 'primary' ? 'core' : 'optional') : null,
              taxonomyVersion, now],
          )
        }
        await execute(
          `INSERT OR IGNORE INTO problem_tags (
            id, problem_id, subject, tag_type, tag_id, candidate_name, role,
            mapping_status, confidence, evidence, source, taxonomy_version,
            model_run_id, verification_status, is_locked, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'model', $11,
            $12, $13, 0, $14, $14)`,
          [id(), problemId, subject, tagType, mapping.definition?.id ?? null,
            mapping.definition ? null : mapping.candidate.name, mapping.candidate.role,
            mapping.mappingStatus, mapping.candidate.confidence, mapping.candidate.evidence,
            mapping.definition?.taxonomyVersion ?? taxonomyVersion, modelRunId,
            mapping.verificationStatus, now],
        )
      }
    }
    const existingLockedDifficulty = await select<Array<{ id: string }>>(
      `SELECT id FROM problem_difficulties WHERE problem_id = $1
       AND superseded_at IS NULL AND (is_locked = 1 OR verification_status = 'user_verified')`,
      [problemId],
    )
    if (analysis.difficulty && existingLockedDifficulty.length === 0) {
      await execute(
        `UPDATE problem_difficulties SET superseded_at = $1, updated_at = $1
         WHERE problem_id = $2 AND superseded_at IS NULL`,
        [now, problemId],
      )
      await execute(
        `INSERT INTO problem_difficulties (
          id, problem_id, subject, level, score, reason, confidence, source,
          model_run_id, verification_status, is_locked, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'model', $8, $9, 0, $10, $10)`,
        [id(), problemId, subject, analysis.difficulty.level, analysis.difficulty.score,
          analysis.difficulty.reason, analysis.difficulty.confidence, modelRunId,
          analysis.difficulty.confidence >= 0.72 ? 'ai_verified' : 'needs_review', now],
      )
    }
  })
}

export interface RelabelBatch {
  id: string
  subject: string
  status: 'pending' | 'processing' | 'paused' | 'completed' | 'cancelled' | 'failed'
  totalCount: number
  completedCount: number
  failedCount: number
  needsReviewCount: number
  pausedAt: number | null
  createdAt: number
  updatedAt: number
}

export interface RelabelModelRunSummary {
  id: string
  problemId: string
  provider: string
  model: string
  repairStrategy: string | null
  errorMessage: string | null
  status: string
}

function redactRelabelError(value: unknown) {
  return String(value)
    .replace(/\bBearer\s+[A-Za-z0-9._~-]+/giu, 'Bearer [已隐藏]')
    .replace(/\b(?:sk-(?:ant-)?|AIza|gsk_|xai-)[A-Za-z0-9._~-]{8,}/giu, '[已隐藏]')
    .replace(/((?:api[_-]?key|authorization|access[_-]?token|secret|token)\s*[:=]\s*)["']?[A-Za-z0-9._~+/=-]{8,}["']?/giu, '$1[已隐藏]')
    .slice(0, 1200)
}

export async function createRelabelBatch(subject: string): Promise<string> {
  const batchId = id()
  const now = Date.now()
  await transaction(async () => {
    const active = await select<Array<{ id: string }>>(
      `SELECT id FROM tag_relabel_batches
       WHERE subject = $1 AND status IN ('pending', 'processing')
       ORDER BY updated_at DESC LIMIT 1`,
      [subject],
    )
    if (active[0]) return
    const problems = await select<Array<{ id: string }>>(
      `SELECT id FROM problems WHERE status = 'saved' AND deleted_at IS NULL
       AND trim(COALESCE(NULLIF(user_subject, ''), NULLIF(ai_subject, ''), NULLIF(subject, ''))) = $1`,
      [subject],
    )
    const inserted = await execute(
      `INSERT OR IGNORE INTO tag_relabel_batches (id, subject, total_count, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $4)`,
      [batchId, subject, problems.length, now],
    )
    if (inserted.rowsAffected !== 1) return
    for (const problem of problems) {
      await execute(
        `INSERT INTO tag_relabel_items (batch_id, problem_id, subject, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $4)`,
        [batchId, problem.id, subject, now],
      )
    }
  })
  const active = await select<Array<{ id: string }>>(
    `SELECT id FROM tag_relabel_batches
     WHERE subject = $1 AND status IN ('pending', 'processing')
     ORDER BY updated_at DESC LIMIT 1`,
    [subject],
  )
  if (active[0]) return active[0].id
  return batchId
}

export async function getRelabelScopeCount(subject: string) {
  const rows = await select<Array<{ count: number }>>(
    `SELECT count(*) AS count FROM problems WHERE status = 'saved' AND deleted_at IS NULL
     AND trim(COALESCE(NULLIF(user_subject, ''), NULLIF(ai_subject, ''), NULLIF(subject, ''))) = $1`,
    [subject],
  )
  return Number(rows[0]?.count ?? 0)
}

export async function listRelabelItems(batchId: string) {
  return select<Array<{ problem_id: string; status: string; model_run_id: string | null }>>(
    'SELECT problem_id, status, model_run_id FROM tag_relabel_items WHERE batch_id = $1 ORDER BY created_at',
    [batchId],
  )
}

export interface RelabelBatchItemClaim {
  problemId: string
  modelRunId: string | null
  claimToken: string
}

export async function recoverRelabelBatchItemsAfterRestart() {
  await recoverRelabelBatchItems()
}

export async function claimRelabelItem(
  batchId: string,
  claimToken: string,
): Promise<RelabelBatchItemClaim | null> {
  return claimRelabelBatchItem(batchId, claimToken)
}

export async function bindRelabelItemModelRun(input: {
  batchId: string
  problemId: string
  claimToken: string
  modelRunId: string
}) {
  return bindRelabelBatchItemModelRun(input)
}

export async function releaseRelabelItemClaim(input: {
  batchId: string
  problemId: string
  claimToken: string
  modelRunId: string | null
}) {
  const now = Date.now()
  return transaction(async () => {
    const result = await execute(
      `UPDATE tag_relabel_items
       SET status = CASE WHEN $4 IS NULL THEN 'pending' ELSE 'queued' END,
           model_run_id = $4, claim_token = NULL, claimed_at = NULL,
           error_message = NULL, updated_at = $5
       WHERE batch_id = $1 AND problem_id = $2 AND claim_token = $3
         AND status = 'processing'`,
      [input.batchId, input.problemId, input.claimToken, input.modelRunId, now],
    )
    return result.rowsAffected === 1
  })
}

export async function markRelabelItemQueued(batchId: string, problemId: string, modelRunId: string) {
  const now = Date.now()
  return transaction(async () => {
    const itemUpdate = await execute(
      `UPDATE tag_relabel_items SET status = 'queued', model_run_id = $1, updated_at = $2
       WHERE batch_id = $3 AND problem_id = $4 AND status = 'pending'
         AND EXISTS (SELECT 1 FROM tag_relabel_batches batch
                     WHERE batch.id = $3 AND batch.paused_at IS NULL
                       AND batch.status NOT IN ('cancelled', 'completed'))`,
      [modelRunId, now, batchId, problemId],
    )
    if (itemUpdate.rowsAffected !== 1) return false
    await execute(
      `UPDATE tag_relabel_batches SET status = 'processing', updated_at = $1
       WHERE id = $2 AND status = 'pending' AND paused_at IS NULL`,
      [now, batchId],
    )
    return true
  })
}

export async function refreshRelabelBatch(batchId: string): Promise<RelabelBatch | null> {
  const now = Date.now()
  await transaction(async () => {
    await execute(
      `UPDATE tag_relabel_items SET
       status = (
         SELECT CASE mr.status WHEN 'completed' THEN 'completed' WHEN 'failed' THEN 'failed'
           WHEN 'cancelled' THEN 'cancelled' ELSE tag_relabel_items.status END
         FROM model_runs mr WHERE mr.id = tag_relabel_items.model_run_id
       ),
       claim_token = CASE (SELECT mr.status FROM model_runs mr WHERE mr.id = tag_relabel_items.model_run_id)
         WHEN 'completed' THEN NULL WHEN 'failed' THEN NULL WHEN 'cancelled' THEN NULL
         ELSE claim_token END,
       claimed_at = CASE (SELECT mr.status FROM model_runs mr WHERE mr.id = tag_relabel_items.model_run_id)
         WHEN 'completed' THEN NULL WHEN 'failed' THEN NULL WHEN 'cancelled' THEN NULL
         ELSE claimed_at END,
       updated_at = $1
       WHERE batch_id = $2 AND model_run_id IS NOT NULL`,
      [now, batchId],
    )
    await execute(
      `UPDATE tag_relabel_batches SET
        completed_count = (SELECT count(*) FROM tag_relabel_items WHERE batch_id = $1 AND status = 'completed'),
        failed_count = (SELECT count(*) FROM tag_relabel_items WHERE batch_id = $1 AND status = 'failed'),
        status = CASE
          WHEN status = 'cancelled' THEN 'cancelled'
          WHEN paused_at IS NOT NULL THEN 'processing'
          WHEN EXISTS (SELECT 1 FROM tag_relabel_items WHERE batch_id = $1 AND status IN ('pending','queued','processing'))
            THEN 'processing'
          WHEN EXISTS (SELECT 1 FROM tag_relabel_items WHERE batch_id = $1 AND status = 'failed') THEN 'failed'
          ELSE 'completed' END,
        completed_at = CASE WHEN paused_at IS NULL AND NOT EXISTS (
          SELECT 1 FROM tag_relabel_items WHERE batch_id = $1 AND status IN ('pending','queued','processing')
        ) THEN $2 ELSE NULL END,
        updated_at = $2 WHERE id = $1`,
      [batchId, now],
    )
  })
  const rows = await select<Record<string, unknown>[]>(
    'SELECT * FROM tag_relabel_batches WHERE id = $1', [batchId],
  )
  const row = rows[0]
  if (!row) return null
  const review = await select<Array<{ count: number }>>(
    `SELECT count(*) AS count FROM problem_tags tag
     JOIN tag_relabel_items item ON item.problem_id = tag.problem_id
     WHERE item.batch_id = $1 AND item.status = 'completed' AND tag.superseded_at IS NULL
       AND (tag.verification_status = 'needs_review' OR tag.mapping_status != 'mapped')`,
    [batchId],
  )
  return {
    id: String(row.id), subject: String(row.subject),
    status: row.paused_at != null ? 'paused' : String(row.status) as RelabelBatch['status'],
    totalCount: Number(row.total_count), completedCount: Number(row.completed_count),
    failedCount: Number(row.failed_count), needsReviewCount: Number(review[0]?.count ?? 0),
    pausedAt: nullableNumber(row.paused_at), createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
  }
}

export async function getLatestRelabelBatch(subject: string): Promise<RelabelBatch | null> {
  const rows = await select<Array<{ id: string }>>(
    `SELECT id FROM tag_relabel_batches WHERE subject = $1
     ORDER BY updated_at DESC LIMIT 1`, [subject],
  )
  return rows[0] ? refreshRelabelBatch(rows[0].id) : null
}

export async function pauseRelabelBatch(batchId: string) {
  await execute(
    `UPDATE tag_relabel_batches SET paused_at = $1, updated_at = $1
     WHERE id = $2 AND status IN ('pending', 'processing')`,
    [Date.now(), batchId],
  )
  return refreshRelabelBatch(batchId)
}

export async function resumeRelabelBatch(batchId: string) {
  await execute(
    `UPDATE tag_relabel_batches SET paused_at = NULL,
       status = CASE WHEN status = 'pending' THEN 'processing' ELSE status END,
       updated_at = $1 WHERE id = $2 AND paused_at IS NOT NULL`,
    [Date.now(), batchId],
  )
  return refreshRelabelBatch(batchId)
}

export async function nextPendingRelabelItem(batchId: string) {
  const rows = await select<Array<{ problem_id: string }>>(
    `SELECT item.problem_id FROM tag_relabel_items item
     JOIN tag_relabel_batches batch ON batch.id = item.batch_id
     WHERE item.batch_id = $1 AND item.status = 'pending'
       AND batch.paused_at IS NULL AND batch.status IN ('pending', 'processing')
     ORDER BY item.created_at LIMIT 1`,
    [batchId],
  )
  return rows[0]?.problem_id ?? null
}

export async function failRelabelItem(
  batchId: string,
  problemId: string,
  error: unknown,
  claimToken?: string,
) {
  await execute(
    `UPDATE tag_relabel_items SET status = 'failed', error_message = $1,
       claim_token = NULL, claimed_at = NULL, updated_at = $2
     WHERE batch_id = $3 AND problem_id = $4 AND status IN ('pending', 'queued', 'processing')
       AND ($5 IS NULL OR claim_token = $5)`,
    [JSON.stringify({
      problem_id: problemId,
      model_run_id: null,
      provider: null,
      model: null,
      repairStrategy: null,
      error_summary: redactRelabelError(error),
    }), Date.now(), batchId, problemId, claimToken ?? null],
  )
}

export async function getRelabelModelRunSummary(
  modelRunId: string,
): Promise<RelabelModelRunSummary | null> {
  const rows = await select<Record<string, unknown>[]>(
    `SELECT id, problem_id, provider, model, repair_strategy, error_message, status
     FROM model_runs WHERE id = $1 LIMIT 1`,
    [modelRunId],
  )
  const row = rows[0]
  if (!row) return null
  return {
    id: String(row.id),
    problemId: String(row.problem_id),
    provider: String(row.provider),
    model: String(row.model),
    repairStrategy: nullableString(row.repair_strategy),
    errorMessage: row.error_message == null ? null : redactRelabelError(row.error_message),
    status: String(row.status),
  }
}

export async function recordRelabelModelRunFailure(
  batchId: string,
  problemId: string,
  summary: RelabelModelRunSummary,
) {
  await execute(
    `UPDATE tag_relabel_items SET status = 'failed', error_message = $1,
       claim_token = NULL, claimed_at = NULL, updated_at = $2
     WHERE batch_id = $3 AND problem_id = $4 AND model_run_id = $5
       AND status IN ('queued', 'processing', 'failed')`,
    [JSON.stringify({
      problem_id: problemId,
      model_run_id: summary.id,
      provider: summary.provider,
      model: summary.model,
      repairStrategy: summary.repairStrategy,
      error_summary: redactRelabelError(summary.errorMessage ?? '模型运行失败'),
    }), Date.now(), batchId, problemId, summary.id],
  )
}

export async function retryFailedRelabelItems(batchId: string) {
  const now = Date.now()
  await transaction(async () => {
    const batch = await select<Array<{ id: string; status: string }>>(
      `SELECT id, status FROM tag_relabel_batches WHERE id = $1 LIMIT 1`, [batchId],
    )
    if (!batch[0] || batch[0].status === 'cancelled') return
    const reset = await execute(
      `UPDATE tag_relabel_items
       SET status = 'pending', model_run_id = NULL, error_message = NULL,
           claim_token = NULL, claimed_at = NULL, updated_at = $1
       WHERE batch_id = $2 AND status = 'failed'`,
      [now, batchId],
    )
    if (reset.rowsAffected === 0) return
    await execute(
      `UPDATE tag_relabel_batches
       SET status = CASE WHEN paused_at IS NULL THEN 'pending' ELSE 'processing' END,
           completed_at = NULL, updated_at = $1
       WHERE id = $2 AND status != 'cancelled'`,
      [now, batchId],
    )
  })
  return refreshRelabelBatch(batchId)
}

export async function cancelRelabelBatch(batchId: string) {
  const now = Date.now()
  await transaction(async () => {
    await execute(
      `UPDATE model_runs SET status = 'cancelled', error_message = '用户取消批量重标注'
       WHERE id IN (SELECT model_run_id FROM tag_relabel_items WHERE batch_id = $1)
         AND status IN ('pending', 'processing')`,
      [batchId],
    )
    // relabel 与主管线共享 problems/model_runs：取消只应撤回 relabel 引入的
    // pending/processing 状态，绝不能把错题标记为 AI 分析失败。恢复规则：
    // 该错题仍有已完成的分析 run → 'completed'（活跃 run 指回最近完成的一条，
    // 保证后续重跑/展示链路一致）；否则回到 'not_started'。
    await execute(
      `UPDATE problems
       SET ai_status = CASE
             WHEN EXISTS (
               SELECT 1 FROM model_runs run
               WHERE run.problem_id = problems.id
                 AND run.task_type = 'analyze_problem_image'
                 AND run.status = 'completed'
             ) THEN 'completed'
             ELSE 'not_started' END,
           ai_active_model_run_id = (
             SELECT run.id FROM model_runs run
             WHERE run.problem_id = problems.id
               AND run.task_type = 'analyze_problem_image'
               AND run.status = 'completed'
             ORDER BY run.created_at DESC, run.id DESC
             LIMIT 1
           ),
           updated_at = $1
       WHERE ai_status IN ('pending', 'processing')
         AND ai_active_model_run_id IN (
           SELECT model_run_id FROM tag_relabel_items
           WHERE batch_id = $2 AND model_run_id IS NOT NULL
         )`,
      [now, batchId],
    )
    await execute(
      `UPDATE tag_relabel_items SET status = 'cancelled', claim_token = NULL,
       claimed_at = NULL, updated_at = $1
       WHERE batch_id = $2 AND status IN ('pending', 'queued', 'processing')`,
      [now, batchId],
    )
    await execute(
      `UPDATE tag_relabel_batches SET status = 'cancelled', updated_at = $1,
       completed_at = $1, paused_at = NULL WHERE id = $2`,
      [now, batchId],
    )
  })
}

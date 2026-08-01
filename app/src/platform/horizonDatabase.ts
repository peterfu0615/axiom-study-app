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
import {
  importTextbookSource,
  mergeKnowledgeNodes,
  mergeTagDefinitions,
  removeTextbookSource,
  type ImportedTextbookSource,
} from './native'

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

async function inputHash(value: unknown) {
  const source = new TextEncoder().encode(JSON.stringify(value))
  const digest = await crypto.subtle.digest('SHA-256', source)
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function transaction<T>(operation: () => Promise<T>): Promise<T> {
  await execute('BEGIN IMMEDIATE')
  try {
    const value = await operation()
    await execute('COMMIT')
    return value
  } catch (error) {
    await execute('ROLLBACK').catch(() => {})
    throw error
  }
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
    recognition: parseJSON<TextbookRecognition | null>(row.metadata_json, null),
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
     ORDER BY subject, is_current DESC, updated_at DESC`,
    [subject?.trim() ?? ''],
  )
  return rows.map(rowToTextbook)
}

export async function setCurrentTextbook(textbook: Pick<Textbook, 'id' | 'subject'>) {
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
    await execute('UPDATE textbooks SET is_current = 0 WHERE subject = $1', [subject.trim()])
    await execute(
      `INSERT INTO textbooks (
        id, subject, title, source_type, extraction_status, extraction_method,
        is_current, created_at, updated_at
      ) VALUES ($1, $2, $3, 'manual', 'needs_review', 'manual', 1, $4, $4)`,
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
    await execute('UPDATE textbooks SET is_current = 0 WHERE subject = $1', [subject.trim()])
    await execute(
      `INSERT INTO textbooks (
        id, subject, title, source_type, source_path, content_hash,
        extraction_status, extraction_method, is_current, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, 'needs_review', $7, 1, $8, $8)`,
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
    const parents = new Map<number, { id: string; path: string }>()
    for (const [index, candidate] of imported.extraction.outline.entries()) {
      const level = Math.max(1, Math.min(3, candidate.level))
      const parent = parents.get(level - 1) ?? null
      const nodeId = id()
      const path = parent ? `${parent.path}/${candidate.title}` : candidate.title
      await execute(
        `INSERT INTO knowledge_nodes (
          id, textbook_id, subject, canonical_name, node_type, parent_id, path,
          sort_order, source_page_start, source_page_end, evidence_text, source_path,
          extraction_method, confidence, verification_status, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, $10, $11, $12, $13,
          'needs_review', $14, $14)`,
        [
          nodeId, textbookId, subject.trim(), candidate.title,
          level === 1 ? 'chapter' : level === 2 ? 'section' : 'knowledge',
          parent?.id ?? null, path, index, candidate.pageNumber,
          candidate.evidenceText, imported.sourcePath,
          imported.extraction.extractionMethod, candidate.confidence, now,
        ],
      )
      parents.set(level, { id: nodeId, path })
      for (let deeper = level + 1; deeper <= 3; deeper += 1) parents.delete(deeper)
    }
    })
  } catch (error) {
    await removeTextbookSource(imported.sourcePath).catch(() => {})
    throw error
  }
  return textbookId
}

export async function prepareCurriculumImport(sourcePath: string) {
  // File selection, copying, PDF text extraction, Vision OCR and input assembly
  // deliberately happen without a curriculum_import_jobs row. A restart simply
  // clears the native temporary directory instead of exposing a false resume.
  return importTextbookSource(sourcePath)
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
  return getCurriculumImportResumeSlot()
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

async function startAttempt(jobId: string, stage: CurriculumImportJob['stage']) {
  const rows = await select<Array<{ count: number }>>(
    'SELECT count(*) AS count FROM curriculum_import_attempts WHERE job_id = $1 AND stage = $2',
    [jobId, stage],
  )
  const attemptNumber = Number(rows[0]?.count ?? 0) + 1
  const attemptId = id()
  await transaction(async () => {
    await execute(
      `UPDATE curriculum_import_attempts SET status = 'superseded', finished_at = $1
       WHERE job_id = $2 AND stage = $3 AND status = 'running'`,
      [Date.now(), jobId, stage],
    )
    await execute(
      `INSERT INTO curriculum_import_attempts (
        id, job_id, stage, attempt_number, status, started_at
      ) VALUES ($1, $2, $3, $4, 'running', $5)`,
      [attemptId, jobId, stage, attemptNumber, Date.now()],
    )
  })
  return attemptId
}

async function runStructureStage(
  jobId: string,
  inFlightRequest?: ReturnType<ReturnType<typeof getTextbookRecognitionProvider>['recognizeTextbook']>,
): Promise<CurriculumImportJob | null> {
  const initial = await assertImportJobActive(jobId)
  const attemptId = await startAttempt(jobId, 'ai_analyzing_structure')
  try {
    await execute(
      `UPDATE curriculum_import_jobs SET status = 'ai_analyzing_structure',
       resume_stage = 'ai_analyzing_structure', error_message = NULL, updated_at = $1
       WHERE id = $2`, [Date.now(), jobId],
    )
    const recognitionInput = {
      sourceName: initial.sourceName,
      pageCount: initial.extraction?.pageCount ?? 0,
      outline: initial.extraction?.outline ?? [],
      pages: initial.extraction?.pages ?? [],
    }
    const provider = getTextbookRecognitionProvider()
    const result = await (inFlightRequest ?? provider.recognizeTextbook(recognitionInput))
    const currentAttempt = await select<Array<{ status: string }>>(
      'SELECT status FROM curriculum_import_attempts WHERE id = $1', [attemptId],
    )
    if (currentAttempt[0]?.status !== 'running') return getCurriculumImportJob(jobId)
    await execute(
      `UPDATE curriculum_import_attempts SET status = 'succeeded', raw_output = $1,
       finished_at = $2 WHERE id = $3 AND status = 'running'`,
      [result.rawOutput, Date.now(), attemptId],
    )
    await execute(
      `UPDATE curriculum_import_jobs SET status = 'ai_generating_tags',
       resume_stage = 'ai_generating_tags', metadata_json = $1, structure_json = $2,
       raw_output = $3, error_message = NULL, updated_at = $4
       WHERE id = $5 AND status = 'ai_analyzing_structure'`,
      [JSON.stringify(result.recognition), JSON.stringify(initial.extraction?.outline ?? []),
        result.rawOutput, Date.now(), jobId],
    )
  } catch (error) {
    await execute(
      `UPDATE curriculum_import_attempts SET status = 'failed', error_message = $1,
       finished_at = $2 WHERE id = $3 AND status = 'running'`,
      [String(error), Date.now(), attemptId],
    )
    await execute(
      `UPDATE curriculum_import_jobs SET status = 'ai_failed_recoverable',
       resume_stage = 'ai_analyzing_structure', error_message = $1, updated_at = $2
       WHERE id = $3`, [String(error), Date.now(), jobId],
    )
  }
  const next = await getCurriculumImportJob(jobId)
  return next?.stage === 'ai_generating_tags' ? runTagStage(jobId) : next
}

async function runTagStage(jobId: string): Promise<CurriculumImportJob | null> {
  const job = await assertImportJobActive(jobId)
  if (!job.recognition || !job.extraction) throw new Error('知识结构阶段结果不完整')
  const subject = job.recognition.subject.value?.trim()
  if (!subject) throw new Error('请先识别并确认教材科目')
  const existing = await listTagDefinitions(subject)
  const attemptId = await startAttempt(jobId, 'ai_generating_tags')
  try {
    await execute(
      `UPDATE curriculum_import_jobs SET status = 'ai_generating_tags',
       resume_stage = 'ai_generating_tags', error_message = NULL,
       prompt_version = $1, schema_version = $2, updated_at = $3 WHERE id = $4`,
      [CURRICULUM_TAG_PROMPT_VERSION, CURRICULUM_TAG_SCHEMA_VERSION, Date.now(), jobId],
    )
    const provider = getCurriculumAnalysisProvider(job.provider ?? undefined, job.model ?? undefined)
    const result = await provider.analyzeCurriculumStage({
      prompt: buildCurriculumTagPrompt({
        recognition: job.recognition, outline: job.structure,
        pages: job.extraction.pages,
        existingTags: existing.map((tag) => ({
          id: tag.id, tagType: tag.tagType, canonicalName: tag.canonicalName, aliases: tag.aliases,
        })),
      }),
      jsonSchema: curriculumTagsJSONSchema,
    })
    const parsed = parseCurriculumTags(result.rawOutput, subject)
    const tags: CurriculumTagAnalysis = {
      ...parsed,
      candidates: reconcileCurriculumTagCandidates(parsed.candidates, existing.map((tag) => ({
        id: tag.id, tagType: tag.tagType, canonicalName: tag.canonicalName, aliases: tag.aliases,
      }))),
    }
    const currentAttempt = await select<Array<{ status: string }>>(
      'SELECT status FROM curriculum_import_attempts WHERE id = $1', [attemptId],
    )
    if (currentAttempt[0]?.status !== 'running') return getCurriculumImportJob(jobId)
    await execute(
      `UPDATE curriculum_import_attempts SET status = 'succeeded', raw_output = $1,
       provider_task_id = $2, finished_at = $3 WHERE id = $4 AND status = 'running'`,
      [result.rawOutput, result.providerTaskId, Date.now(), attemptId],
    )
    await execute(
      `UPDATE curriculum_import_jobs SET status = 'ai_auditing', resume_stage = 'ai_auditing',
       tags_json = $1, provider_task_id = $2, raw_output = $3, updated_at = $4
       WHERE id = $5 AND status = 'ai_generating_tags'`,
      [JSON.stringify(tags), result.providerTaskId, result.rawOutput, Date.now(), jobId],
    )
  } catch (error) {
    await failCurriculumAttempt(jobId, attemptId, 'ai_generating_tags', error)
    return getCurriculumImportJob(jobId)
  }
  return runAuditStage(jobId)
}

async function runAuditStage(jobId: string): Promise<CurriculumImportJob | null> {
  const job = await assertImportJobActive(jobId)
  const tags = job.tags as CurriculumTagAnalysis | null
  const subject = job.recognition?.subject.value?.trim()
  if (!tags || !subject) throw new Error('标签生成阶段结果不完整')
  const attemptId = await startAttempt(jobId, 'ai_auditing')
  try {
    await execute(
      `UPDATE curriculum_import_jobs SET status = 'ai_auditing', resume_stage = 'ai_auditing',
       error_message = NULL, prompt_version = $1, schema_version = $2,
       updated_at = $3 WHERE id = $4`,
      [CURRICULUM_AUDIT_PROMPT_VERSION, CURRICULUM_AUDIT_SCHEMA_VERSION, Date.now(), jobId],
    )
    const provider = getCurriculumAnalysisProvider(job.provider ?? undefined, job.model ?? undefined)
    const result = await provider.analyzeCurriculumStage({
      prompt: buildCurriculumAuditPrompt({
        subject, candidates: tags.candidates,
        knowledgeNames: tags.candidates.filter((tag) => tag.tagType === 'knowledge').map((tag) => tag.canonicalName),
      }),
      jsonSchema: curriculumAuditJSONSchema,
    })
    const audit = parseCurriculumAudit(result.rawOutput)
    const currentAttempt = await select<Array<{ status: string }>>(
      'SELECT status FROM curriculum_import_attempts WHERE id = $1', [attemptId],
    )
    if (currentAttempt[0]?.status !== 'running') return getCurriculumImportJob(jobId)
    await execute(
      `UPDATE curriculum_import_attempts SET status = 'succeeded', raw_output = $1,
       provider_task_id = $2, finished_at = $3 WHERE id = $4 AND status = 'running'`,
      [result.rawOutput, result.providerTaskId, Date.now(), attemptId],
    )
    await execute(
      `UPDATE curriculum_import_jobs SET status = 'waiting_for_review',
       resume_stage = 'waiting_for_review', audit_json = $1, provider_task_id = $2,
       raw_output = $3, error_message = NULL, updated_at = $4
       WHERE id = $5 AND status = 'ai_auditing'`,
      [JSON.stringify(audit), result.providerTaskId, result.rawOutput, Date.now(), jobId],
    )
  } catch (error) {
    await failCurriculumAttempt(jobId, attemptId, 'ai_auditing', error)
  }
  return getCurriculumImportJob(jobId)
}

async function failCurriculumAttempt(
  jobId: string,
  attemptId: string,
  resumeStage: Exclude<CurriculumImportJob['stage'], 'waiting_for_review'>,
  error: unknown,
) {
  await execute(
    `UPDATE curriculum_import_attempts SET status = 'failed', error_message = $1,
     finished_at = $2 WHERE id = $3 AND status = 'running'`,
    [String(error), Date.now(), attemptId],
  )
  await execute(
    `UPDATE curriculum_import_jobs SET status = 'ai_failed_recoverable',
     resume_stage = $1, error_message = $2, updated_at = $3 WHERE id = $4`,
    [resumeStage, String(error), Date.now(), jobId],
  )
}

export async function createCurriculumImportJob(
  originalSourcePath: string,
  imported: ImportedTextbookSource,
) {
  const existing = await getCurriculumImportResumeSlot()
  if (existing) throw new Error('上次教材分析尚未完成。开始新教材前请先继续或放弃上次结果。')
  const provider = getTextbookRecognitionProvider()
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
        provider, model, prompt_version, schema_version, input_hash, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, 'ai_analyzing_structure',
        'ai_analyzing_structure', $7, $8, $9, $10, $11, $12, $13, $14, $15, $15)`,
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
  return runStructureStage(jobId, inFlightRequest)
}

export async function runCurriculumImportJob(jobId: string) {
  const job = await assertImportJobActive(jobId)
  if (job.stage === 'waiting_for_review') return job
  // Providers without a server-side resumable task restart only the current
  // safe stage. A new attempt prevents a late response from replacing it.
  if (job.stage === 'ai_generating_tags') return runTagStage(jobId)
  if (job.stage === 'ai_auditing') return runAuditStage(jobId)
  return runStructureStage(jobId)
}

export async function retryCurriculumImportJob(jobId: string) {
  return runCurriculumImportJob(jobId)
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
) {
  const subject = confirmation.subject.trim()
  const title = confirmation.title.trim()
  if (!subject || !title) throw new Error('请确认教材名称和科目')
  const textbookId = id()
  const now = Date.now()
  const outline = confirmation.outline ?? imported.extraction.outline
  await ensureTaxonomyVersion(subject)
  await transaction(async () => {
    await execute('UPDATE textbooks SET is_current = 0 WHERE subject = $1', [subject])
    await execute(
      `INSERT INTO textbooks (
        id, subject, title, grade, volume, publisher, edition, source_type, source_path,
        content_hash, extraction_status, extraction_method, is_current, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'needs_review', $11, 1, $12, $12)`,
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
    const parents = new Map<number, { id: string; path: string }>()
    const knowledgeByName = new Map<string, string>()
    for (const [index, candidate] of outline.entries()) {
      const level = Math.max(1, Math.min(3, candidate.level))
      const parent = parents.get(level - 1) ?? null
      const nodeId = id()
      const path = parent ? `${parent.path}/${candidate.title}` : candidate.title
      await execute(
        `INSERT INTO knowledge_nodes (
          id, textbook_id, subject, canonical_name, node_type, parent_id, path,
          sort_order, source_page_start, source_page_end, evidence_text, source_path,
          extraction_method, confidence, verification_status, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, $10, $11, $12, $13,
          'needs_review', $14, $14)`,
        [
          nodeId, textbookId, subject, candidate.title,
          level === 1 ? 'chapter' : level === 2 ? 'section' : 'knowledge', parent?.id ?? null,
          path, index, candidate.pageNumber, candidate.evidenceText, imported.sourcePath,
          imported.extraction.extractionMethod, candidate.confidence, now,
        ],
      )
      parents.set(level, { id: nodeId, path })
      knowledgeByName.set(normalizeTagName(candidate.title), nodeId)
      for (let deeper = level + 1; deeper <= 3; deeper += 1) parents.delete(deeper)
    }
    const rejected = new Set(rejectedTagNames.map(normalizeTagName))
    for (const candidate of tagAnalysis?.candidates ?? []) {
      if (rejected.has(normalizeTagName(candidate.canonicalName))) continue
      let knowledgeNodeId = candidate.knowledgeNames
        .map((name) => knowledgeByName.get(normalizeTagName(name)))
        .find(Boolean) ?? null
      if (candidate.tagType === 'knowledge' && !knowledgeNodeId) {
        const nodeId = id()
        const page = candidate.pageNumbers[0] ?? null
        await execute(
          `INSERT OR IGNORE INTO knowledge_nodes (
            id, textbook_id, subject, canonical_name, node_type, path, sort_order,
            description, source_page_start, source_page_end, evidence_text, source_path,
            extraction_method, confidence, verification_status, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, 'knowledge', $4, $5, $6, $7, $7, $8, $9,
            $10, $11, 'needs_review', $12, $12)`,
          [nodeId, textbookId, subject, candidate.canonicalName, knowledgeByName.size,
            candidate.description, page, candidate.evidenceText, imported.sourcePath,
            imported.extraction.extractionMethod, candidate.confidence, now],
        )
        const rows = await select<Array<{ id: string }>>(
          `SELECT id FROM knowledge_nodes WHERE textbook_id = $1 AND subject = $2
           AND node_type = 'knowledge' AND canonical_name = $3 COLLATE NOCASE
           AND archived_at IS NULL LIMIT 1`,
          [textbookId, subject, candidate.canonicalName],
        )
        knowledgeNodeId = rows[0]?.id ?? null
        if (knowledgeNodeId) knowledgeByName.set(normalizeTagName(candidate.canonicalName), knowledgeNodeId)
      }
      if (candidate.existingTagId) {
        for (const knowledgeName of candidate.knowledgeNames) {
          const linkedNodeId = knowledgeByName.get(normalizeTagName(knowledgeName))
          if (linkedNodeId) await execute(
            `INSERT OR IGNORE INTO curriculum_tag_knowledge_links (
              tag_id, knowledge_node_id, source, confidence, created_at
            ) VALUES ($1, $2, 'ai_inferred', $3, $4)`,
            [candidate.existingTagId, linkedNodeId, candidate.confidence, now],
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
        const linkedNodeId = knowledgeByName.get(normalizeTagName(knowledgeName))
        if (linkedNodeId) await execute(
          `INSERT OR IGNORE INTO curriculum_tag_knowledge_links (
            tag_id, knowledge_node_id, source, confidence, created_at
          ) VALUES ($1, $2, $3, $4, $5)`,
          [persistedTagId, linkedNodeId,
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
    sourcePath: job.sourcePath,
    contentHash: job.contentHash,
    byteLength: 0,
    sourceType: job.sourceType === 'directory_image' ? 'directory_image' : 'pdf',
    extraction: job.extraction,
  }
  const tagAnalysis = job.tags as CurriculumTagAnalysis | null
  const rejectedTagNames = job.audit && typeof job.audit === 'object' &&
    Array.isArray((job.audit as { rejectedNames?: unknown }).rejectedNames)
    ? (job.audit as { rejectedNames: string[] }).rejectedNames : []
  const textbookId = await persistImportedTextbook(imported, confirmation, tagAnalysis, rejectedTagNames)
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
        input.id, canonicalName, input.nodeType, input.parentId,
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
      `SELECT path, canonical_name FROM knowledge_nodes
       WHERE id = $1 AND textbook_id = $2 AND subject = $3 AND archived_at IS NULL`,
      [input.parentId, input.textbookId, input.subject],
    )
    : []
  if (input.parentId && !parentRows[0]) throw new Error('目标章节不属于当前教材')
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
    [nodeId, input.textbookId, input.subject, name, input.nodeType, input.parentId, path,
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
  candidateName: string
  confidence: number
  evidence: string
  mappingStatus: ProblemTag['mappingStatus']
  verificationStatus: ProblemTag['verificationStatus']
}

export async function listTagReviewItems(subject: string, tagType: HorizonTagType) {
  const rows = await select<Record<string, unknown>[]>(
    `SELECT * FROM problem_tags WHERE subject = $1 AND tag_type = $2
       AND superseded_at IS NULL
       AND (mapping_status != 'mapped' OR verification_status = 'needs_review')
     ORDER BY updated_at DESC`,
    [subject, tagType],
  )
  return rows.map((row): TagReviewItem => ({
    id: String(row.id), problemId: String(row.problem_id),
    candidateName: String(row.candidate_name ?? ''), confidence: Number(row.confidence),
    evidence: String(row.evidence ?? ''),
    mappingStatus: String(row.mapping_status) as TagReviewItem['mappingStatus'],
    verificationStatus: String(row.verification_status) as TagReviewItem['verificationStatus'],
  }))
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
    await execute(
      `UPDATE problem_tags SET tag_id = $1, candidate_name = NULL,
       mapping_status = 'mapped', source = 'user', verification_status = 'user_verified',
       is_locked = 1, confidence = 1, updated_at = $2 WHERE id = $3`,
      [tagId, now, problemTagId],
    )
  } else {
    await execute(
      `UPDATE problem_tags SET source = 'user', verification_status = 'user_verified',
       is_locked = 1, updated_at = $1 WHERE id = $2 AND tag_id IS NOT NULL`,
      [now, problemTagId],
    )
  }
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
  const problems = await select<Array<{ effective_subject: string }>>(
    `SELECT trim(COALESCE(NULLIF(user_subject, ''), NULLIF(ai_subject, ''), NULLIF(subject, ''))) AS effective_subject
     FROM problems WHERE id = $1`,
    [problemId],
  )
  const subject = String(problems[0]?.effective_subject || '')
  if (!subject) return
  if (analysis.subject.trim() && analysis.subject.trim().toLocaleLowerCase('zh-CN') !== subject.toLocaleLowerCase('zh-CN')) {
    return
  }
  const textbooks = await listTextbooks(subject)
  const currentTextbookId = textbooks.find((book) => book.isCurrent)?.id ?? null
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
    await execute(
      `UPDATE problem_tags SET superseded_at = $1, updated_at = $1
       WHERE problem_id = $2 AND superseded_at IS NULL AND source = 'model'
         AND is_locked = 0 AND verification_status != 'user_verified'`,
      [now, problemId],
    )
    for (const [tagType, candidates = []] of candidateGroups) {
      const mappings = mapCandidatesToControlledTags(
        subject, tagType, candidates, definitions, currentTextbookId,
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

export async function createRelabelBatch(subject: string): Promise<string> {
  const batchId = id()
  const now = Date.now()
  await transaction(async () => {
    const problems = await select<Array<{ id: string }>>(
      `SELECT id FROM problems WHERE status = 'saved' AND deleted_at IS NULL
       AND trim(COALESCE(NULLIF(user_subject, ''), NULLIF(ai_subject, ''), NULLIF(subject, ''))) = $1`,
      [subject],
    )
    await execute(
      `INSERT INTO tag_relabel_batches (id, subject, total_count, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $4)`,
      [batchId, subject, problems.length, now],
    )
    for (const problem of problems) {
      await execute(
        `INSERT INTO tag_relabel_items (batch_id, problem_id, subject, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $4)`,
        [batchId, problem.id, subject, now],
      )
    }
  })
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

export async function markRelabelItemQueued(batchId: string, problemId: string, modelRunId: string) {
  const now = Date.now()
  await transaction(async () => {
    await execute(
      `UPDATE tag_relabel_items SET status = 'queued', model_run_id = $1, updated_at = $2
       WHERE batch_id = $3 AND problem_id = $4 AND status = 'pending'
         AND EXISTS (SELECT 1 FROM tag_relabel_batches batch
                     WHERE batch.id = $3 AND batch.paused_at IS NULL
                       AND batch.status NOT IN ('cancelled', 'completed'))`,
      [modelRunId, now, batchId, problemId],
    )
    await execute(
      `UPDATE tag_relabel_batches SET status = 'processing', updated_at = $1
       WHERE id = $2 AND status = 'pending' AND paused_at IS NULL`,
      [now, batchId],
    )
  })
}

export async function refreshRelabelBatch(batchId: string): Promise<RelabelBatch | null> {
  const now = Date.now()
  await transaction(async () => {
    await execute(
      `UPDATE tag_relabel_items SET status = (
        SELECT CASE mr.status WHEN 'completed' THEN 'completed' WHEN 'failed' THEN 'failed'
          WHEN 'cancelled' THEN 'cancelled' ELSE tag_relabel_items.status END
        FROM model_runs mr WHERE mr.id = tag_relabel_items.model_run_id
       ), updated_at = $1
       WHERE batch_id = $2 AND model_run_id IS NOT NULL`,
      [now, batchId],
    )
    await execute(
      `UPDATE tag_relabel_batches SET
        completed_count = (SELECT count(*) FROM tag_relabel_items WHERE batch_id = $1 AND status = 'completed'),
        failed_count = (SELECT count(*) FROM tag_relabel_items WHERE batch_id = $1 AND status = 'failed'),
        status = CASE
          WHEN status = 'cancelled' THEN 'cancelled'
          WHEN paused_at IS NOT NULL THEN status
          WHEN NOT EXISTS (SELECT 1 FROM tag_relabel_items WHERE batch_id = $1 AND status IN ('pending','queued','processing')) THEN 'completed'
          ELSE status END,
        completed_at = CASE WHEN paused_at IS NULL AND NOT EXISTS (
          SELECT 1 FROM tag_relabel_items WHERE batch_id = $1 AND status IN ('pending','queued','processing')
        ) THEN $2 ELSE completed_at END,
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

export async function failRelabelItem(batchId: string, problemId: string, error: unknown) {
  await execute(
    `UPDATE tag_relabel_items SET status = 'failed', error_message = $1, updated_at = $2
     WHERE batch_id = $3 AND problem_id = $4 AND status IN ('pending', 'queued', 'processing')`,
    [String(error), Date.now(), batchId, problemId],
  )
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
    await execute(
      `UPDATE problems SET ai_status = 'failed', ai_active_model_run_id = NULL, updated_at = $1
       WHERE ai_active_model_run_id IN (
         SELECT model_run_id FROM tag_relabel_items WHERE batch_id = $2
       )`,
      [now, batchId],
    )
    await execute(
      `UPDATE tag_relabel_items SET status = 'cancelled', updated_at = $1
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

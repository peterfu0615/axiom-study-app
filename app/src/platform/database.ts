import Database from '@tauri-apps/plugin-sql'
import { invoke } from '@tauri-apps/api/core'
import {
  PROBLEM_ANALYSIS_PROMPT_VERSION,
  PROBLEM_ANALYSIS_SCHEMA_VERSION,
} from '../ai/problemAnalysisContract'
import {
  getAIProvider,
  getExplainProvidersForRun,
  getReasoningProvidersForRun,
  getSolutionProvider,
  getStudentAttemptProvidersForRun,
} from '../ai/provider'
import {
  SOLUTION_PROMPT_VERSION,
  SOLUTION_SCHEMA_VERSION,
} from '../ai/solutionContract'
import {
  EXPLAIN_SELECTION_PROMPT_VERSION,
  EXPLAIN_SELECTION_SCHEMA_VERSION,
  REASONING_ANALYSIS_PROMPT_VERSION,
  REASONING_ANALYSIS_SCHEMA_VERSION,
  STUDENT_ATTEMPT_PROMPT_VERSION,
  STUDENT_ATTEMPT_SCHEMA_VERSION,
} from '../ai/intelligenceContract'
import type {
  AIProviderProfile,
  AIProblemAnalysis,
  AIProblemInput,
  AIUsageMetrics,
  DocumentProcessingResult,
  GeneratedSolution,
  ExplainModelRun,
  ExplainResult,
  ExplainSelectionInput,
  ModelRun,
  PersistedMedia,
  Problem,
  ProblemBlock,
  ProblemUserEdits,
  ProblemRegion,
  ProblemRegionType,
  ReasoningAnalysis,
  ReasoningAnalysisInput,
  ReasoningModelRun,
  SavedProblem,
  Solution,
  SolutionInput,
  SolutionModelRun,
  SourceDocument,
  StudentAttempt,
  StudentAttemptInput,
  StudentAttemptModelRun,
} from '../domain/models'
import {
  normalizeAIProblemAnalysis,
  resolveProblemField,
} from '../domain/ai'
import { isSameCropRect, isValidNormalizedRect } from '../domain/problem'
import { resolveUserOverride } from '../domain/problemSelection'
import { mapWithConcurrency } from './concurrency'
import {
  canonicalizePath,
  cropProblemImage,
  deleteAIProviderApiKey,
  deleteMediaFile,
  getDatabasePath,
  isDesktopRuntime,
  listMediaDirectory,
  persistAIProviderProfiles,
  recoverLegacyProviderApiKeys,
  removeProblemImage,
  recoverRelabelBatchItems as recoverNativeRelabelBatchItems,
  type PersistedProblemImage,
} from './native'
import {
  prepareControlledProblemAnalysis,
  writeControlledProblemAnalysis,
} from './horizonDatabase'
import { withTransactionLock } from './transactionLock'
import {
  classifyAIError,
  createAIError,
  isAIErrorEnvelope,
  publicAIErrorMessage,
  type AIErrorEnvelope,
} from '../domain/aiError'

const browserDocuments: SourceDocument[] = []
const browserProblemRegions = new Map<string, ProblemRegion[]>()
const browserStudentAttempts = new Map<string, StudentAttempt>()
const browserReasoningAnalyses = new Map<string, ReasoningAnalysis>()

interface ExecuteResult {
  rowsAffected: number
  lastInsertId: number
}

interface DatabaseLike {
  execute(sql: string, params?: unknown[]): Promise<ExecuteResult>
  select<T>(sql: string, params?: unknown[]): Promise<T>
}

let dbInstancePromise: Promise<DatabaseLike> | null = null

function database() {
  dbInstancePromise ??= (async () => {
    // 1. 通过 tauri-plugin-sql 触发启动时迁移（仍保留其内置连接池仅用于此目的）
    //    该调用会创建 axiom.db 并应用全部 migrations。
    const pluginDb = await Database.load('sqlite:axiom.db')
    // 同步设置 WAL 模式与 busy_timeout，确保多连接池之间共享同一日志模式
    try {
      await pluginDb.execute('PRAGMA journal_mode=WAL')
      await pluginDb.execute('PRAGMA busy_timeout=10000')
    } catch {
      // 忽略：Rust 端 init_db 已设置过这些 PRAGMA
    }

    // 2. 校验 tauri-plugin-sql 与 Rust sqlx 指向同一数据库文件。
    //    两端都通过 Tauri 的 app_data_dir 解析路径，理论上必然一致；
    //    但历史上出现过 bundle identifier 变化 / 容器重定向 / Debug vs Release
    //    解析差异导致 migration 重新执行、用户数据「消失」的事故。
    //    此处通过 PRAGMA database_list 拿到 plugin-sql 实际打开的文件路径，
    //    与 Rust get_database_path 命令返回的路径比对。
    //    不一致时返回结构化错误，由调用方（App.tsx）决定是否阻塞启动并展示 UI。
    const pathCheck = await verifyDatabasePathConsistency(pluginDb)
    if (!pathCheck.ok) {
      // 将错误存入模块级变量，供 ensureDatabaseReady 消费
      databasePathError = pathCheck
    } else {
      databasePathError = null
      // The plugin has now applied every migration, including the recovery
      // marker table.  Do not run this from Rust setup: setup precedes that
      // migration lifecycle on the first launch of a new release.
      await recoverLegacyProviderApiKeys()
    }

    // 3. 所有数据操作走单一 sqlx 连接（Rust 端 db_execute / db_select），
    //    彻底避免 tauri-plugin-sql 多连接池导致的事务交错与锁竞争。
    return {
      execute: (sql: string, params: unknown[] = []) =>
        invoke<ExecuteResult>('db_execute', { sql, params }),
      select: <T>(sql: string, params: unknown[] = []) =>
        invoke<T>('db_select', { sql, params }),
    } satisfies DatabaseLike
  })()
  return dbInstancePromise
}

/** 数据库路径一致性校验结果。 */
export interface DatabasePathCheck {
  ok: boolean
  /** plugin-sql 实际打开的数据库文件路径（canonicalize 后） */
  pluginPath?: string
  /** Rust sqlx 期望的数据库文件路径（canonicalize 后） */
  rustPath?: string
  /** 校验过程的错误信息（如 get_database_path 失败） */
  error?: string
}

/** 模块级变量：数据库初始化后路径校验结果，供 ensureDatabaseReady 消费。 */
let databasePathError: DatabasePathCheck | null = null

/**
 * 校验 tauri-plugin-sql 与 Rust sqlx 是否解析到同一物理数据库文件。
 *
 * 使用 Rust 端 canonicalize_path 命令解析符号链接，避免 macOS 容器路径
 * （~/Library/Containers/... 与 /Users/<name>/...）的字符串差异导致误判。
 *
 * 返回结构化结果而非 fire-and-forget，由调用方决定是否阻塞启动。
 */
async function verifyDatabasePathConsistency(pluginDb: Database): Promise<DatabasePathCheck> {
  let rustPath: string
  try {
    rustPath = await getDatabasePath()
  } catch (error) {
    // Rust 端 init_db 未就绪或命令未注册
    return { ok: false, error: `无法获取 Rust 端数据库路径：${String(error)}` }
  }

  const rows = await pluginDb.select<
    Array<{ name?: string; file?: string }>
  >('PRAGMA database_list')
  const mainRow = rows.find((row) => row.name === 'main')
  const rawPluginPath = mainRow?.file ?? ''
  if (!rawPluginPath) {
    return { ok: false, error: 'plugin-sql 未返回主数据库文件路径', rustPath }
  }

  // canonicalize 双方路径以解析符号链接，避免容器路径误判
  let pluginPath: string
  let rustCanonical: string
  try {
    pluginPath = await canonicalizePath(rawPluginPath)
    rustCanonical = await canonicalizePath(rustPath)
  } catch {
    // canonicalize 失败时退回字符串规范化比对（旧逻辑）
    pluginPath = rawPluginPath
    rustCanonical = rustPath
  }

  if (!isSameDatabasePath(pluginPath, rustCanonical)) {
    return {
      ok: false,
      pluginPath,
      rustPath: rustCanonical,
      error:
        '数据库路径不一致：plugin-sql 与 Rust sqlx 指向不同文件，' +
        '可能出现 migration 重复执行或用户数据丢失',
    }
  }
  return { ok: true, pluginPath, rustPath: rustCanonical }
}

/**
 * 等待数据库初始化完成并返回路径校验结果。
 * App.tsx 在启动时调用此函数，若返回的 check 不为 ok，则展示 DatabaseLocationErrorDialog。
 */
export async function ensureDatabaseReady(): Promise<{ check: DatabasePathCheck }> {
  await database()
  return { check: databasePathError ?? { ok: true } }
}

// tauri-plugin-sql 的每个 db.execute() 都是独立 IPC 调用，SQLite 实际为单连接。
// 当后台 worker 的事务跨多个 await 点时，事件循环可能切到另一处也开启事务的代码，
// 触发 "cannot start a transaction within a transaction"。
// 事务序列化锁与 horizonDatabase 共享（见 ./transactionLock），保证跨模块
// 事务不会在同一 sqlx 连接上交错。
async function inDatabaseTransaction<T>(
  db: DatabaseLike,
  operation: () => Promise<T>,
): Promise<T> {
  return withTransactionLock(async () => {
    await db.execute('BEGIN IMMEDIATE')
    try {
      const result = await operation()
      await db.execute('COMMIT')
      return result
    } catch (error) {
      try {
        await db.execute('ROLLBACK')
      } catch {
        // ROLLBACK 失败说明事务可能已不在活跃状态，再尝试一次以清理潜在泄漏
        try {
          await db.execute('ROLLBACK')
        } catch {
          // Preserve the original transaction error.
        }
      }
      throw error
    }
  })
}

function rowToSourceDocument(row: Record<string, unknown>): SourceDocument {
  return {
    id: String(row.id),
    originalImagePath: String(row.original_image_path),
    correctedImagePath: row.corrected_image_path
      ? String(row.corrected_image_path)
      : null,
    contentHash: String(row.content_hash),
    sourceType: String(row.source_type) as SourceDocument['sourceType'],
    processingStatus: String(
      row.processing_status,
    ) as SourceDocument['processingStatus'],
    capturedAt: Number(row.captured_at),
    createdAt: Number(row.created_at),
  }
}

function nullableNumber(value: unknown) {
  return value === null || value === undefined ? null : Number(value)
}

function nullableString(value: unknown) {
  return value === null || value === undefined ? null : String(value)
}

function redactAIError(value: unknown) {
  return String(value)
    .replace(/\bBearer\s+[A-Za-z0-9._~-]+/giu, 'Bearer [已隐藏]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/gu, 'sk-[已隐藏]')
}

/**
 * 将 SQLite 列值稳健地转换为 boolean。
 *
 * 背景：SQLite 没有真正的布尔类型，BOOLEAN 列实际存储为 INTEGER 0/1。
 * 不同 driver 序列化方式不一致：
 *   - Rust sqlx 经 column_to_value 后 INTEGER 返回 number（0 或 1）
 *   - tauri-plugin-sql 直连场景可能返回字符串 "0" / "1"
 *   - 旧数据可能存为 null
 *
 * JS 的 Boolean("0") === true 是经典陷阱，因此显式枚举所有可能的存储形式，
 * 任何无法识别的值统一退化为 false（更安全的失败方向）。
 */
export function parseSQLiteBoolean(value: unknown): boolean {
  if (value === true || value === 1) return true
  if (value === false || value === 0) return false
  if (typeof value === 'string') {
    const lowered = value.trim().toLowerCase()
    if (lowered === '1' || lowered === 'true' || lowered === 't') {
      return true
    }
    if (lowered === '0' || lowered === 'false' || lowered === 'f' || lowered === '') {
      return false
    }
  }
  return false
}

export function parseNullableSQLiteBoolean(value: unknown): boolean | null {
  if (value === null || value === undefined) return null
  return parseSQLiteBoolean(value)
}

/**
 * 解析数据库 JSON 字段。失败时不再静默吞错：
 *   - 通过 console.error 记录字段上下文与原始值，便于数据损坏追溯
 *   - 仍返回 fallback 以保证用户可用性（不阻塞 UI）
 *
 * 调用方应通过 `context` 传入字段名/记录 ID 等定位信息。
 */
export function parseJSON<T>(value: unknown, fallback: T, context?: string): T {
  if (typeof value !== 'string' || !value) return fallback
  try {
    return JSON.parse(value) as T
  } catch (error) {
    const label = context ? ` (field: ${context})` : ''
    console.error(
      `[database] JSON 解析失败${label}：${error instanceof Error ? error.message : String(error)}`,
      { valuePreview: value.slice(0, 200) },
    )
    return fallback
  }
}

/**
 * 计算两个数据库路径是否等价。用于校验 plugin-sql 与 Rust sqlx 是否使用同一文件。
 * 处理 macOS 容器路径中的 `~/Library/Containers/...` 与 `/Users/<name>/...` 解析差异。
 */
export function isSameDatabasePath(a: string, b: string): boolean {
  if (a === b) return true
  // 容器路径可能通过符号链接解析为不同字符串；按规范化路径比对
  const normalize = (p: string) => p.replace(/\/+/g, '/').replace(/\/$/, '').trim()
  return normalize(a) === normalize(b)
}

function rowToProblem(row: Record<string, unknown>): Problem {
  const userTitle = nullableString(row.user_title)
  const userSubject = nullableString(row.user_subject)
  const userStemMarkdown = nullableString(row.user_stem_markdown)
  const ocrSubject = nullableString(row.subject)
  const ocrStemMarkdown = nullableString(row.stem_markdown)
  const aiTitleValue = nullableString(row.ai_title)
  const aiTitle = aiTitleValue?.trim() ? aiTitleValue : null
  const aiSubject = nullableString(row.ai_subject)
  const aiStemMarkdown = nullableString(row.ai_stem_markdown)
  const aiKnowledgePoints = parseJSON<string[]>(
    row.ai_knowledge_points_json,
    [],
    `ai_knowledge_points_json#${row.id ?? '?'}`,
  )
  const userKnowledgePoints =
    row.user_knowledge_points_json === null ||
    row.user_knowledge_points_json === undefined
      ? null
      : parseJSON<string[]>(row.user_knowledge_points_json, [], `user_knowledge_points_json#${row.id ?? '?'}`)
  const baseTitle = String(row.title || row.stem_markdown || '未命名题目')
  return {
    id: String(row.id),
    subjectId: nullableString(row.subject_id),
    sourceDocumentId: String(row.source_document_id),
    cropRect: {
      x: Number(row.crop_x),
      y: Number(row.crop_y),
      width: Number(row.crop_width),
      height: Number(row.crop_height),
    },
    cropImagePath: row.crop_image_path
      ? String(row.crop_image_path)
      : null,
    ocrTitle: baseTitle,
    ocrSubject,
    ocrStemMarkdown,
    subject: resolveProblemField(userSubject, aiSubject, ocrSubject),
    title:
      resolveUserOverride(userTitle, aiTitle ?? baseTitle) ??
      '未命名题目',
    stemMarkdown: resolveProblemField(
      userStemMarkdown,
      aiStemMarkdown,
      ocrStemMarkdown,
    ),
    userTitle,
    userSubject,
    userStemMarkdown,
    userEditedAt: nullableNumber(row.user_edited_at),
    aiStatus: String(row.ai_status || 'not_started') as Problem['aiStatus'],
    aiTitle,
    aiSubject,
    aiProblemType: nullableString(row.ai_problem_type),
    aiStemMarkdown,
    aiChoices: parseJSON(row.ai_choices_json, [], `ai_choices_json#${row.id ?? '?'}`),
    aiSubQuestions: parseJSON(row.ai_sub_questions_json, [], `ai_sub_questions_json#${row.id ?? '?'}`),
    aiHasDiagram: parseNullableSQLiteBoolean(row.ai_has_diagram),
    aiDiagramKind: nullableString(
      row.ai_diagram_kind,
    ) as Problem['aiDiagramKind'],
    aiDiagramBBox: parseJSON(row.ai_diagram_bbox_json, null, `ai_diagram_bbox_json#${row.id ?? '?'}`),
    aiDiagramImagePath: nullableString(row.ai_diagram_image_path),
    aiKnowledgePoints,
    knowledgePoints: userKnowledgePoints ?? aiKnowledgePoints,
    userKnowledgePoints,
    aiConfidence: nullableNumber(row.ai_confidence),
    aiWarnings: parseJSON(row.ai_warnings_json, [], `ai_warnings_json#${row.id ?? '?'}`),
    aiUpdatedAt: nullableNumber(row.ai_updated_at),
    aiActiveModelRunId: nullableString(row.ai_active_model_run_id),
    status: String(row.status) as Problem['status'],
    verificationStatus: String(
      row.verification_status,
    ) as Problem['verificationStatus'],
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    archivedAt: nullableNumber(row.archived_at),
    deletedAt: nullableNumber(row.deleted_at),
    matchedTextbookId: nullableString(row.matched_textbook_id),
    textbookMatchConfidence: Number(row.textbook_match_confidence ?? 0),
    textbookMatchReason: nullableString(row.textbook_match_reason),
    textbookMatchSource: String(row.textbook_match_source || 'unresolved') as Problem['textbookMatchSource'],
    textbookMatchLocked: Number(row.textbook_match_locked ?? 0) === 1,
    textbookMatchUpdatedAt: nullableNumber(row.textbook_match_updated_at),
  }
}

function rowToSavedProblem(row: Record<string, unknown>): SavedProblem {
  const problem = rowToProblem(row)
  if (!problem.cropImagePath) {
    throw new Error(`错题 ${problem.id} 缺少题块图片`)
  }
  return {
    ...problem,
    cropImagePath: problem.cropImagePath,
    originalImagePath: String(row.original_image_path),
    correctedImagePath: row.corrected_image_path
      ? String(row.corrected_image_path)
      : null,
    searchText: String(row.library_search_text ?? [problem.title, problem.subject, problem.stemMarkdown, ...problem.knowledgePoints].filter(Boolean).join(' ')),
    libraryMetadata: {
      difficulty: nullableString(row.library_difficulty) as SavedProblem['libraryMetadata']['difficulty'],
      textbookTitle: nullableString(row.library_textbook_title),
      chapters: String(row.library_chapters ?? '').split(' · ').map((value) => value.trim()).filter(Boolean),
      tags: parseJSON<SavedProblem['libraryMetadata']['tags']>(row.library_tags_json, [], `library_tags_json#${problem.id}`),
      masteryEstimate: nullableNumber(row.library_mastery_estimate),
      nextReviewAt: nullableNumber(row.library_next_review_at),
      confirmed: problem.verificationStatus === 'verified',
      favorite: Number(row.library_is_favorite ?? 0) === 1,
      note: String(row.library_note ?? ''),
    },
  }
}

export async function saveSourceDocument(
  media: PersistedMedia,
): Promise<SourceDocument> {
  const document: SourceDocument = {
    id: media.id,
    originalImagePath: media.path,
    correctedImagePath: null,
    contentHash: media.contentHash,
    sourceType: media.sourceType,
    processingStatus: 'captured',
    capturedAt: media.capturedAt,
    createdAt: Date.now(),
  }

  if (!isDesktopRuntime()) {
    browserDocuments.unshift(document)
    return document
  }

  const db = await database()
  await db.execute(
    `INSERT OR IGNORE INTO source_documents (
      id, original_image_path, corrected_image_path, content_hash,
      source_type, processing_status, captured_at, created_at
    ) VALUES ($1, $2, NULL, $3, $4, $5, $6, $7)`,
    [
      document.id,
      document.originalImagePath,
      document.contentHash,
      document.sourceType,
      document.processingStatus,
      document.capturedAt,
      document.createdAt,
    ],
  )

  const rows = await db.select<Record<string, unknown>[]>(
    'SELECT * FROM source_documents WHERE content_hash = $1 LIMIT 1',
    [document.contentHash],
  )
  return rows[0] ? rowToSourceDocument(rows[0]) : document
}

export async function listRecentSourceDocuments(
  limit = 6,
): Promise<SourceDocument[]> {
  if (!isDesktopRuntime()) return browserDocuments.slice(0, limit)

  const db = await database()
  const rows = await db.select<Record<string, unknown>[]>(
    `SELECT * FROM source_documents
     ORDER BY captured_at DESC
     LIMIT $1`,
    [limit],
  )
  return rows.map(rowToSourceDocument)
}

async function replaceCandidateProblems(
  db: DatabaseLike,
  sourceDocumentId: string,
  blocks: ProblemBlock[],
) {
  const now = Date.now()
  if (blocks.length) {
    const values: unknown[] = []
    const rows = blocks.map((block) => {
      const parameters = [
        block.id,
        sourceDocumentId,
        block.rect.x,
        block.rect.y,
        block.rect.width,
        block.rect.height,
        block.title,
        block.userTitle ?? null,
        JSON.stringify({
          lineIds: block.lineIds,
          source: block.source,
        }),
        block.confidence,
        now,
      ].map((value) => `$${values.push(value)}`)
      return `(${parameters.slice(0, 8).join(', ')}, NULL, ${parameters
        .slice(8, 10)
        .join(', ')}, 'unverified', 'candidate', ${parameters[10]}, ${
        parameters[10]
      })`
    })
    await db.execute(
      `INSERT INTO problems (
        id, source_document_id, crop_x, crop_y, crop_width, crop_height,
        title, user_title, stem_markdown, structured_content_json, model_confidence,
        verification_status, status, created_at, updated_at
      ) VALUES ${rows.join(', ')}
      ON CONFLICT(id) DO UPDATE SET
        crop_x = excluded.crop_x,
        crop_y = excluded.crop_y,
        crop_width = excluded.crop_width,
        crop_height = excluded.crop_height,
        title = excluded.title,
        user_title = excluded.user_title,
        structured_content_json = excluded.structured_content_json,
        model_confidence = excluded.model_confidence,
        updated_at = excluded.updated_at
      WHERE problems.status = 'candidate'
        AND problems.source_document_id = excluded.source_document_id`,
      values,
    )
  }

  if (!blocks.length) {
    await db.execute(
      `DELETE FROM problems
       WHERE source_document_id = $1 AND status = 'candidate'`,
      [sourceDocumentId],
    )
    return
  }

  const placeholders = blocks
    .map((_, index) => `$${index + 2}`)
    .join(', ')
  await db.execute(
    `DELETE FROM problems
     WHERE source_document_id = $1
       AND status = 'candidate'
       AND id NOT IN (${placeholders})`,
    [sourceDocumentId, ...blocks.map((block) => block.id)],
  )
}

export async function saveDocumentProcessing(
  sourceDocumentId: string,
  result: DocumentProcessingResult,
) {
  if (!isDesktopRuntime()) return
  const db = await database()
  await db.execute(
    `UPDATE source_documents
     SET corrected_image_path = $1,
         processing_status = 'ready_for_segmentation',
         page_detection_json = $2,
         processed_width = $3,
         processed_height = $4,
         enhancement_mode = $5
     WHERE id = $6`,
    [
      result.correctedPath,
      JSON.stringify({
        pageDetected: result.pageDetected,
        corners: result.corners,
      }),
      result.width,
      result.height,
      result.enhancementMode,
      sourceDocumentId,
    ],
  )
  await db.execute(
    `INSERT INTO document_processing_runs (
      id, source_document_id, corrected_image_path, page_detected,
      corners_json, text_lines_json, blocks_json, enhancement_mode,
      warnings_json, duration_ms, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      result.processingRunId,
      sourceDocumentId,
      result.correctedPath,
      result.pageDetected ? 1 : 0,
      JSON.stringify(result.corners),
      JSON.stringify(result.textLines),
      JSON.stringify(result.blocks),
      result.enhancementMode,
      JSON.stringify(result.warnings),
      result.durationMs,
      Date.now(),
    ],
  )
  await replaceCandidateProblems(db, sourceDocumentId, result.blocks)
}

export async function saveCandidateBlocks(
  sourceDocumentId: string,
  blocks: ProblemBlock[],
) {
  if (!isDesktopRuntime()) return
  await replaceCandidateProblems(await database(), sourceDocumentId, blocks)
}

export async function loadCandidateBlocks(
  sourceDocumentId: string,
): Promise<ProblemBlock[]> {
  if (!isDesktopRuntime()) return []
  const rows = await (await database()).select<Record<string, unknown>[]>(
    `SELECT id, crop_x, crop_y, crop_width, crop_height, title, user_title,
            stem_markdown,
            structured_content_json, model_confidence
     FROM problems
     WHERE source_document_id = $1 AND status = 'candidate'
     ORDER BY crop_y, crop_x`,
    [sourceDocumentId],
  )
  return rows.map((row) => {
    // Tolerant parsing: a corrupted field must not break loading every
    // candidate block on the capture editing page.
    const metadata = parseJSON<{
      lineIds?: string[]
      source?: ProblemBlock['source']
    }>(row.structured_content_json, {}, 'problems.structured_content_json')
    return {
      id: String(row.id),
      title: String(row.user_title ?? row.title ?? row.stem_markdown ?? '未命名题目'),
      userTitle: nullableString(row.user_title),
      rect: {
        x: Number(row.crop_x),
        y: Number(row.crop_y),
        width: Number(row.crop_width),
        height: Number(row.crop_height),
      },
      confidence: Number(row.model_confidence || 0),
      lineIds: metadata.lineIds ?? [],
      source: metadata.source ?? 'manual',
    }
  })
}

async function cleanupCreatedProblemImages(
  images: PersistedProblemImage[],
) {
  await Promise.allSettled(
    images
      .filter((image) => image.created)
      .map((image) => removeProblemImage(image.path)),
  )
}

function validateBlocksForSave(blocks: ProblemBlock[]) {
  if (!blocks.length) {
    throw new Error('没有可保存的题目块')
  }
  if (new Set(blocks.map((block) => block.id)).size !== blocks.length) {
    throw new Error('题目块 ID 重复，请重新识别后再试')
  }
  for (const block of blocks) {
    const { x, y, width, height } = block.rect
    const values = [x, y, width, height]
    if (
      values.some((value) => !Number.isFinite(value)) ||
      x < 0 ||
      y < 0 ||
      width <= 0 ||
      height <= 0 ||
      x + width > 1.000001 ||
      y + height > 1.000001
    ) {
      throw new Error(`“${block.title}”的裁剪区域无效`)
    }
  }
}

const AI_TASK_TYPE = 'analyze_problem_image'
const GEOMETRY_SCENE_TASK_TYPE = 'geometry_scene'
const SOLUTION_TASK_TYPE = 'generate_solution'
const STUDENT_ATTEMPT_TASK_TYPE = 'extract_student_attempt'
const REASONING_TASK_TYPE = 'analyze_student_reasoning'
const EXPLAIN_TASK_TYPE = 'explain_selection'
// model_runs 表中出现的全部任务类型（题目理解/正解/作答/推理/解释）
const MODEL_RUN_TASK_TYPES = [
  AI_TASK_TYPE,
  GEOMETRY_SCENE_TASK_TYPE,
  SOLUTION_TASK_TYPE,
  STUDENT_ATTEMPT_TASK_TYPE,
  REASONING_TASK_TYPE,
  EXPLAIN_TASK_TYPE,
] as const

interface NewAIModelRun {
  id: string
  problemId: string
  provider: string
  model: string
  input: AIProblemInput
  createdAt: number
}

function stableInputHash(input: unknown) {
  const value = JSON.stringify(input)
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`
}

function createAIModelRun(
  problem: Pick<
    SavedProblem,
    | 'id'
    | 'cropImagePath'
    | 'correctedImagePath'
    | 'cropRect'
  >,
): NewAIModelRun {
  const provider = getAIProvider()
  return {
    id: crypto.randomUUID(),
    problemId: problem.id,
    provider: provider.id,
    model: provider.model,
    input: {
      problemId: problem.id,
      cropImagePath: problem.cropImagePath,
      sourceDocumentCorrectedImagePath: problem.correctedImagePath,
      cropRect: problem.cropRect,
    },
    createdAt: Date.now(),
  }
}

async function insertAIModelRuns(
  db: DatabaseLike,
  runs: NewAIModelRun[],
) {
  if (!runs.length) return
  const values: unknown[] = []
  const rows = runs.map((run) => {
    const parameters = [
      run.id,
      run.problemId,
      AI_TASK_TYPE,
      run.provider,
      run.model,
      PROBLEM_ANALYSIS_PROMPT_VERSION,
      PROBLEM_ANALYSIS_SCHEMA_VERSION,
      stableInputHash(run.input),
      JSON.stringify(run.input),
      'pending',
      run.createdAt,
    ].map((value) => `$${values.push(value)}`)
    return `(${parameters.join(', ')})`
  })
  await db.execute(
    `INSERT INTO model_runs (
      id, problem_id, task_type, provider, model,
      prompt_version, schema_version, input_hash, input_json,
      status, created_at
    ) VALUES ${rows.join(', ')}`,
    values,
  )
}

function createSolutionInput(problem: SavedProblem): SolutionInput {
  return {
    problemId: problem.id,
    cropImagePath: problem.cropImagePath,
    subject: problem.subject ?? '',
    problemType: problem.aiProblemType ?? '',
    stemMarkdown: problem.stemMarkdown ?? '',
    choices: problem.aiChoices,
    subQuestions: problem.aiSubQuestions,
    hasDiagram: Boolean(problem.aiHasDiagram),
    diagramKind: problem.aiDiagramKind ?? 'unknown',
    knowledgePoints: problem.knowledgePoints,
  }
}

function solutionProviderIdentity() {
  try {
    const provider = getSolutionProvider()
    return { provider: provider.id, model: provider.model }
  } catch {
    return { provider: 'solution-unavailable', model: 'none' }
  }
}

function createSolutionModelRun(problem: SavedProblem): SolutionModelRun {
  const identity = solutionProviderIdentity()
  return {
    id: crypto.randomUUID(),
    problemId: problem.id,
    taskType: SOLUTION_TASK_TYPE,
    provider: identity.provider,
    model: identity.model,
    input: createSolutionInput(problem),
    output: null,
    rawOutput: '',
    repairStrategy: null,
    status: 'pending',
    errorMessage: null,
    createdAt: Date.now(),
  }
}

async function insertSolutionModelRun(
  db: DatabaseLike,
  run: SolutionModelRun,
) {
  await db.execute(
    `INSERT INTO model_runs (
      id, problem_id, task_type, provider, model,
      prompt_version, schema_version, input_hash, input_json,
      status, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', $10)`,
    [
      run.id,
      run.problemId,
      SOLUTION_TASK_TYPE,
      run.provider,
      run.model,
      SOLUTION_PROMPT_VERSION,
      SOLUTION_SCHEMA_VERSION,
      stableInputHash(run.input),
      JSON.stringify(run.input),
      run.createdAt,
    ],
  )
}

async function insertIntelligenceModelRun(
  db: DatabaseLike,
  run: StudentAttemptModelRun | ReasoningModelRun | ExplainModelRun,
) {
  const promptAndSchema =
    run.taskType === STUDENT_ATTEMPT_TASK_TYPE
      ? [STUDENT_ATTEMPT_PROMPT_VERSION, STUDENT_ATTEMPT_SCHEMA_VERSION]
      : run.taskType === REASONING_TASK_TYPE
        ? [REASONING_ANALYSIS_PROMPT_VERSION, REASONING_ANALYSIS_SCHEMA_VERSION]
        : [EXPLAIN_SELECTION_PROMPT_VERSION, EXPLAIN_SELECTION_SCHEMA_VERSION]
  await db.execute(
    `INSERT INTO model_runs (
      id, problem_id, task_type, provider, model,
      prompt_version, schema_version, input_hash, input_json,
      status, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', $10)`,
    [
      run.id,
      run.problemId,
      run.taskType,
      run.provider,
      run.model,
      promptAndSchema[0],
      promptAndSchema[1],
      stableInputHash(run.input),
      JSON.stringify(run.input),
      run.createdAt,
    ],
  )
}

const SAVED_PROBLEM_LIBRARY_COLUMNS = `p.*, d.original_image_path, d.corrected_image_path,
       trim(COALESCE((SELECT group_concat(COALESCE(definition.canonical_name, tag.candidate_name, '') || ' ' || COALESCE(tag.evidence, ''), ' ')
         FROM problem_tags tag LEFT JOIN tag_definitions definition ON definition.id=tag.tag_id
         WHERE tag.problem_id=p.id AND tag.superseded_at IS NULL AND tag.mapping_status!='rejected'), '') || ' ' ||
       COALESCE((SELECT solution.content_markdown FROM problem_solutions solution
         WHERE solution.problem_id=p.id AND solution.status='completed' ORDER BY solution.updated_at DESC LIMIT 1), '') || ' ' ||
       COALESCE((SELECT profile.note FROM problem_library_profiles profile WHERE profile.problem_id=p.id), '') || ' ' ||
       COALESCE(p.user_title,p.ai_title,p.title,'') || ' ' ||
       COALESCE(p.user_subject,p.ai_subject,p.subject,'') || ' ' ||
       COALESCE(p.user_stem_markdown,p.ai_stem_markdown,p.stem_markdown,'')) AS library_search_text,
       (SELECT difficulty.level FROM problem_difficulties difficulty
         WHERE difficulty.problem_id=p.id AND difficulty.superseded_at IS NULL LIMIT 1) AS library_difficulty,
       (SELECT textbook.title FROM textbooks textbook WHERE textbook.id=p.matched_textbook_id LIMIT 1) AS library_textbook_title,
       (SELECT group_concat(DISTINCT chapter.canonical_name)
         FROM problem_tags tag
         JOIN tag_definitions definition ON definition.id=tag.tag_id
         JOIN knowledge_nodes node ON node.id=definition.knowledge_node_id
         JOIN knowledge_nodes chapter ON chapter.id=COALESCE(node.parent_id,node.id) AND chapter.node_type='chapter'
         WHERE tag.problem_id=p.id AND tag.superseded_at IS NULL) AS library_chapters,
       COALESCE((SELECT json_group_array(json_object(
          'id',tag.tag_id,'name',COALESCE(definition.canonical_name,tag.candidate_name,'未命名标签'),'type',tag.tag_type))
         FROM problem_tags tag LEFT JOIN tag_definitions definition ON definition.id=tag.tag_id
         WHERE tag.problem_id=p.id AND tag.superseded_at IS NULL AND tag.mapping_status!='rejected'), '[]') AS library_tags_json,
       (SELECT AVG(state.mastery_estimate) FROM problem_tags tag JOIN skill_states state
         ON state.tag_id=tag.tag_id AND state.subject=COALESCE(NULLIF(p.user_subject,''),NULLIF(p.ai_subject,''),p.subject)
         WHERE tag.problem_id=p.id AND tag.superseded_at IS NULL AND tag.tag_type!='error') AS library_mastery_estimate,
       (SELECT MIN(state.next_review_at) FROM problem_tags tag JOIN skill_states state
         ON state.tag_id=tag.tag_id AND state.subject=COALESCE(NULLIF(p.user_subject,''),NULLIF(p.ai_subject,''),p.subject)
         WHERE tag.problem_id=p.id AND tag.superseded_at IS NULL AND tag.tag_type!='error') AS library_next_review_at,
       COALESCE((SELECT profile.is_favorite FROM problem_library_profiles profile WHERE profile.problem_id=p.id),0) AS library_is_favorite,
       COALESCE((SELECT profile.note FROM problem_library_profiles profile WHERE profile.problem_id=p.id),'') AS library_note`

async function selectSavedProblemsByIds(
  db: DatabaseLike,
  ids: string[],
): Promise<SavedProblem[]> {
  const placeholders = ids.map((_, index) => `$${index + 1}`).join(', ')
  const rows = await db.select<Record<string, unknown>[]>(
    `SELECT ${SAVED_PROBLEM_LIBRARY_COLUMNS}
     FROM problems p
     JOIN source_documents d ON d.id = p.source_document_id
     WHERE p.id IN (${placeholders})
       AND p.status = 'saved'
       AND p.deleted_at IS NULL
     ORDER BY p.crop_y, p.crop_x`,
    ids,
  )
  return rows.map(rowToSavedProblem)
}

export async function saveProblems(
  sourceDocumentId: string,
  correctedImagePath: string | null,
  blocks: ProblemBlock[],
  selectedIds: string[],
  regionSelections: Record<
    string,
    {
      answer: Problem['cropRect'] | null
      diagram: Problem['cropRect'] | null
    }
  > = {},
  options: {
    redactions?: Problem['cropRect'][]
    queueAI?: boolean
  } = {},
): Promise<SavedProblem[]> {
  if (!isDesktopRuntime()) {
    throw new Error('错题保存需要在 Axiom 桌面 App 中运行')
  }
  if (!correctedImagePath) {
    throw new Error('校正后的页面图片不存在，请先重新处理页面')
  }
  validateBlocksForSave(blocks)
  if (!selectedIds.length) {
    throw new Error('请至少选择一道要保存的错题')
  }
  if (new Set(selectedIds).size !== selectedIds.length) {
    throw new Error('保存选择中存在重复题目，请重新选择')
  }
  const selectedIdSet = new Set(selectedIds)
  const selectedBlocks = blocks.filter((block) => selectedIdSet.has(block.id))
  if (selectedBlocks.length !== selectedIds.length) {
    throw new Error('部分所选题目块已不存在，请重新选择后再试')
  }
  const redactions = options.redactions ?? []
  if (redactions.some((rect) => !isValidNormalizedRect(rect))) {
    throw new Error('隐私遮挡区域边界无效')
  }
  const queueAI = options.queueAI ?? true

  await saveCandidateBlocks(sourceDocumentId, blocks)
  const db = await database()
  const ids = selectedBlocks.map((block) => block.id)
  const idPlaceholders = ids
    .map((_, index) => `$${index + 1}`)
    .join(', ')
  const current = await db.select<Record<string, unknown>[]>(
    `SELECT id, status
     FROM problems
     WHERE source_document_id = $${ids.length + 1}
       AND id IN (${idPlaceholders})`,
    [...ids, sourceDocumentId],
  )
  if (current.length !== selectedBlocks.length) {
    throw new Error('部分题目块已不存在，请重新处理页面后再试')
  }
  if (current.some((row) => String(row.status) === 'saved')) {
    throw new Error('所选题目块已经保存，请前往错题库查看')
  }
  const existingSavedRows = await db.select<Record<string, unknown>[]>(
    `SELECT crop_x, crop_y, crop_width, crop_height
     FROM problems
     WHERE source_document_id = $1
       AND status = 'saved'
       AND deleted_at IS NULL`,
    [sourceDocumentId],
  )
  const duplicate = selectedBlocks.find((block) =>
    existingSavedRows.some((row) =>
      isSameCropRect(block.rect, {
        x: Number(row.crop_x),
        y: Number(row.crop_y),
        width: Number(row.crop_width),
        height: Number(row.crop_height),
      }),
    ),
  )
  if (duplicate) {
    throw new Error(`“${duplicate.title}”已经保存，请勿重复添加`)
  }

  const images: PersistedProblemImage[] = []
  const questionImages: PersistedProblemImage[] = []
  const regionRows: Array<{
    id: string
    problemId: string
    type: ProblemRegionType
    rect: Problem['cropRect']
    imagePath: string | null
    source: 'manual' | 'auto'
    createdAt: number
  }> = []
  try {
    // Plan every crop up front (validating rects before creating any file),
    // then run them with bounded concurrency: one IPC round trip per image
    // adds up quickly when saving a full page of problems.
    const cropTasks = selectedBlocks.flatMap((block) => {
      const selectedRegions = regionSelections[block.id] ?? {
        answer: null,
        diagram: null,
      }
      const tasks: Array<{
        id: string
        problemId: string
        type: ProblemRegionType
        rect: Problem['cropRect']
        source: 'manual' | 'auto'
      }> = [{
        id: `question-${block.id}`,
        problemId: block.id,
        type: 'question',
        rect: block.rect,
        source: block.source,
      }]
      for (const [type, regionRect] of [
        ['answer', selectedRegions.answer],
        ['diagram', selectedRegions.diagram],
      ] as const) {
        if (!regionRect) continue
        if (!isValidNormalizedRect(regionRect)) {
          throw new Error(`${type === 'answer' ? '作答' : '图形'}区域边界无效`)
        }
        tasks.push({
          id: `${type}-${block.id}`,
          problemId: block.id,
          type,
          rect: regionRect,
          source: 'manual',
        })
      }
      return tasks
    })
    const croppedImages = await mapWithConcurrency(
      cropTasks,
      4,
      (task) => cropProblemImage(task.id, correctedImagePath, task.rect, redactions),
    )
    croppedImages.forEach((image, index) => {
      const task = cropTasks[index]
      images.push(image)
      if (task.type === 'question') questionImages.push(image)
      regionRows.push({
        id: task.id,
        problemId: task.problemId,
        type: task.type,
        rect: task.rect,
        imagePath: image.path,
        source: task.source,
        createdAt: Date.now(),
      })
    })
  } catch (error) {
    await cleanupCreatedProblemImages(images)
    throw new Error(`生成题块图片失败：${String(error)}`)
  }

  const queuedRuns = queueAI
    ? selectedBlocks.map((block, index) =>
        createAIModelRun({
          id: block.id,
          cropImagePath: questionImages[index].path,
          correctedImagePath,
          cropRect: block.rect,
        }),
      )
    : []

  try {
    const values: unknown[] = []
    const cases = questionImages.map((image, index) => {
      const idParameter = values.push(selectedBlocks[index].id)
      const pathParameter = values.push(image.path)
      return `WHEN $${idParameter} THEN $${pathParameter}`
    })
    const aiAssignments = queueAI
      ? (() => {
          const runCases = queuedRuns.map((run) => {
            const idParameter = values.push(run.problemId)
            const runParameter = values.push(run.id)
            return `WHEN $${idParameter} THEN $${runParameter}`
          })
          return `ai_status = 'pending',
               ai_active_model_run_id = CASE id ${runCases.join(' ')} END,`
        })()
      : `ai_status = 'not_started',
               ai_active_model_run_id = NULL,`
    const updatedAtParameter = values.push(Date.now())
    const eligibleSourceParameter = values.push(sourceDocumentId)
    const eligibleIds = selectedBlocks.map((block) => {
      const parameter = values.push(block.id)
      return `$${parameter}`
    })
    await withTransactionLock(async () => {
      await db.execute('BEGIN')
      try {
        const result = await db.execute(
          `WITH eligible AS MATERIALIZED (
             SELECT id
             FROM problems
             WHERE source_document_id = $${eligibleSourceParameter}
               AND status = 'candidate'
               AND id IN (${eligibleIds.join(', ')})
           )
           UPDATE problems
           SET crop_image_path = CASE id ${cases.join(' ')} END,
               status = 'saved',
               ${aiAssignments}
               updated_at = $${updatedAtParameter}
           WHERE id IN (SELECT id FROM eligible)
             AND (SELECT COUNT(*) FROM eligible) = ${selectedBlocks.length}`,
          values,
        )
        if (result.rowsAffected !== selectedBlocks.length) {
          throw new Error('题目状态已发生变化，没有写入任何错题')
        }
        for (const region of regionRows) {
          await db.execute(
            `INSERT INTO problem_regions (
              id, problem_id, region_type, x, y, width, height, image_path, source, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
            ON CONFLICT(id) DO UPDATE SET
              region_type = excluded.region_type, x = excluded.x, y = excluded.y,
              width = excluded.width, height = excluded.height, image_path = excluded.image_path,
              source = excluded.source,
              updated_at = excluded.updated_at`,
            [
              region.id,
              region.problemId,
              region.type,
              region.rect.x,
              region.rect.y,
              region.rect.width,
              region.rect.height,
              region.imagePath,
              region.source,
              region.createdAt,
            ],
          )
        }
        // 选择发送到 Provider 时，model_runs 必须与 problem 状态更新在同一事务内提交，
        // 避免「problem.ai_status='pending' + ai_active_model_run_id 指向不存在的 run」的孤儿状态。
        // 仅保存本地时不创建 ModelRun，后续由用户在错题详情明确启动。
        // 事务回滚后已生成的图片文件由外层 catch 中的 cleanupCreatedProblemImages 清理。
        await insertAIModelRuns(db, queuedRuns)
        await db.execute('COMMIT')
      } catch (error) {
        try {
          await db.execute('ROLLBACK')
        } catch {
          try {
            await db.execute('ROLLBACK')
          } catch {
            /* preserve original error */
          }
        }
        throw error
      }
    })
  } catch (error) {
    await cleanupCreatedProblemImages(images)
    throw new Error(`数据库写入失败：${String(error)}`)
  }

  const saved = await selectSavedProblemsByIds(db, ids)
  if (saved.length !== selectedBlocks.length) {
    throw new Error('错题已写入，但重新读取结果不完整，请重启 App 后检查')
  }
  return saved
}

export async function listSavedProblems(
  archived = false,
  deleted = false,
): Promise<SavedProblem[]> {
  if (!isDesktopRuntime()) return []
  const rows = await (await database()).select<Record<string, unknown>[]>(
    `SELECT ${SAVED_PROBLEM_LIBRARY_COLUMNS}
     FROM problems p
     JOIN source_documents d ON d.id = p.source_document_id
     WHERE p.status = 'saved'
       AND p.crop_image_path IS NOT NULL
       AND p.deleted_at IS ${deleted ? 'NOT NULL' : 'NULL'}
       ${deleted ? '' : `AND p.archived_at IS ${archived ? 'NOT NULL' : 'NULL'}`}
     ORDER BY p.created_at DESC`,
  )
  return rows.map(rowToSavedProblem)
}

export async function searchSavedProblemIds(
  query: string,
  archived = false,
  deleted = false,
): Promise<string[]> {
  if (!isDesktopRuntime()) return []
  const normalized = query.normalize('NFKC').trim()
  if (!normalized) return []
  const db = await database()
  const stateClause = `problem.deleted_at IS ${deleted ? 'NOT NULL' : 'NULL'}
    ${deleted ? '' : `AND problem.archived_at IS ${archived ? 'NOT NULL' : 'NULL'}`}`
  const fallback = async () => {
    const rows = await db.select<Array<{ problem_id: string }>>(
      `SELECT source.problem_id
       FROM problem_library_search_source source
       JOIN problems problem ON problem.id=source.problem_id
       WHERE ${stateClause}
         AND lower(source.subject || ' ' || source.title || ' ' || source.stem || ' ' ||
           source.answer || ' ' || source.tags || ' ' || source.note) LIKE '%' || lower($1) || '%'`,
      [normalized],
    )
    return rows.map((row) => row.problem_id)
  }
  if ([...normalized].length < 3) return fallback()
  try {
    const match = `"${normalized.replaceAll('"', '""')}"`
    const rows = await db.select<Array<{ problem_id: string }>>(
      `SELECT indexed.problem_id
       FROM problem_library_fts indexed
       JOIN problems problem ON problem.id=indexed.problem_id
       WHERE problem_library_fts MATCH $1 AND ${stateClause}`,
      [match],
    )
    return rows.map((row) => row.problem_id)
  } catch (error) {
    console.warn('FTS 搜索失败，回退到本地子串匹配', error)
    return fallback()
  }
}

export async function getSavedProblem(
  id: string,
): Promise<SavedProblem | null> {
  if (!isDesktopRuntime()) return null
  const rows = await (await database()).select<Record<string, unknown>[]>(
    `SELECT ${SAVED_PROBLEM_LIBRARY_COLUMNS}
     FROM problems p
     JOIN source_documents d ON d.id = p.source_document_id
     WHERE p.id = $1
       AND p.status = 'saved'
       AND p.crop_image_path IS NOT NULL
       AND p.deleted_at IS NULL
     LIMIT 1`,
    [id],
  )
  return rows[0] ? rowToSavedProblem(rows[0]) : null
}

function rowToProblemRegion(row: Record<string, unknown>): ProblemRegion {
  return {
    id: String(row.id),
    problemId: String(row.problem_id),
    type: String(row.region_type) as ProblemRegionType,
    rect: {
      x: Number(row.x),
      y: Number(row.y),
      width: Number(row.width),
      height: Number(row.height),
    },
    imagePath: nullableString(row.image_path),
    source: row.source === 'manual' ? 'manual' : 'auto',
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}

function validateProblemRegion(region: Pick<ProblemRegion, 'rect' | 'type'>) {
  if (!['question', 'answer', 'diagram', 'annotation'].includes(region.type)) {
    throw new Error(`不支持的区域类型：${region.type}`)
  }
  if (!isValidNormalizedRect(region.rect)) {
    throw new Error('区域边界必须是 0 到 1 范围内的有效矩形')
  }
}

function hasUsableDiagramBounds(rect: Problem['aiDiagramBBox']) {
  return Boolean(rect && rect.width > 0.001 && rect.height > 0.001)
}

export async function getProblemRegions(problemId: string): Promise<ProblemRegion[]> {
  if (!isDesktopRuntime()) return browserProblemRegions.get(problemId) ?? []
  const rows = await (await database()).select<Record<string, unknown>[]>(
    `SELECT * FROM problem_regions WHERE problem_id = $1 ORDER BY created_at, id`,
    [problemId],
  )
  return rows.map(rowToProblemRegion)
}

export async function saveProblemRegions(
  problemId: string,
  regions: ProblemRegion[],
): Promise<ProblemRegion[]> {
  regions.forEach((region) => {
    if (region.problemId !== problemId) throw new Error('区域所属题目不一致')
    validateProblemRegion(region)
  })
  if (!isDesktopRuntime()) {
    browserProblemRegions.set(problemId, regions)
    return regions
  }
  const db = await database()
  const now = Date.now()
  await withTransactionLock(async () => {
    await db.execute('BEGIN')
    try {
      const ids = regions.map((region) => region.id)
      if (ids.length) {
        const placeholders = ids.map((_, index) => `$${index + 2}`).join(', ')
        await db.execute(
          `DELETE FROM problem_regions WHERE problem_id = $1 AND id NOT IN (${placeholders})`,
          [problemId, ...ids],
        )
      } else {
        await db.execute('DELETE FROM problem_regions WHERE problem_id = $1', [problemId])
      }
      for (const region of regions) {
        await db.execute(
          `INSERT INTO problem_regions (
            id, problem_id, region_type, x, y, width, height, image_path, source, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          ON CONFLICT(id) DO UPDATE SET
            region_type = excluded.region_type,
            x = excluded.x,
            y = excluded.y,
            width = excluded.width,
            height = excluded.height,
            image_path = excluded.image_path,
            source = excluded.source,
            updated_at = excluded.updated_at`,
          [
            region.id,
            problemId,
            region.type,
            region.rect.x,
            region.rect.y,
            region.rect.width,
            region.rect.height,
            region.imagePath,
            region.source,
            region.createdAt || now,
            now,
          ],
        )
      }
      await db.execute('COMMIT')
    } catch (error) {
      try {
        await db.execute('ROLLBACK')
      } catch {
        try {
          await db.execute('ROLLBACK')
        } catch {
          /* preserve original error */
        }
      }
      throw error
    }
  })
  return getProblemRegions(problemId)
}

export async function getPrimaryQuestionRegion(problem: SavedProblem) {
  const regions = await getProblemRegions(problem.id)
  return (
    regions.find((region) => region.type === 'question') ?? {
      id: `legacy-question-${problem.id}`,
      problemId: problem.id,
      type: 'question' as const,
      rect: problem.cropRect,
      imagePath: problem.cropImagePath,
      source: 'manual' as const,
      createdAt: problem.createdAt,
      updatedAt: problem.updatedAt,
    }
  )
}

function rowToModelRun(row: Record<string, unknown>): ModelRun {
  const rawTaskType = String(row.task_type ?? AI_TASK_TYPE)
  const taskType = (MODEL_RUN_TASK_TYPES as readonly string[]).includes(rawTaskType)
    ? rawTaskType as ModelRun['taskType']
    : AI_TASK_TYPE
  // 只有题目理解任务的 output 是 problem analysis 结构；solution/reasoning
  // 等任务的输出形状不同，且 UI 只消费 rawOutput，不做归一化。
  const output = row.output_json && taskType === AI_TASK_TYPE
    ? normalizeAIProblemAnalysis(parseJSON(row.output_json, {}, `model_runs.output_json#${row.id ?? '?'}`))
    : null
  const structuredError = parseJSON<AIErrorEnvelope | null>(
    row.error_json,
    null,
    `model_runs.error_json#${row.id ?? '?'}`,
  )
  return {
    id: String(row.id),
    problemId: String(row.problem_id),
    taskType,
    provider: String(row.provider),
    model: String(row.model),
    input: parseJSON(row.input_json, {
      problemId: String(row.problem_id),
      cropImagePath: '',
      sourceDocumentCorrectedImagePath: null,
      cropRect: { x: 0, y: 0, width: 1, height: 1 },
    }, `model_runs.input_json#${row.id ?? '?'}`),
    output,
    rawOutput: String(row.raw_output || ''),
    repairStrategy: nullableString(row.repair_strategy),
    status: String(row.status) as ModelRun['status'],
    errorMessage: nullableString(row.error_message),
    error: isAIErrorEnvelope(structuredError) ? structuredError : null,
    latencyMs: row.latency_ms == null ? null : Number(row.latency_ms),
    usage: {
      promptTokens: row.prompt_tokens == null ? null : Number(row.prompt_tokens),
      completionTokens: row.completion_tokens == null ? null : Number(row.completion_tokens),
      totalTokens: row.token_usage == null ? null : Number(row.token_usage),
    },
    estimatedCostUsd: row.estimated_cost_usd == null
      ? null
      : Number(row.estimated_cost_usd),
    createdAt: Number(row.created_at),
  }
}

function rowToSolution(row: Record<string, unknown>): Solution {
  return {
    id: String(row.id),
    problemId: String(row.problem_id),
    contentMarkdown: String(row.content_markdown || ''),
    steps: parseJSON(row.steps_json, [], `problem_solutions.steps_json#${row.id ?? '?'}`),
    keyMethod: nullableString(row.key_method),
    usedFormulas: parseJSON(row.used_formulas_json, [], `problem_solutions.used_formulas_json#${row.id ?? '?'}`),
    knowledgePoints: parseJSON(row.knowledge_points_json, [], `problem_solutions.knowledge_points_json#${row.id ?? '?'}`),
    status: String(row.status) as Solution['status'],
    activeModelRunId: nullableString(row.active_model_run_id),
    errorMessage: nullableString(row.error_message),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}

function emptySolution(problemId: string): Solution {
  return {
    id: '',
    problemId,
    contentMarkdown: '',
    steps: [],
    keyMethod: null,
    usedFormulas: [],
    knowledgePoints: [],
    status: 'not_started',
    activeModelRunId: null,
    errorMessage: null,
    createdAt: 0,
    updatedAt: 0,
  }
}

function rowToStudentAttempt(row: Record<string, unknown>): StudentAttempt {
  return {
    id: String(row.id),
    problemId: String(row.problem_id),
    answerRegionIds: parseJSON(row.answer_region_ids_json, [], `student_attempts.answer_region_ids_json#${row.id ?? '?'}`),
    rawMarkdown: String(row.raw_markdown || ''),
    steps: parseJSON(row.steps_json, [], `student_attempts.steps_json#${row.id ?? '?'}`),
    status: String(row.status) as StudentAttempt['status'],
    activeModelRunId: nullableString(row.active_model_run_id),
    errorMessage: nullableString(row.error_message),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}

function emptyStudentAttempt(problemId: string): StudentAttempt {
  return {
    id: '',
    problemId,
    answerRegionIds: [],
    rawMarkdown: '',
    steps: [],
    status: 'not_started',
    activeModelRunId: null,
    errorMessage: null,
    createdAt: 0,
    updatedAt: 0,
  }
}

function rowToReasoningAnalysis(row: Record<string, unknown>): ReasoningAnalysis {
  return {
    id: String(row.id),
    problemId: String(row.problem_id),
    studentAttemptId: String(row.student_attempt_id),
    solutionId: nullableString(row.solution_id),
    approach: nullableString(row.approach),
    stepEvaluations: parseJSON(row.step_evaluations_json, [], `reasoning_analyses.step_evaluations_json#${row.id ?? '?'}`),
    firstWrongStep: nullableNumber(row.first_wrong_step),
    errorType: nullableString(row.error_type) as ReasoningAnalysis['errorType'],
    reason: nullableString(row.reason),
    knowledgeGaps: parseJSON(row.knowledge_gaps_json, [], `reasoning_analyses.knowledge_gaps_json#${row.id ?? '?'}`),
    suggestion: nullableString(row.suggestion),
    status: String(row.status) as ReasoningAnalysis['status'],
    activeModelRunId: nullableString(row.active_model_run_id),
    errorMessage: nullableString(row.error_message),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}

function emptyReasoningAnalysis(problemId: string): ReasoningAnalysis {
  return {
    id: '',
    problemId,
    studentAttemptId: '',
    solutionId: null,
    approach: null,
    stepEvaluations: [],
    firstWrongStep: null,
    errorType: null,
    reason: null,
    knowledgeGaps: [],
    suggestion: null,
    status: 'not_started',
    activeModelRunId: null,
    errorMessage: null,
    createdAt: 0,
    updatedAt: 0,
  }
}

function rowToSolutionModelRun(
  row: Record<string, unknown>,
): SolutionModelRun {
  return {
    id: String(row.id),
    problemId: String(row.problem_id),
    taskType: SOLUTION_TASK_TYPE,
    provider: String(row.provider),
    model: String(row.model),
    input: parseJSON(row.input_json, {
      problemId: String(row.problem_id),
      cropImagePath: '',
      subject: '',
      problemType: '',
      stemMarkdown: '',
      choices: [],
      subQuestions: [],
      hasDiagram: false,
      diagramKind: 'unknown',
      knowledgePoints: [],
    }, `model_runs.input_json#${row.id ?? '?'}`),
    output: null,
    rawOutput: String(row.raw_output || ''),
    repairStrategy: nullableString(row.repair_strategy),
    status: String(row.status) as SolutionModelRun['status'],
    errorMessage: nullableString(row.error_message),
    createdAt: Number(row.created_at),
  }
}

function rowToStudentAttemptModelRun(
  row: Record<string, unknown>,
): StudentAttemptModelRun {
  return {
    id: String(row.id),
    problemId: String(row.problem_id),
    taskType: STUDENT_ATTEMPT_TASK_TYPE,
    provider: String(row.provider),
    model: String(row.model),
    input: parseJSON(row.input_json, {
      problemId: String(row.problem_id),
      answerImagePaths: [],
      questionImagePath: '',
      subject: '',
      problemContext: '',
      choices: [],
      subQuestions: [],
    }, `model_runs.input_json#${row.id ?? '?'}`),
    output: null,
    rawOutput: String(row.raw_output || ''),
    repairStrategy: nullableString(row.repair_strategy),
    status: String(row.status) as StudentAttemptModelRun['status'],
    errorMessage: nullableString(row.error_message),
    createdAt: Number(row.created_at),
  }
}

function rowToReasoningModelRun(row: Record<string, unknown>): ReasoningModelRun {
  return {
    id: String(row.id),
    problemId: String(row.problem_id),
    taskType: REASONING_TASK_TYPE,
    provider: String(row.provider),
    model: String(row.model),
    input: parseJSON(row.input_json, {
      problemId: String(row.problem_id),
      cropImagePath: '',
      problemContext: '',
      studentAttempt: { rawMarkdown: '', steps: [] },
      solution: null,
      knowledgePoints: [],
    }, `model_runs.input_json#${row.id ?? '?'}`),
    output: null,
    rawOutput: String(row.raw_output || ''),
    repairStrategy: nullableString(row.repair_strategy),
    status: String(row.status) as ReasoningModelRun['status'],
    errorMessage: nullableString(row.error_message),
    createdAt: Number(row.created_at),
  }
}


function analysisOutputJSON(analysis: AIProblemAnalysis) {
  return JSON.stringify({
    title: analysis.title,
    subject: analysis.subject,
    problem_type: analysis.problemType,
    stem_markdown: analysis.stemMarkdown,
    choices: analysis.choices,
    sub_questions: analysis.subQuestions,
    diagram: {
      exists: analysis.hasDiagram,
      kind: analysis.hasDiagram ? analysis.diagramKind : null,
      bbox: analysis.diagramBBox,
    },
    knowledge_points: analysis.knowledgePoints,
    knowledge_tags: analysis.knowledgeTags ?? [],
    method_tags: analysis.methodTags ?? [],
    model_tags: analysis.modelTags ?? [],
    difficulty: analysis.difficulty ?? null,
    error_categories: analysis.errorCategories ?? [],
    textbook_hint: analysis.textbookHint ?? null,
    warnings: analysis.warnings,
  })
}

function solutionOutputJSON(solution: Pick<
  Solution,
  | 'contentMarkdown'
  | 'steps'
  | 'keyMethod'
  | 'usedFormulas'
  | 'knowledgePoints'
>) {
  return JSON.stringify({
    content_markdown: solution.contentMarkdown,
    steps: solution.steps.map((step) => ({
      index: step.index,
      title: step.title,
      content_markdown: step.contentMarkdown,
    })),
    key_method: solution.keyMethod,
    used_formulas: solution.usedFormulas,
    knowledge_points: solution.knowledgePoints,
  })
}

export async function getProblemSolution(
  problemId: string,
): Promise<Solution> {
  if (!isDesktopRuntime()) return emptySolution(problemId)
  const rows = await (await database()).select<Record<string, unknown>[]>(
    `SELECT *
     FROM problem_solutions
     WHERE problem_id = $1
     ORDER BY created_at DESC, id
     LIMIT 1`,
    [problemId],
  )
  return rows[0] ? rowToSolution(rows[0]) : emptySolution(problemId)
}

export async function queueProblemSolution(
  problemId: string,
): Promise<Solution> {
  if (!isDesktopRuntime()) {
    throw new Error('Solution 生成需要在 Axiom 桌面 App 中运行')
  }
  const problem = await getSavedProblem(problemId)
  if (!problem) throw new Error('错题不存在或状态已发生变化')
  const db = await database()
  const run = createSolutionModelRun(problem)
  const solutionId = crypto.randomUUID()
  await inDatabaseTransaction(db, async () => {
    await insertSolutionModelRun(db, run)
    await db.execute(
      `INSERT INTO problem_solutions (
        id, problem_id, status, content_markdown, steps_json,
        key_method, used_formulas_json, knowledge_points_json,
        active_model_run_id, error_message, created_at, updated_at
      ) VALUES (
        $1, $2, 'pending', NULL, '[]', NULL, '[]', '[]',
        $3, NULL, $4, $4
      )
      ON CONFLICT(problem_id) DO UPDATE SET
        status = 'pending',
        active_model_run_id = excluded.active_model_run_id,
        error_message = NULL,
        updated_at = excluded.updated_at`,
      [solutionId, problemId, run.id, run.createdAt],
    )
  })
  return getProblemSolution(problemId)
}

export async function invalidateProblemSolution(problemId: string) {
  if (!isDesktopRuntime()) return
  await (await database()).execute(
    `UPDATE problem_solutions
     SET status = 'not_started',
         active_model_run_id = NULL,
         error_message = NULL,
         updated_at = $1
     WHERE problem_id = $2`,
    [Date.now(), problemId],
  )
}

export async function markProblemSolutionFailed(
  problemId: string,
  error: unknown,
) {
  if (!isDesktopRuntime()) return
  const now = Date.now()
  const message = String(error).slice(0, 2000)
  await (await database()).execute(
    `INSERT INTO problem_solutions (
      id, problem_id, status, content_markdown, steps_json,
      key_method, used_formulas_json, knowledge_points_json,
      active_model_run_id, error_message, created_at, updated_at
    ) VALUES (
      $1, $2, 'failed', NULL, '[]', NULL, '[]', '[]',
      NULL, $3, $4, $4
    )
    ON CONFLICT(problem_id) DO UPDATE SET
      status = 'failed',
      active_model_run_id = NULL,
      error_message = excluded.error_message,
      updated_at = excluded.updated_at`,
    [crypto.randomUUID(), problemId, message, now],
  )
}

export async function recoverSolutionTasks() {
  if (!isDesktopRuntime()) return
  const db = await database()
  await db.execute(
    `UPDATE model_runs
     SET status = 'pending',
         error_message = NULL
     WHERE task_type = $1
       AND status = 'processing'
       AND EXISTS (
         SELECT 1
         FROM problem_solutions solution
         WHERE solution.active_model_run_id = model_runs.id
           AND solution.status IN ('pending', 'processing')
       )`,
    [SOLUTION_TASK_TYPE],
  )
  await db.execute(
    `UPDATE problem_solutions
     SET status = 'pending',
         error_message = NULL
     WHERE status = 'processing'
       AND EXISTS (
         SELECT 1
         FROM problems problem
         WHERE problem.id = problem_solutions.problem_id
           AND problem.status = 'saved'
           AND problem.deleted_at IS NULL
       )`,
  )
}

export async function claimNextSolutionModelRun():
Promise<SolutionModelRun | null> {
  if (!isDesktopRuntime()) return null
  const db = await database()
  const rows = await db.select<Record<string, unknown>[]>(
    `SELECT run.*
     FROM model_runs run
     JOIN problem_solutions solution
       ON solution.problem_id = run.problem_id
      AND solution.active_model_run_id = run.id
     JOIN problems problem
       ON problem.id = run.problem_id
     WHERE run.task_type = $1
       AND run.status = 'pending'
       AND solution.status = 'pending'
       AND problem.status = 'saved'
       AND problem.deleted_at IS NULL
     ORDER BY run.created_at
     LIMIT 1`,
    [SOLUTION_TASK_TYPE],
  )
  if (!rows[0]) return null
  const run = rowToSolutionModelRun(rows[0])
  const claimed = await inDatabaseTransaction(db, async () => {
    const runUpdate = await db.execute(
      `UPDATE model_runs
       SET status = 'processing',
           error_message = NULL
       WHERE id = $1 AND status = 'pending'`,
      [run.id],
    )
    if (runUpdate.rowsAffected !== 1) return false
    const solutionUpdate = await db.execute(
      `UPDATE problem_solutions
       SET status = 'processing',
           error_message = NULL,
           updated_at = $1
       WHERE problem_id = $2
         AND active_model_run_id = $3
         AND status = 'pending'`,
      [Date.now(), run.problemId, run.id],
    )
    if (solutionUpdate.rowsAffected !== 1) {
      throw new Error('Solution 任务已被更新的运行取代')
    }
    return true
  })
  if (!claimed) return null
  return { ...run, status: 'processing' }
}

export async function completeSolutionModelRun(
  run: SolutionModelRun,
  solution: GeneratedSolution,
) {
  const db = await database()
  const now = Date.now()
  const outputJSON = solutionOutputJSON(solution)
  await inDatabaseTransaction(db, async () => {
    const completedRun = await db.execute(
      `UPDATE model_runs
       SET output_json = $1,
           status = 'completed',
           error_message = NULL,
           latency_ms = $2
       WHERE id = $3 AND status = 'processing'`,
      [outputJSON, Math.max(0, now - run.createdAt), run.id],
    )
    if (completedRun.rowsAffected !== 1) {
      throw new Error('Solution Model Run 已不再处于处理中状态')
    }
    const completedSolution = await db.execute(
      `UPDATE problem_solutions
       SET status = 'completed',
           content_markdown = $1,
           steps_json = $2,
           key_method = $3,
           used_formulas_json = $4,
           knowledge_points_json = $5,
           error_message = NULL,
           updated_at = $6
       WHERE problem_id = $7
         AND active_model_run_id = $8
         AND status = 'processing'`,
      [
        solution.contentMarkdown,
        JSON.stringify(solution.steps),
        solution.keyMethod,
        JSON.stringify(solution.usedFormulas),
        JSON.stringify(solution.knowledgePoints),
        now,
        run.problemId,
        run.id,
      ],
    )
    if (completedSolution.rowsAffected !== 1) {
      throw new Error('Solution 任务已被更新的运行取代')
    }
  })
}

export async function failSolutionModelRun(
  run: SolutionModelRun,
  error: unknown,
) {
  const db = await database()
  const now = Date.now()
  const message = String(error).slice(0, 2000)
  await inDatabaseTransaction(db, async () => {
    await db.execute(
      `UPDATE model_runs
       SET status = 'failed',
           error_message = $1,
           latency_ms = $2
       WHERE id = $3 AND status = 'processing'`,
      [message, Math.max(0, now - run.createdAt), run.id],
    )
    await db.execute(
      `UPDATE problem_solutions
       SET status = 'failed',
           error_message = $1,
           updated_at = $2
       WHERE problem_id = $3
         AND active_model_run_id = $4
         AND status = 'processing'`,
      [message, now, run.problemId, run.id],
    )
  })
}

function emptyStudentAttemptInput(problem: SavedProblem): StudentAttemptInput {
  return {
    problemId: problem.id,
    answerImagePaths: [],
    questionImagePath: problem.cropImagePath,
    subject: problem.subject ?? '',
    problemContext: problem.stemMarkdown ?? '',
    choices: problem.aiChoices,
    subQuestions: problem.aiSubQuestions,
  }
}

async function createStudentAttemptInput(problem: SavedProblem) {
  const regions = await getProblemRegions(problem.id)
  const answerImagePaths = regions
    .filter((region) => region.type === 'answer' && region.imagePath)
    .map((region) => region.imagePath as string)
  return {
    ...emptyStudentAttemptInput(problem),
    answerImagePaths,
    // Reuse the same query for the region ids so queueStudentAttempt does not
    // have to fetch all regions a second time.
    answerRegionIds: regions
      .filter((region) => region.type === 'answer')
      .map((region) => region.id),
  }
}

function studentAttemptProviderIdentity() {
  try {
    const provider = getStudentAttemptProvidersForRun('', '')[0]
    return { provider: provider.id, model: provider.model }
  } catch {
    return { provider: 'intelligence-unavailable', model: 'none' }
  }
}

function reasoningProviderIdentity() {
  try {
    const provider = getReasoningProvidersForRun('', '')[0]
    return { provider: provider.id, model: provider.model }
  } catch {
    return { provider: 'intelligence-unavailable', model: 'none' }
  }
}

function createStudentAttemptModelRun(
  problem: SavedProblem,
  input: StudentAttemptInput,
): StudentAttemptModelRun {
  const identity = studentAttemptProviderIdentity()
  return {
    id: crypto.randomUUID(),
    problemId: problem.id,
    taskType: STUDENT_ATTEMPT_TASK_TYPE,
    provider: identity.provider,
    model: identity.model,
    input,
    output: null,
    rawOutput: '',
    repairStrategy: null,
    status: 'pending',
    errorMessage: null,
    createdAt: Date.now(),
  }
}

function createReasoningModelRun(
  problemId: string,
  input: ReasoningAnalysisInput,
): ReasoningModelRun {
  const identity = reasoningProviderIdentity()
  return {
    id: crypto.randomUUID(),
    problemId,
    taskType: REASONING_TASK_TYPE,
    provider: identity.provider,
    model: identity.model,
    input,
    output: null,
    rawOutput: '',
    repairStrategy: null,
    status: 'pending',
    errorMessage: null,
    createdAt: Date.now(),
  }
}

export async function getStudentAttempt(problemId: string): Promise<StudentAttempt> {
  if (!isDesktopRuntime()) return browserStudentAttempts.get(problemId) ?? emptyStudentAttempt(problemId)
  const rows = await (await database()).select<Record<string, unknown>[]>(
    'SELECT * FROM student_attempts WHERE problem_id = $1 LIMIT 1',
    [problemId],
  )
  return rows[0] ? rowToStudentAttempt(rows[0]) : emptyStudentAttempt(problemId)
}

export async function getReasoningAnalysis(problemId: string): Promise<ReasoningAnalysis> {
  if (!isDesktopRuntime()) return browserReasoningAnalyses.get(problemId) ?? emptyReasoningAnalysis(problemId)
  const rows = await (await database()).select<Record<string, unknown>[]>(
    `SELECT * FROM reasoning_analyses WHERE problem_id = $1 ORDER BY updated_at DESC LIMIT 1`,
    [problemId],
  )
  return rows[0] ? rowToReasoningAnalysis(rows[0]) : emptyReasoningAnalysis(problemId)
}

export async function invalidateStudentAttempt(problemId: string) {
  if (!isDesktopRuntime()) {
    browserStudentAttempts.set(problemId, emptyStudentAttempt(problemId))
    return
  }
  await (await database()).execute(
    `UPDATE student_attempts SET status = 'not_started', active_model_run_id = NULL,
      raw_markdown = '', steps_json = '[]', error_message = NULL, updated_at = $1
     WHERE problem_id = $2`,
    [Date.now(), problemId],
  )
  await (await database()).execute(
    `UPDATE reasoning_analyses SET status = 'not_started', active_model_run_id = NULL,
      error_message = NULL, updated_at = $1 WHERE problem_id = $2`,
    [Date.now(), problemId],
  )
}

export async function queueStudentAttempt(problemId: string): Promise<StudentAttempt> {
  if (!isDesktopRuntime()) throw new Error('用户解答识别需要在 Axiom 桌面 App 中运行')
  const problem = await getSavedProblem(problemId)
  if (!problem) throw new Error('错题不存在或状态已发生变化')
  const input = await createStudentAttemptInput(problem)
  if (!input.answerImagePaths.length) {
    await invalidateStudentAttempt(problemId)
    return getStudentAttempt(problemId)
  }
  const db = await database()
  const run = createStudentAttemptModelRun(problem, input)
  const now = Date.now()
  await inDatabaseTransaction(db, async () => {
    await insertIntelligenceModelRun(db, run)
    await db.execute(
      `INSERT INTO student_attempts (
        id, problem_id, answer_region_ids_json, raw_markdown, steps_json,
        status, active_model_run_id, error_message, created_at, updated_at
      ) VALUES ($1, $2, $3, '', '[]', 'pending', $4, NULL, $5, $5)
      ON CONFLICT(problem_id) DO UPDATE SET
        answer_region_ids_json = excluded.answer_region_ids_json,
        status = 'pending', active_model_run_id = excluded.active_model_run_id,
        raw_markdown = '', steps_json = '[]', error_message = NULL, updated_at = excluded.updated_at`,
      [
        crypto.randomUUID(),
        problemId,
        JSON.stringify(input.answerRegionIds),
        run.id,
        now,
      ],
    )
  })
  return getStudentAttempt(problemId)
}

export async function recoverIntelligenceTasks() {
  if (!isDesktopRuntime()) return
  const db = await database()

  const completedStudentRows = await db.select<Record<string, unknown>[]>(
    `SELECT attempt.id AS attempt_id, run.output_json
     FROM student_attempts attempt
     JOIN model_runs run ON run.id = attempt.active_model_run_id
     WHERE attempt.status IN ('pending', 'processing')
       AND run.task_type = $1 AND run.status = 'completed'`,
    [STUDENT_ATTEMPT_TASK_TYPE],
  )
  for (const row of completedStudentRows) {
    const output = parseJSON<Record<string, unknown>>(
      row.output_json,
      {},
      `recover.student_attempts.output_json#${row.attempt_id ?? '?'}`,
    )
    const steps = Array.isArray(output.steps)
      ? output.steps.map((step, index) => {
          const value = step as Record<string, unknown>
          return {
            index: Number(value.index ?? index + 1),
            contentMarkdown: String(value.content_markdown ?? ''),
          }
        })
      : []
    await db.execute(
      `UPDATE student_attempts SET status = 'completed', raw_markdown = $1,
        steps_json = $2, error_message = NULL, updated_at = $3 WHERE id = $4`,
      [
        String(output.raw_markdown ?? ''),
        JSON.stringify(steps),
        Date.now(),
        String(row.attempt_id),
      ],
    )
  }

  const completedReasoningRows = await db.select<Record<string, unknown>[]>(
    `SELECT analysis.id AS analysis_id, run.output_json
     FROM reasoning_analyses analysis
     JOIN model_runs run ON run.id = analysis.active_model_run_id
     WHERE analysis.status IN ('pending', 'processing')
       AND run.task_type = $1 AND run.status = 'completed'`,
    [REASONING_TASK_TYPE],
  )
  for (const row of completedReasoningRows) {
    const output = parseJSON<Record<string, unknown>>(
      row.output_json,
      {},
      `recover.reasoning_analyses.output_json#${row.analysis_id ?? '?'}`,
    )
    const evaluations = Array.isArray(output.step_evaluations)
      ? output.step_evaluations.map((item) => {
          const value = item as Record<string, unknown>
          return {
            studentStepIndex: Number(value.student_step_index ?? 0),
            status: String(value.status ?? 'unclear'),
            comment: String(value.comment ?? ''),
          }
        })
      : []
    await db.execute(
      `UPDATE reasoning_analyses SET status = 'completed', approach = $1,
        step_evaluations_json = $2, first_wrong_step = $3, error_type = $4,
        reason = $5, knowledge_gaps_json = $6, suggestion = $7,
        error_message = NULL, updated_at = $8 WHERE id = $9`,
      [
        output.approach ?? null,
        JSON.stringify(evaluations),
        output.first_wrong_step ?? null,
        output.error_type ?? null,
        output.reason ?? null,
        JSON.stringify(Array.isArray(output.knowledge_gaps) ? output.knowledge_gaps : []),
        output.suggestion ?? null,
        Date.now(),
        String(row.analysis_id),
      ],
    )
  }

  await db.execute(
    `UPDATE student_attempts
     SET status = 'failed',
         error_message = COALESCE((
           SELECT error_message FROM model_runs WHERE id = active_model_run_id
         ), '用户解答任务在上次运行时失败'),
         updated_at = $1
     WHERE status IN ('pending', 'processing')
       AND EXISTS (
         SELECT 1 FROM model_runs run
         WHERE run.id = active_model_run_id
           AND run.task_type = $2 AND run.status = 'failed'
       )`,
    [Date.now(), STUDENT_ATTEMPT_TASK_TYPE],
  )
  await db.execute(
    `UPDATE reasoning_analyses
     SET status = 'failed',
         error_message = COALESCE((
           SELECT error_message FROM model_runs WHERE id = active_model_run_id
         ), '推理分析任务在上次运行时失败'),
         updated_at = $1
     WHERE status IN ('pending', 'processing')
       AND EXISTS (
         SELECT 1 FROM model_runs run
         WHERE run.id = active_model_run_id
           AND run.task_type = $2 AND run.status = 'failed'
       )`,
    [Date.now(), REASONING_TASK_TYPE],
  )

  await db.execute(
    `UPDATE model_runs SET status = 'completed', error_message = NULL
     WHERE status IN ('pending', 'processing') AND task_type = $1
       AND EXISTS (
         SELECT 1 FROM student_attempts attempt
         WHERE attempt.active_model_run_id = model_runs.id
           AND attempt.status = 'completed'
       )`,
    [STUDENT_ATTEMPT_TASK_TYPE],
  )
  await db.execute(
    `UPDATE model_runs SET status = 'completed', error_message = NULL
     WHERE status IN ('pending', 'processing') AND task_type = $1
       AND EXISTS (
         SELECT 1 FROM reasoning_analyses analysis
         WHERE analysis.active_model_run_id = model_runs.id
           AND analysis.status = 'completed'
       )`,
    [REASONING_TASK_TYPE],
  )

  await db.execute(
    `UPDATE model_runs SET status = 'pending', error_message = NULL
     WHERE status IN ('pending', 'processing') AND task_type = $1
       AND EXISTS (
         SELECT 1 FROM student_attempts attempt
         WHERE attempt.active_model_run_id = model_runs.id
           AND attempt.status IN ('pending', 'processing')
       )`,
    [STUDENT_ATTEMPT_TASK_TYPE],
  )
  await db.execute(
    `UPDATE model_runs SET status = 'pending', error_message = NULL
     WHERE status IN ('pending', 'processing') AND task_type = $1
       AND EXISTS (
         SELECT 1 FROM reasoning_analyses analysis
         WHERE analysis.active_model_run_id = model_runs.id
           AND analysis.status IN ('pending', 'processing')
       )`,
    [REASONING_TASK_TYPE],
  )
  await db.execute(
    `UPDATE student_attempts SET status = 'pending', error_message = NULL
     WHERE status = 'processing'`,
  )
  await db.execute(
    `UPDATE reasoning_analyses SET status = 'pending', error_message = NULL
     WHERE status = 'processing'`,
  )
  await db.execute(
    `UPDATE model_runs SET status = 'failed', error_message = $1
     WHERE task_type = $2 AND status IN ('pending', 'processing')`,
    ['应用重启时解释浮层已关闭，请重新选择文字', EXPLAIN_TASK_TYPE],
  )

  await db.execute(
    `UPDATE model_runs SET status = 'failed', error_message = $1
     WHERE task_type IN ($2, $3) AND status IN ('pending', 'processing')
       AND NOT EXISTS (
         SELECT 1 FROM student_attempts attempt
         WHERE attempt.active_model_run_id = model_runs.id
       )
       AND NOT EXISTS (
         SELECT 1 FROM reasoning_analyses analysis
         WHERE analysis.active_model_run_id = model_runs.id
       )`,
    [
      '任务已被更新的运行取代',
      STUDENT_ATTEMPT_TASK_TYPE,
      REASONING_TASK_TYPE,
    ],
  )
}

export async function claimNextStudentAttemptModelRun(): Promise<StudentAttemptModelRun | null> {
  if (!isDesktopRuntime()) return null
  const db = await database()
  const rows = await db.select<Record<string, unknown>[]>(
    `SELECT run.* FROM model_runs run
     JOIN student_attempts attempt ON attempt.active_model_run_id = run.id
     JOIN problems problem ON problem.id = run.problem_id
     WHERE run.task_type = $1 AND run.status = 'pending'
       AND attempt.status = 'pending' AND problem.status = 'saved'
       AND problem.deleted_at IS NULL ORDER BY run.created_at LIMIT 1`,
    [STUDENT_ATTEMPT_TASK_TYPE],
  )
  if (!rows[0]) return null
  const run = rowToStudentAttemptModelRun(rows[0])
  const claimed = await inDatabaseTransaction(db, async () => {
    const runUpdate = await db.execute(
      `UPDATE model_runs SET status = 'processing', error_message = NULL
       WHERE id = $1 AND status = 'pending'`,
      [run.id],
    )
    if (runUpdate.rowsAffected !== 1) return false
    const attemptUpdate = await db.execute(
      `UPDATE student_attempts SET status = 'processing', error_message = NULL, updated_at = $1
       WHERE problem_id = $2 AND active_model_run_id = $3 AND status = 'pending'`,
      [Date.now(), run.problemId, run.id],
    )
    if (attemptUpdate.rowsAffected !== 1) {
      throw new Error('用户解答任务已被更新的运行取代')
    }
    return true
  })
  if (!claimed) return null
  return { ...run, status: 'processing' }
}

export async function completeStudentAttemptModelRun(
  run: StudentAttemptModelRun,
  attempt: Pick<StudentAttempt, 'rawMarkdown' | 'steps'>,
) {
  const db = await database()
  const now = Date.now()
  const output = JSON.stringify({
    raw_markdown: attempt.rawMarkdown,
    steps: attempt.steps.map((step) => ({
      index: step.index,
      content_markdown: step.contentMarkdown,
    })),
  })
  await inDatabaseTransaction(db, async () => {
    const completedRun = await db.execute(
      `UPDATE model_runs SET output_json = $1, status = 'completed', error_message = NULL,
        latency_ms = $2 WHERE id = $3 AND status = 'processing'`,
      [output, Math.max(0, now - run.createdAt), run.id],
    )
    if (completedRun.rowsAffected !== 1) {
      throw new Error('用户解答 Model Run 已不再处于处理中状态')
    }
    const completedAttempt = await db.execute(
      `UPDATE student_attempts SET status = 'completed', raw_markdown = $1,
        steps_json = $2, error_message = NULL, updated_at = $3
       WHERE problem_id = $4 AND active_model_run_id = $5 AND status = 'processing'`,
      [attempt.rawMarkdown, JSON.stringify(attempt.steps), now, run.problemId, run.id],
    )
    if (completedAttempt.rowsAffected !== 1) {
      throw new Error('用户解答任务已被更新的运行取代')
    }
  })
}

export async function failStudentAttemptModelRun(run: StudentAttemptModelRun, error: unknown) {
  const db = await database()
  const now = Date.now()
  const message = String(error).slice(0, 2000)
  await inDatabaseTransaction(db, async () => {
    await db.execute(
      `UPDATE model_runs SET status = 'failed', error_message = $1, latency_ms = $2
       WHERE id = $3 AND status = 'processing'`,
      [message, Math.max(0, now - run.createdAt), run.id],
    )
    await db.execute(
      `UPDATE student_attempts SET status = 'failed', error_message = $1, updated_at = $2
       WHERE problem_id = $3 AND active_model_run_id = $4 AND status = 'processing'`,
      [message, now, run.problemId, run.id],
    )
  })
}

export async function queueReasoningAnalysis(problemId: string): Promise<ReasoningAnalysis> {
  if (!isDesktopRuntime()) throw new Error('推理分析需要在 Axiom 桌面 App 中运行')
  const problem = await getSavedProblem(problemId)
  if (!problem) throw new Error('错题不存在或状态已发生变化')
  const attempt = await getStudentAttempt(problemId)
  if (attempt.status !== 'completed' || !attempt.steps.length) {
    return getReasoningAnalysis(problemId)
  }
  const solution = await getProblemSolution(problemId)
  const input: ReasoningAnalysisInput = {
    problemId,
    cropImagePath: problem.cropImagePath,
    problemContext: [
      problem.stemMarkdown ?? '',
      problem.aiChoices.map((choice) => `${choice.label}. ${choice.text}`).join('\n'),
      problem.aiSubQuestions.map((question) => `${question.index}. ${question.content}`).join('\n'),
    ].filter(Boolean).join('\n'),
    studentAttempt: {
      rawMarkdown: attempt.rawMarkdown,
      steps: attempt.steps,
    },
    solution: solution.status === 'completed' ? solution : null,
    knowledgePoints: problem.knowledgePoints,
  }
  const run = createReasoningModelRun(problemId, input)
  const db = await database()
  const now = Date.now()
  await inDatabaseTransaction(db, async () => {
    await insertIntelligenceModelRun(db, run)
    await db.execute(
      `INSERT INTO reasoning_analyses (
        id, problem_id, student_attempt_id, solution_id, status, active_model_run_id,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, 'pending', $5, $6, $6)
      ON CONFLICT(student_attempt_id) DO UPDATE SET
        solution_id = excluded.solution_id, status = 'pending',
        active_model_run_id = excluded.active_model_run_id, error_message = NULL,
        updated_at = excluded.updated_at`,
      [
        crypto.randomUUID(),
        problemId,
        attempt.id,
        solution.status === 'completed' ? solution.id : null,
        run.id,
        now,
      ],
    )
  })
  return getReasoningAnalysis(problemId)
}

export async function claimNextReasoningModelRun(): Promise<ReasoningModelRun | null> {
  if (!isDesktopRuntime()) return null
  const db = await database()
  const rows = await db.select<Record<string, unknown>[]>(
    `SELECT run.* FROM model_runs run
     JOIN reasoning_analyses analysis ON analysis.active_model_run_id = run.id
     JOIN problems problem ON problem.id = run.problem_id
     WHERE run.task_type = $1 AND run.status = 'pending'
       AND analysis.status = 'pending' AND problem.status = 'saved'
       AND problem.deleted_at IS NULL ORDER BY run.created_at LIMIT 1`,
    [REASONING_TASK_TYPE],
  )
  if (!rows[0]) return null
  const run = rowToReasoningModelRun(rows[0])
  const claimed = await inDatabaseTransaction(db, async () => {
    const runUpdate = await db.execute(
      `UPDATE model_runs SET status = 'processing', error_message = NULL
       WHERE id = $1 AND status = 'pending'`,
      [run.id],
    )
    if (runUpdate.rowsAffected !== 1) return false
    const analysisUpdate = await db.execute(
      `UPDATE reasoning_analyses SET status = 'processing', error_message = NULL, updated_at = $1
       WHERE problem_id = $2 AND active_model_run_id = $3 AND status = 'pending'`,
      [Date.now(), run.problemId, run.id],
    )
    if (analysisUpdate.rowsAffected !== 1) {
      throw new Error('推理分析任务已被更新的运行取代')
    }
    return true
  })
  if (!claimed) return null
  return { ...run, status: 'processing' }
}

export async function completeReasoningModelRun(
  run: ReasoningModelRun,
  analysis: Pick<
    ReasoningAnalysis,
    | 'approach'
    | 'stepEvaluations'
    | 'firstWrongStep'
    | 'errorType'
    | 'reason'
    | 'knowledgeGaps'
    | 'suggestion'
  >,
) {
  const db = await database()
  const now = Date.now()
  const output = JSON.stringify({
    approach: analysis.approach,
    step_evaluations: analysis.stepEvaluations.map((step) => ({
      student_step_index: step.studentStepIndex,
      status: step.status,
      comment: step.comment,
    })),
    first_wrong_step: analysis.firstWrongStep,
    error_type: analysis.errorType,
    reason: analysis.reason,
    knowledge_gaps: analysis.knowledgeGaps,
    suggestion: analysis.suggestion,
  })
  await inDatabaseTransaction(db, async () => {
    const completedRun = await db.execute(
      `UPDATE model_runs SET output_json = $1, status = 'completed', error_message = NULL,
        latency_ms = $2 WHERE id = $3 AND status = 'processing'`,
      [output, Math.max(0, now - run.createdAt), run.id],
    )
    if (completedRun.rowsAffected !== 1) {
      throw new Error('推理分析 Model Run 已不再处于处理中状态')
    }
    const completedAnalysis = await db.execute(
      `UPDATE reasoning_analyses SET status = 'completed', approach = $1,
        step_evaluations_json = $2, first_wrong_step = $3, error_type = $4,
        reason = $5, knowledge_gaps_json = $6, suggestion = $7,
        error_message = NULL, updated_at = $8
       WHERE problem_id = $9 AND active_model_run_id = $10 AND status = 'processing'`,
      [
        analysis.approach,
        JSON.stringify(analysis.stepEvaluations),
        analysis.firstWrongStep,
        analysis.errorType,
        analysis.reason,
        JSON.stringify(analysis.knowledgeGaps),
        analysis.suggestion,
        now,
        run.problemId,
        run.id,
      ],
    )
    if (completedAnalysis.rowsAffected !== 1) {
      throw new Error('推理分析任务已被更新的运行取代')
    }
  })
}

export async function failReasoningModelRun(run: ReasoningModelRun, error: unknown) {
  const db = await database()
  const now = Date.now()
  const message = String(error).slice(0, 2000)
  await inDatabaseTransaction(db, async () => {
    await db.execute(
      `UPDATE model_runs SET status = 'failed', error_message = $1, latency_ms = $2
       WHERE id = $3 AND status = 'processing'`,
      [message, Math.max(0, now - run.createdAt), run.id],
    )
    await db.execute(
      `UPDATE reasoning_analyses SET status = 'failed', error_message = $1, updated_at = $2
       WHERE problem_id = $3 AND active_model_run_id = $4 AND status = 'processing'`,
      [message, now, run.problemId, run.id],
    )
  })
}

function explainProviderIdentity() {
  try {
    const provider = getExplainProvidersForRun('', '')[0]
    return { provider: provider.id, model: provider.model }
  } catch {
    return { provider: 'intelligence-unavailable', model: 'none' }
  }
}

export async function createExplainModelRun(
  input: ExplainSelectionInput,
): Promise<ExplainModelRun> {
  const identity = explainProviderIdentity()
  const run: ExplainModelRun = {
    id: crypto.randomUUID(),
    problemId: input.problemId,
    taskType: EXPLAIN_TASK_TYPE,
    provider: identity.provider,
    model: identity.model,
    input,
    output: null,
    rawOutput: '',
    repairStrategy: null,
    status: 'pending',
    errorMessage: null,
    createdAt: Date.now(),
  }
  if (isDesktopRuntime()) {
    await insertIntelligenceModelRun(await database(), run)
  }
  return run
}

export async function beginExplainModelRun(run: ExplainModelRun) {
  if (!isDesktopRuntime()) return { ...run, status: 'processing' as const }
  const result = await (await database()).execute(
    `UPDATE model_runs SET status = 'processing', error_message = NULL
     WHERE id = $1 AND status = 'pending'`,
    [run.id],
  )
  if (result.rowsAffected !== 1) throw new Error('解释任务已失效，请重新选择文字')
  return { ...run, status: 'processing' as const }
}

export async function completeExplainModelRun(
  run: ExplainModelRun,
  result: ExplainResult,
) {
  if (!isDesktopRuntime()) return
  const now = Date.now()
  await (await database()).execute(
    `UPDATE model_runs SET output_json = $1, status = 'completed', error_message = NULL,
      latency_ms = $2 WHERE id = $3 AND status = 'processing'`,
    [
      JSON.stringify({
        explanation_markdown: result.explanationMarkdown,
        key_point: result.keyPoint,
        related_knowledge_points: result.relatedKnowledgePoints,
      }),
      Math.max(0, now - run.createdAt),
      run.id,
    ],
  )
}

export async function failExplainModelRun(run: ExplainModelRun, error: unknown) {
  if (!isDesktopRuntime()) return
  const now = Date.now()
  await (await database()).execute(
    `UPDATE model_runs SET status = 'failed', error_message = $1, latency_ms = $2
     WHERE id = $3 AND status = 'processing'`,
    [String(error).slice(0, 2000), Math.max(0, now - run.createdAt), run.id],
  )
}

export interface QueuedProblemAI {
  problem: SavedProblem
  modelRunId: string
  created: boolean
}

export async function queueProblemAIWithRun(
  problemId: string,
): Promise<QueuedProblemAI> {
  if (!isDesktopRuntime()) {
    throw new Error('AI Task 需要在 Axiom 桌面 App 中运行')
  }
  const current = await getSavedProblem(problemId)
  if (!current) throw new Error('错题不存在或状态已发生变化')

  const db = await database()
  const run = createAIModelRun(current)
  const now = Date.now()
  let modelRunId = run.id
  let created = false
  await inDatabaseTransaction(db, async () => {
    const activeRuns = await db.select<Array<{ id: string }>>(
      `SELECT mr.id
       FROM model_runs mr
       JOIN problems p ON p.ai_active_model_run_id = mr.id
       WHERE p.id = $1
         AND mr.task_type = $2
         AND mr.status IN ('pending', 'processing')
         AND p.ai_status IN ('pending', 'processing')
       LIMIT 1`,
      [problemId, AI_TASK_TYPE],
    )
    if (activeRuns[0]) {
      // A repeated start signal (including two relabel workers racing after a
      // resume) must reuse the durable run instead of creating a duplicate.
      modelRunId = activeRuns[0].id
      return
    }
    await insertAIModelRuns(db, [run])
    const result = await db.execute(
      `UPDATE problems
       SET ai_status = 'pending',
           ai_active_model_run_id = $1,
           updated_at = $2
      WHERE id = $3
         AND status = 'saved'
         AND deleted_at IS NULL`,
      [run.id, now, problemId],
    )
    if (result.rowsAffected !== 1) {
      throw new Error('错题不存在或状态已发生变化')
    }
    created = true
  })
  const updated = await getSavedProblem(problemId)
  if (!updated) throw new Error('AI Task 已创建，但无法重新读取错题')
  if (!updated.aiActiveModelRunId) {
    throw new Error('AI Task 已创建，但没有可绑定的 ModelRun')
  }
  modelRunId = updated.aiActiveModelRunId
  return { problem: updated, modelRunId, created }
}

export async function queueProblemAI(
  problemId: string,
): Promise<SavedProblem> {
  return (await queueProblemAIWithRun(problemId)).problem
}

export async function cancelProblemAI(problemId: string): Promise<boolean> {
  if (!isDesktopRuntime()) return false
  const db = await database()
  const now = Date.now()
  return inDatabaseTransaction(db, async () => {
    const rows = await db.select<Array<{ id: string; provider: string; model: string }>>(
      `SELECT mr.id, mr.provider, mr.model
       FROM model_runs mr JOIN problems p ON p.ai_active_model_run_id = mr.id
       WHERE p.id = $1 AND mr.task_type = $2
         AND mr.status IN ('pending', 'processing')
       LIMIT 1`,
      [problemId, AI_TASK_TYPE],
    )
    const active = rows[0]
    if (!active) return false
    const error = createAIError('CANCELLED', {
      providerId: active.provider,
      model: active.model,
      runId: active.id,
      occurredAt: now,
      detailSafe: 'stage=user_cancel',
    })
    const cancelled = await db.execute(
      `UPDATE model_runs SET status = 'cancelled', error_message = $1,
       error_code = $2, error_json = $3, latency_ms = MAX(0, $4 - created_at)
       WHERE id = $5 AND status IN ('pending', 'processing')`,
      [publicAIErrorMessage(error), error.code, JSON.stringify(error), now, active.id],
    )
    if (cancelled.rowsAffected !== 1) return false
    await db.execute(
      `UPDATE problems SET ai_status = 'failed', updated_at = $1
       WHERE id = $2 AND ai_active_model_run_id = $3`,
      [now, problemId, active.id],
    )
    return true
  })
}

export async function cancelUnboundProblemAIModelRun(
  problemId: string,
  modelRunId: string,
) {
  if (!isDesktopRuntime()) return
  const db = await database()
  await inDatabaseTransaction(db, async () => {
    const runUpdate = await db.execute(
      `UPDATE model_runs
       SET status = 'cancelled', error_message = '旧错题任务未能绑定批次项目'
       WHERE id = $1 AND problem_id = $2 AND status IN ('pending', 'processing')`,
      [modelRunId, problemId],
    )
    if (runUpdate.rowsAffected !== 1) return
    await db.execute(
      `UPDATE problems
       SET ai_status = 'failed', ai_active_model_run_id = NULL, updated_at = $1
       WHERE id = $2 AND ai_active_model_run_id = $3`,
      [Date.now(), problemId, modelRunId],
    )
  })
}

async function ensurePendingProblemAITasks() {
  const db = await database()
  const rows = await db.select<Record<string, unknown>[]>(
    `SELECT p.id
     FROM problems p
     LEFT JOIN model_runs mr
       ON mr.id = p.ai_active_model_run_id
      AND mr.status IN ('pending', 'processing')
     WHERE p.status = 'saved'
       AND p.deleted_at IS NULL
       AND p.ai_status = 'pending'
       AND mr.id IS NULL`,
  )
  for (const row of rows) {
    await queueProblemAI(String(row.id))
  }
}

export async function recoverProblemAITasks() {
  if (!isDesktopRuntime()) return
  const db = await database()
  await db.execute(
    `UPDATE model_runs
     SET status = 'pending',
         error_message = NULL
     WHERE status = 'processing'
       AND EXISTS (
         SELECT 1
         FROM problems p
         WHERE p.ai_active_model_run_id = model_runs.id
           AND p.ai_status IN ('pending', 'processing')
       )`,
  )
  await db.execute(
    `UPDATE problems
     SET ai_status = 'pending'
     WHERE ai_status = 'processing'
       AND status = 'saved'
       AND deleted_at IS NULL`,
  )
  // Relabel claims live in the Rust single-connection database.  Clear the
  // previous process' claim tokens only after ModelRun recovery has changed
  // processing runs back to pending, so a resumed worker can reuse them.
  await recoverNativeRelabelBatchItems()
  await ensurePendingProblemAITasks()
}

export async function claimNextProblemAIModelRun(): Promise<ModelRun | null> {
  if (!isDesktopRuntime()) return null
  const db = await database()
  const rows = await db.select<Record<string, unknown>[]>(
    `SELECT mr.*
     FROM model_runs mr
     JOIN problems p
       ON p.id = mr.problem_id
      AND p.ai_active_model_run_id = mr.id
     WHERE mr.task_type = $1
       AND mr.status = 'pending'
       AND p.ai_status = 'pending'
       AND p.status = 'saved'
       AND p.deleted_at IS NULL
     ORDER BY mr.created_at
     LIMIT 1`,
    [AI_TASK_TYPE],
  )
  if (!rows[0]) return null
  const run = rowToModelRun(rows[0])
  const claimed = await inDatabaseTransaction(db, async () => {
    const runUpdate = await db.execute(
      `UPDATE model_runs
       SET status = 'processing',
           error_message = NULL
       WHERE id = $1 AND status = 'pending'`,
      [run.id],
    )
    if (runUpdate.rowsAffected !== 1) return false
    const problemUpdate = await db.execute(
      `UPDATE problems
       SET ai_status = 'processing',
           updated_at = $1
       WHERE id = $2
         AND ai_active_model_run_id = $3
         AND ai_status = 'pending'`,
      [Date.now(), run.problemId, run.id],
    )
    if (problemUpdate.rowsAffected !== 1) {
      throw new Error('AI Task 已被更新的运行取代')
    }
    return true
  })
  if (!claimed) return null
  return { ...run, status: 'processing' }
}

export async function completeProblemAIModelRun(
  run: ModelRun,
  analysis: AIProblemAnalysis,
  diagramImagePath: string | null = null,
) {
  const db = await database()
  const now = Date.now()
  const outputJSON = analysisOutputJSON(analysis)
  let previousDiagramImagePath: string | null = null
  // 受控标签映射的只读准备在事务外完成；写入阶段并入下方同一事务。
  // 映射失败将导致整体回滚并向 worker 抛错 → run 落 failed，题目保持
  // 可重试状态，杜绝「completed 但无标签/知识映射」的静默假成功。
  const taxonomyPlan = await prepareControlledProblemAnalysis(
    run.problemId,
    run.id,
    analysis,
  )
  await withTransactionLock(async () => {
    await db.execute('BEGIN')
    try {
      const previousRows = await db.select<Record<string, unknown>[]>(
        `SELECT ai_diagram_image_path
         FROM problems
         WHERE id = $1
           AND ai_active_model_run_id = $2
           AND ai_status = 'processing'
           AND status = 'saved'
           AND deleted_at IS NULL`,
        [run.problemId, run.id],
      )
      if (!previousRows[0]) {
        throw new Error('AI Task 已被更新的运行取代')
      }
      previousDiagramImagePath = nullableString(
        previousRows[0].ai_diagram_image_path,
      )
      const completedRun = await db.execute(
        `UPDATE model_runs
         SET output_json = $1,
             status = 'completed',
             error_message = NULL,
             latency_ms = $2
         WHERE id = $3 AND status = 'processing'`,
        [outputJSON, Math.max(0, now - run.createdAt), run.id],
      )
      if (completedRun.rowsAffected !== 1) {
        throw new Error('AI Task 已不再处于处理中状态')
      }
      if (analysis.subject.trim()) {
        const subjectId = `subject-${crypto.randomUUID()}`
        await db.execute(
          `INSERT INTO subjects(name, id, code, display_name, archived_at, created_at, updated_at)
           VALUES ($1, $2, $3, $1, NULL, $4, $4)
           ON CONFLICT(name) DO UPDATE SET archived_at = NULL, updated_at = excluded.updated_at`,
          [analysis.subject.trim(), subjectId, `axiom-${subjectId.slice(8, 20)}`, now],
        )
      }
      const completedProblem = await db.execute(
        `UPDATE problems
         SET ai_status = 'completed',
             ai_title = $1,
             ai_subject = $2,
             ai_problem_type = $3,
             ai_stem_markdown = $4,
             ai_choices_json = $5,
             ai_sub_questions_json = $6,
             ai_has_diagram = $7,
             ai_diagram_kind = $8,
             ai_diagram_bbox_json = $9,
             ai_diagram_image_path = $10,
             ai_knowledge_points_json = $11,
             ai_confidence = $12,
             ai_warnings_json = $13,
             ai_updated_at = $14,
             updated_at = $14
         WHERE id = $15
           AND ai_active_model_run_id = $16
           AND ai_status = 'processing'
           AND status = 'saved'
           AND deleted_at IS NULL`,
        [
          analysis.title,
          analysis.subject,
          analysis.problemType,
          analysis.stemMarkdown,
          JSON.stringify(analysis.choices),
          JSON.stringify(analysis.subQuestions),
          analysis.hasDiagram ? 1 : 0,
          analysis.hasDiagram ? analysis.diagramKind : null,
          JSON.stringify(analysis.diagramBBox),
          diagramImagePath,
          JSON.stringify(analysis.knowledgePoints),
          null,
          JSON.stringify(analysis.warnings),
          now,
          run.problemId,
          run.id,
        ],
      )
      if (completedProblem.rowsAffected !== 1) {
        throw new Error('错题 AI 状态已变化，旧运行结果未写入')
      }
      const questionRect = run.input.cropRect
      if (analysis.hasDiagram && hasUsableDiagramBounds(analysis.diagramBBox)) {
        const diagramRect = {
          x: questionRect.x + analysis.diagramBBox.x * questionRect.width,
          y: questionRect.y + analysis.diagramBBox.y * questionRect.height,
          width: analysis.diagramBBox.width * questionRect.width,
          height: analysis.diagramBBox.height * questionRect.height,
        }
        await db.execute(
          `INSERT INTO problem_regions (
            id, problem_id, region_type, x, y, width, height, image_path, source, created_at, updated_at
          ) VALUES ($1, $2, 'diagram', $3, $4, $5, $6, $7, 'auto', $8, $8)
          ON CONFLICT(id) DO UPDATE SET
            x = excluded.x, y = excluded.y, width = excluded.width, height = excluded.height,
            image_path = excluded.image_path, updated_at = excluded.updated_at`,
          [
            `ai-diagram-${run.problemId}`,
            run.problemId,
            diagramRect.x,
            diagramRect.y,
            diagramRect.width,
            diagramRect.height,
            diagramImagePath,
            now,
          ],
        )
      } else {
        await db.execute(
          `DELETE FROM problem_regions WHERE id = $1`,
          [`ai-diagram-${run.problemId}`],
        )
      }
      if (taxonomyPlan) {
        await writeControlledProblemAnalysis(taxonomyPlan)
      }
      await db.execute('COMMIT')
    } catch (error) {
      try {
        await db.execute('ROLLBACK')
      } catch {
        try {
          await db.execute('ROLLBACK')
        } catch {
          /* preserve original error */
        }
      }
      throw error
    }
  })
  return previousDiagramImagePath
}

export async function recordProcessingModelRunOutput(
  run: { id: string; provider: string; model: string },
  rawOutput: string,
  repairStrategy: string | null,
  errorInput: string | AIErrorEnvelope | null = null,
  usageInput: AIUsageMetrics | null = null,
) {
  const db = await database()
  // 读改写必须原子：SELECT provider_attempts_json → JS 追加 → UPDATE。
  // 若无事务包裹，两个并发 worker 会基于同一旧快照各自追加，先提交者的
  // attempt 记录被后提交者整体覆盖丢失。事务锁保证串行化。
  await inDatabaseTransaction(db, async () => {
    const rows = await db.select<Record<string, unknown>[]>(
      `SELECT mr.provider_attempts_json,
              profile.input_cost_per_million_usd,
              profile.output_cost_per_million_usd
       FROM model_runs mr
       LEFT JOIN ai_provider_profiles profile ON profile.id = $2
       WHERE mr.id = $1 LIMIT 1`,
      [run.id, run.provider],
    )
    const attempts = parseJSON<Array<Record<string, unknown>>>(
      rows[0]?.provider_attempts_json,
      [],
      `model_runs.provider_attempts_json#${run.id}`,
    )
    const attemptId = crypto.randomUUID()
    const recordedAt = Date.now()
    const nonNegativeInteger = (value: number | null | undefined) =>
      Number.isInteger(value) && Number(value) >= 0 ? Number(value) : null
    const usage = usageInput == null ? null : {
      promptTokens: nonNegativeInteger(usageInput.promptTokens),
      completionTokens: nonNegativeInteger(usageInput.completionTokens),
      totalTokens: nonNegativeInteger(usageInput.totalTokens),
    }
    const inputPrice = rows[0]?.input_cost_per_million_usd == null
      ? null
      : Number(rows[0].input_cost_per_million_usd)
    const outputPrice = rows[0]?.output_cost_per_million_usd == null
      ? null
      : Number(rows[0].output_cost_per_million_usd)
    const estimatedCostUsd = usage?.promptTokens != null
      && usage.completionTokens != null
      && inputPrice != null
      && outputPrice != null
      ? (usage.promptTokens * inputPrice + usage.completionTokens * outputPrice) / 1_000_000
      : null
    const error = errorInput == null ? null : classifyAIError(errorInput, {
      providerId: run.provider,
      model: run.model,
      runId: run.id,
      attemptId,
    })
    const errorMessage = errorInput == null
      ? null
      : redactAIError(isAIErrorEnvelope(errorInput) ? errorInput.detailSafe ?? errorInput.userMessage : errorInput)
    attempts.push({
      id: attemptId,
      provider: run.provider,
      model: run.model,
      rawOutput: rawOutput.slice(0, 128 * 1024),
      repairStrategy,
      errorMessage,
      error,
      usage,
      estimatedCostUsd,
      recordedAt,
    })
    const retainedAttempts = attempts.slice(-12)
    const result = await db.execute(
      `UPDATE model_runs
       SET raw_output = $1,
           repair_strategy = $2,
           provider_attempts_json = $3,
           prompt_tokens = CASE WHEN $4 IS NULL THEN prompt_tokens ELSE COALESCE(prompt_tokens, 0) + $4 END,
           completion_tokens = CASE WHEN $5 IS NULL THEN completion_tokens ELSE COALESCE(completion_tokens, 0) + $5 END,
           token_usage = CASE WHEN $6 IS NULL THEN token_usage ELSE COALESCE(token_usage, 0) + $6 END,
           estimated_cost_usd = CASE WHEN $7 IS NULL THEN estimated_cost_usd ELSE COALESCE(estimated_cost_usd, 0) + $7 END
       WHERE id = $8 AND status = 'processing'`,
      [
        rawOutput.slice(0, 2 * 1024 * 1024),
        repairStrategy,
        JSON.stringify(retainedAttempts),
        usage?.promptTokens ?? null,
        usage?.completionTokens ?? null,
        usage?.totalTokens ?? null,
        estimatedCostUsd,
        run.id,
      ],
    )
    if (result.rowsAffected !== 1) {
      throw new Error('无法保存模型原始输出：AI Task 已不再处于处理中状态')
    }
    await db.execute(
      `INSERT INTO provider_attempts (
        id, model_run_id, attempt_index, provider, model, status, error_code,
        error_json, raw_output_excerpt, repair_strategy, started_at, completed_at,
        prompt_tokens, completion_tokens, token_usage, estimated_cost_usd
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11, $12, $13, $14, $15)`,
      [
        attemptId, run.id, attempts.length, run.provider, run.model,
        error ? (error.code === 'CANCELLED' ? 'cancelled' : 'failed') : 'completed',
        error?.code ?? null, error ? JSON.stringify(error) : null,
        rawOutput.slice(0, 128 * 1024), repairStrategy, recordedAt,
        usage?.promptTokens ?? null, usage?.completionTokens ?? null,
        usage?.totalTokens ?? null, estimatedCostUsd,
      ],
    )
  })
}

export async function failProblemAIModelRun(
  run: ModelRun,
  error: unknown,
) {
  const db = await database()
  const now = Date.now()
  const envelope = classifyAIError(error, {
    providerId: run.provider,
    model: run.model,
    runId: run.id,
  })
  const message = publicAIErrorMessage(envelope).slice(0, 2000)
  await inDatabaseTransaction(db, async () => {
    await db.execute(
      `UPDATE model_runs
       SET status = 'failed',
           error_message = $1,
           error_code = $2,
           error_json = $3,
           latency_ms = $4
       WHERE id = $5 AND status = 'processing'`,
      [message, envelope.code, JSON.stringify(envelope), Math.max(0, now - run.createdAt), run.id],
    )
    await db.execute(
      `UPDATE problems
       SET ai_status = 'failed',
           updated_at = $1
       WHERE id = $2
         AND ai_active_model_run_id = $3
         AND ai_status = 'processing'
         AND status = 'saved'
         AND deleted_at IS NULL`,
      [now, run.problemId, run.id],
    )
  })
}

export async function updateProcessingModelRunProvider<
  T extends
    | ModelRun
    | SolutionModelRun
    | StudentAttemptModelRun
    | ReasoningModelRun
    | ExplainModelRun,
>(
  run: T,
  provider: string,
  model: string,
): Promise<T> {
  const result = await (await database()).execute(
    `UPDATE model_runs
     SET provider = $1,
         model = $2
     WHERE id = $3 AND status = 'processing'`,
    [provider, model, run.id],
  )
  if (result.rowsAffected !== 1) {
    throw new Error('AI Task 已不再处于处理中状态')
  }
  return { ...run, provider, model }
}

export async function listProblemModelRuns(
  problemId: string,
): Promise<ModelRun[]> {
  if (!isDesktopRuntime()) return []
  // 覆盖该题的全部任务类型：解答/作答分析/推理等调用的 token 用量与
  // 成本同样落库，用户应能在 Model Run 历史里看到完整开销。
  const rows = await (await database()).select<Record<string, unknown>[]>(
    `SELECT *
     FROM model_runs
     WHERE problem_id = $1
     ORDER BY created_at DESC`,
    [problemId],
  )
  return rows.map(rowToModelRun)
}

export const SUBJECT_CHANGE_REQUIRES_TEXTBOOK_UNLOCK = 'SUBJECT_CHANGE_REQUIRES_TEXTBOOK_UNLOCK'

export class ProblemSubjectChangeConflict extends Error {
  readonly code = SUBJECT_CHANGE_REQUIRES_TEXTBOOK_UNLOCK

  constructor() {
    super('更改科目后，Axiom 会按新科目重新整理本题标签，是否继续？')
    this.name = 'ProblemSubjectChangeConflict'
  }
}

export class ProblemSubjectChangeTagConflict extends Error {
  constructor() {
    super('当前题目仍有原科目标签。修改科目前请先处理这些标签，题目数据未改变。')
    this.name = 'ProblemSubjectChangeTagConflict'
  }
}

function normalizedSubjectKey(value: string | null | undefined) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    .replace(/[\s\u3000]+/gu, '')
}

function effectiveSubjectForEdit(
  userSubject: string,
  aiSubject: string | null | undefined,
  legacySubject: string | null | undefined,
) {
  return userSubject.trim() || String(aiSubject ?? '').trim() || String(legacySubject ?? '').trim()
}

export async function updateProblemUserFields(
  id: string,
  edits: ProblemUserEdits,
  options: { confirmTextbookReset?: boolean } = {},
): Promise<SavedProblem> {
  if (!isDesktopRuntime()) {
    throw new Error('错题编辑需要在 Axiom 桌面 App 中运行')
  }
  const title = edits.title.trim()
  if (!title) {
    throw new Error('标题不能为空')
  }
  const current = await getSavedProblem(id)
  if (!current) throw new Error('错题不存在或状态已发生变化')
  const subject = edits.subject.trim()
  const stemMarkdown = edits.stemMarkdown.trim()
  const knowledgePoints = edits.knowledgePoints
    .map((point) => point.trim())
    .filter(Boolean)
  let solutionInputChanged = false
  const now = Date.now()
  const db = await database()
  await inDatabaseTransaction(db, async () => {
    const rows = await db.select<Array<{
      subject: string | null
      user_subject: string | null
      ai_subject: string | null
      user_stem_markdown: string | null
      user_knowledge_points_json: string | null
      matched_textbook_id: string | null
      textbook_match_locked: number
    }>>(
      `SELECT subject, user_subject, ai_subject, user_stem_markdown,
              user_knowledge_points_json, matched_textbook_id, textbook_match_locked
       FROM problems
       WHERE id = $1 AND status = 'saved' AND deleted_at IS NULL
       LIMIT 1`,
      [id],
    )
    const row = rows[0]
    if (!row) throw new Error('错题不存在或状态已发生变化')
    const previousSubject = effectiveSubjectForEdit(
      String(row.user_subject ?? ''), row.ai_subject, row.subject,
    )
    const nextSubject = effectiveSubjectForEdit(subject, row.ai_subject, row.subject)
    const subjectChanged = normalizedSubjectKey(previousSubject) !== normalizedSubjectKey(nextSubject)
    const activeTagRows = await db.select<Array<{ subject: string }>>(
      `SELECT subject FROM problem_tags
       WHERE problem_id = $1 AND superseded_at IS NULL`,
      [id],
    )
    const hasCrossSubjectActiveTags = activeTagRows.some((tag) =>
      normalizedSubjectKey(tag.subject) !== normalizedSubjectKey(nextSubject),
    )
    if (subjectChanged && hasCrossSubjectActiveTags) {
      throw new ProblemSubjectChangeTagConflict()
    }
    if (subjectChanged && row.matched_textbook_id && Number(row.textbook_match_locked) === 1 && !options.confirmTextbookReset) {
      throw new ProblemSubjectChangeConflict()
    }
    // SQLite's historical tag trigger compares trimmed strings.  Reuse the
    // active tag spelling when the semantic subject is unchanged so harmless
    // whitespace/case edits cannot trip that integrity guard.
    const subjectForStorage = activeTagRows[0]?.subject && !hasCrossSubjectActiveTags
      ? activeTagRows[0].subject
      : subject
    const previousStemMarkdown = row.user_stem_markdown ?? current.stemMarkdown ?? ''
    const previousKnowledgePoints = row.user_knowledge_points_json == null
      ? current.knowledgePoints
      : parseJSON<string[]>(row.user_knowledge_points_json, [])
    solutionInputChanged = subjectChanged ||
      stemMarkdown !== previousStemMarkdown ||
      JSON.stringify(knowledgePoints) !== JSON.stringify(previousKnowledgePoints)

    if (nextSubject) {
      const subjectId = `subject-${crypto.randomUUID()}`
      await db.execute(
        `INSERT INTO subjects(name, id, code, display_name, archived_at, created_at, updated_at)
         VALUES ($1, $2, $3, $1, NULL, $4, $4)
         ON CONFLICT(name) DO UPDATE SET archived_at = NULL, updated_at = excluded.updated_at`,
        [nextSubject, subjectId, `axiom-${subjectId.slice(8, 20)}`, now],
      )
    }

    const result = await db.execute(
      `UPDATE problems
       SET user_title = $1,
           user_subject = $2,
           user_stem_markdown = $3,
           user_knowledge_points_json = $4,
           matched_textbook_id = CASE WHEN $6 = 1 THEN NULL ELSE matched_textbook_id END,
           textbook_match_confidence = CASE WHEN $6 = 1 THEN 0 ELSE textbook_match_confidence END,
           textbook_match_reason = CASE WHEN $6 = 1 THEN '科目变化，等待重新识别' ELSE textbook_match_reason END,
           textbook_match_source = CASE WHEN $6 = 1 THEN 'unresolved' ELSE textbook_match_source END,
           textbook_match_locked = CASE WHEN $6 = 1 THEN 0 ELSE textbook_match_locked END,
           textbook_match_updated_at = CASE WHEN $6 = 1 THEN $5 ELSE textbook_match_updated_at END,
           user_edited_at = $5,
           updated_at = $5
       WHERE id = $7 AND status = 'saved' AND deleted_at IS NULL`,
      [
        title,
        subjectForStorage,
        stemMarkdown,
        JSON.stringify(knowledgePoints),
        now,
        subjectChanged ? 1 : 0,
        id,
      ],
    )
    if (result.rowsAffected !== 1) throw new Error('错题不存在或状态已发生变化')
  })
  const updated = await getSavedProblem(id)
  if (!updated) {
    throw new Error('修改已写入，但无法重新读取错题')
  }
  if (solutionInputChanged) {
    try {
      await queueProblemSolution(id)
    } catch (error) {
      await markProblemSolutionFailed(id, error)
    }
  }
  return updated
}

export async function replaceProblemCrop(
  id: string,
  rect: Problem['cropRect'],
): Promise<SavedProblem> {
  if (!isDesktopRuntime()) {
    throw new Error('错题重新裁剪需要在 Axiom 桌面 App 中运行')
  }
  if (!isValidNormalizedRect(rect)) {
    throw new Error('新的裁剪区域无效')
  }

  const current = await getSavedProblem(id)
  if (!current) {
    throw new Error('错题不存在或状态已发生变化')
  }
  if (!current.correctedImagePath) {
    throw new Error('优化后的完整页面不存在，无法重新裁剪')
  }

  const image = await cropProblemImage(
    current.id,
    current.correctedImagePath,
    rect,
  )
  const now = Date.now()
  let result
  try {
    result = await (await database()).execute(
      `UPDATE problems
       SET crop_x = $1,
           crop_y = $2,
           crop_width = $3,
           crop_height = $4,
           crop_image_path = $5,
           updated_at = $6
       WHERE id = $7
         AND status = 'saved'
         AND deleted_at IS NULL
         AND crop_image_path = $8`,
      [
        rect.x,
        rect.y,
        rect.width,
        rect.height,
        image.path,
        now,
        current.id,
        current.cropImagePath,
      ],
    )
  } catch (error) {
    await cleanupCreatedProblemImages([image])
    throw new Error(`数据库写入失败：${String(error)}`)
  }

  if (result.rowsAffected !== 1) {
    await cleanupCreatedProblemImages([image])
    throw new Error('错题已在其他位置发生变化，旧裁图仍然保留')
  }

  const updated = await getSavedProblem(id)
  if (!updated) {
    throw new Error('新裁图已保存，但无法重新读取错题，请重启 App 后检查')
  }
  await invalidateProblemSolution(id)

  try {
    await removeProblemImage(current.cropImagePath)
  } catch {
    // The database already points to the new image. A stale old file is safer
    // than reporting the successful recrop as a failure.
  }
  return updated
}

export async function replaceProblemRegions(
  id: string,
  regions: ProblemRegion[],
): Promise<SavedProblem> {
  if (!isDesktopRuntime()) {
    throw new Error('错题区域编辑需要在 Axiom 桌面 App 中运行')
  }
  const current = await getSavedProblem(id)
  if (!current) throw new Error('错题不存在或状态已发生变化')
  if (!current.correctedImagePath) throw new Error('优化后的完整页面不存在，无法保存区域')
  const preparedRegions = regions.map((region) => ({ ...region, rect: { ...region.rect } }))
  const question = preparedRegions.find((region) => region.type === 'question')
  if (!question) throw new Error('必须保留题目区域')
  preparedRegions.forEach((region) => validateProblemRegion(region))

  const oldRegions = await getProblemRegions(id)
  const regionTypeChanged = (type: ProblemRegionType) => {
    const previous = oldRegions.filter((region) => region.type === type)
    const next = preparedRegions.filter((region) => region.type === type)
    return (
      previous.length !== next.length ||
      previous.some((region) => {
        const replacement = next.find((candidate) => candidate.id === region.id)
        return !replacement || !isSameCropRect(region.rect, replacement.rect)
      })
    )
  }
  const questionChanged = regionTypeChanged('question')
  const answerChanged = regionTypeChanged('answer')
  const diagramChanged = regionTypeChanged('diagram')
  const images: PersistedProblemImage[] = []
  const now = Date.now()
  try {
    for (const region of preparedRegions) {
      const image = await cropProblemImage(
        region.type === 'question' ? id : `${id}-${region.type}-${region.id}`,
        current.correctedImagePath,
        region.rect,
      )
      images.push(image)
      region.imagePath = image.path
      region.createdAt ||= now
      region.updatedAt = now
    }
    const db = await database()
    await withTransactionLock(async () => {
      await db.execute('BEGIN')
      try {
        const updated = await db.execute(
          `UPDATE problems SET crop_x = $1, crop_y = $2, crop_width = $3,
            crop_height = $4, crop_image_path = $5, updated_at = $6
           WHERE id = $7 AND status = 'saved' AND deleted_at IS NULL`,
          [
            question.rect.x,
            question.rect.y,
            question.rect.width,
            question.rect.height,
            question.imagePath,
            now,
            id,
          ],
        )
        if (updated.rowsAffected !== 1) throw new Error('错题状态已发生变化')
        await db.execute('DELETE FROM problem_regions WHERE problem_id = $1', [id])
        for (const region of preparedRegions) {
          await db.execute(
            `INSERT INTO problem_regions (
              id, problem_id, region_type, x, y, width, height, image_path, source, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [
              region.id,
              id,
              region.type,
              region.rect.x,
              region.rect.y,
              region.rect.width,
              region.rect.height,
              region.imagePath,
              region.source,
              region.createdAt,
              region.updatedAt,
            ],
          )
        }
        await db.execute('COMMIT')
      } catch (error) {
        try {
          await db.execute('ROLLBACK')
        } catch {
          try {
            await db.execute('ROLLBACK')
          } catch {
            /* preserve original error */
          }
        }
        throw error
      }
    })
  } catch (error) {
    await cleanupCreatedProblemImages(images)
    throw new Error(`区域保存失败：${String(error)}`)
  }
  if (questionChanged || diagramChanged) {
    await invalidateProblemSolution(id)
  }
  if (questionChanged || answerChanged || diagramChanged) {
    await invalidateStudentAttempt(id)
  }
  const updated = await getSavedProblem(id)
  if (!updated) throw new Error('区域已保存，但无法重新读取错题')
  const oldPaths = oldRegions
    .map((region) => region.imagePath)
    .filter((path): path is string => Boolean(path))
    .filter((path) => !preparedRegions.some((region) => region.imagePath === path))
  await Promise.allSettled(oldPaths.map((path) => removeProblemImage(path)))
  return updated
}

export async function setProblemArchived(id: string, archived: boolean) {
  if (!isDesktopRuntime()) return
  const result = await (await database()).execute(
    `UPDATE problems
     SET archived_at = $1, updated_at = $2
     WHERE id = $3 AND status = 'saved' AND deleted_at IS NULL`,
    [archived ? Date.now() : null, Date.now(), id],
  )
  if (result.rowsAffected !== 1) {
    throw new Error('错题不存在或状态已发生变化')
  }
}

export async function setProblemFavorite(id: string, favorite: boolean) {
  if (!isDesktopRuntime()) throw new Error('收藏需要在 Axiom 桌面 App 中运行')
  const now = Date.now()
  await (await database()).execute(
    `INSERT INTO problem_library_profiles(problem_id,is_favorite,note,updated_at)
     VALUES ($1,$2,'',$3)
     ON CONFLICT(problem_id) DO UPDATE SET
       is_favorite=excluded.is_favorite, updated_at=excluded.updated_at`,
    [id, favorite ? 1 : 0, now],
  )
  const updated = await getSavedProblem(id)
  if (!updated) throw new Error('收藏状态已保存，但无法重新读取错题')
  return updated
}

export async function saveProblemNote(id: string, note: string) {
  if (!isDesktopRuntime()) throw new Error('备注需要在 Axiom 桌面 App 中运行')
  if (note.length > 20_000) throw new Error('备注不能超过 20000 个字符')
  const now = Date.now()
  await (await database()).execute(
    `INSERT INTO problem_library_profiles(problem_id,is_favorite,note,updated_at)
     VALUES ($1,0,$2,$3)
     ON CONFLICT(problem_id) DO UPDATE SET
       note=excluded.note, updated_at=excluded.updated_at`,
    [id, note, now],
  )
  const updated = await getSavedProblem(id)
  if (!updated) throw new Error('备注已保存，但无法重新读取错题')
  return updated
}

export interface ProblemDuplicateDecision {
  candidateProblemId: string
  decision: 'keep_both' | 'merged'
}

export async function listProblemDuplicateDecisions(
  problemId: string,
): Promise<ProblemDuplicateDecision[]> {
  if (!isDesktopRuntime()) return []
  const rows = await (await database()).select<Array<{
    first_problem_id: string
    second_problem_id: string
    decision: ProblemDuplicateDecision['decision']
  }>>(
    `SELECT first_problem_id,second_problem_id,decision
     FROM problem_duplicate_decisions
     WHERE first_problem_id=$1 OR second_problem_id=$1`,
    [problemId],
  )
  return rows.map((row) => ({
    candidateProblemId: row.first_problem_id === problemId
      ? row.second_problem_id
      : row.first_problem_id,
    decision: row.decision,
  }))
}

export async function decideProblemDuplicate(input: {
  problemId: string
  candidateProblemId: string
  decision: ProblemDuplicateDecision['decision']
  similarityScore: number
  signals: string[]
}) {
  if (!isDesktopRuntime()) throw new Error('重复题处理需要在 Axiom 桌面 App 中运行')
  if (input.problemId === input.candidateProblemId) throw new Error('不能把同一道题标记为重复')
  if (!Number.isFinite(input.similarityScore) || input.similarityScore < 0 || input.similarityScore > 1) {
    throw new Error('重复题相似度无效')
  }
  const db = await database()
  const [firstProblemId, secondProblemId] = [input.problemId, input.candidateProblemId].sort()
  const rows = await db.select<Array<{ id: string; subject: string | null }>>(
    `SELECT id,COALESCE(NULLIF(user_subject,''),NULLIF(ai_subject,''),subject) AS subject
     FROM problems WHERE id IN ($1,$2) AND status='saved' AND deleted_at IS NULL`,
    [firstProblemId, secondProblemId],
  )
  if (rows.length !== 2) throw new Error('重复题候选已不存在或状态已变化')
  // Compare with the same normalization the duplicate-suggestion scan uses
  // (NFKC + casefold + whitespace collapse); a plain trim() would reject
  // merges across full-width/case subject variants that the UI offered.
  const subjects = rows.map((row) => normalizedSubjectKey(row.subject))
  if (subjects.some((subject) => !subject) || subjects[0] !== subjects[1]) {
    throw new Error('只能处理同一科目的重复题')
  }
  const now = Date.now()
  await inDatabaseTransaction(db, async () => {
    await db.execute(
      `INSERT INTO problem_duplicate_decisions(
         first_problem_id,second_problem_id,decision,canonical_problem_id,
         similarity_score,signals_json,created_at,updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$7)
       ON CONFLICT(first_problem_id,second_problem_id) DO UPDATE SET
         decision=excluded.decision,canonical_problem_id=excluded.canonical_problem_id,
         similarity_score=excluded.similarity_score,signals_json=excluded.signals_json,
         updated_at=excluded.updated_at`,
      [
        firstProblemId,
        secondProblemId,
        input.decision,
        input.decision === 'merged' ? input.problemId : null,
        input.similarityScore,
        JSON.stringify(input.signals.slice(0, 12)),
        now,
      ],
    )
    if (input.decision === 'merged') {
      const archived = await db.execute(
        `UPDATE problems SET archived_at=$1,updated_at=$1
         WHERE id=$2 AND status='saved' AND deleted_at IS NULL`,
        [now, input.candidateProblemId],
      )
      if (archived.rowsAffected !== 1) throw new Error('重复项状态已变化，无法归档')
    }
  })
}

const defaultAIProviderProfiles: AIProviderProfile[] = [{
  id: 'mock-default',
  name: 'Mock Provider',
  provider: 'mock',
  baseUrl: '',
  apiKey: '',
  hasApiKey: false,
  apiKeySuffix: '',
  credentialRef: '',
  commandPath: '',
  model: 'mock-vision-v1',
  inputCostPerMillionUsd: null,
  outputCostPerMillionUsd: null,
  supportsVision: true,
  supportsText: true,
  taskTypes: [],
  enabled: true,
  sortOrder: 0,
  createdAt: 0,
  updatedAt: 0,
}]

function rowToAIProviderProfile(
  row: Record<string, unknown>,
): AIProviderProfile {
  return {
    id: String(row.id),
    name: String(row.name || '未命名 Provider'),
    provider:
      row.provider === 'openai_compatible'
        ? 'openai_compatible'
        : row.provider === 'antigravity_cli'
          ? 'antigravity_cli'
        : 'mock',
    baseUrl: String(row.base_url || ''),
    // The full database key is intentionally not selected into React.  Only a
    // boolean and its final four characters are safe to render.
    apiKey: '',
    hasApiKey: parseSQLiteBoolean(row.has_api_key),
    apiKeySuffix: String(row.api_key_suffix || ''),
    credentialRef: String(row.credential_ref || ''),
    commandPath: String(row.command_path || ''),
    model: String(row.model || ''),
    inputCostPerMillionUsd: row.input_cost_per_million_usd == null
      ? null
      : Number(row.input_cost_per_million_usd),
    outputCostPerMillionUsd: row.output_cost_per_million_usd == null
      ? null
      : Number(row.output_cost_per_million_usd),
    supportsVision: parseSQLiteBoolean(row.supports_vision),
    supportsText: parseSQLiteBoolean(row.supports_text),
    taskTypes: parseJSON<AIProviderProfile['taskTypes']>(
      row.task_types_json,
      [],
      `ai_provider_profiles.task_types_json#${String(row.id)}`,
    ),
    enabled: parseSQLiteBoolean(row.enabled),
    sortOrder: Number(row.sort_order || 0),
    createdAt: Number(row.created_at || 0),
    updatedAt: Number(row.updated_at || 0),
  }
}

export async function listAIProviderProfiles(): Promise<AIProviderProfile[]> {
  if (!isDesktopRuntime()) return defaultAIProviderProfiles
  const rows = await (await database()).select<Record<string, unknown>[]>(
    `SELECT id, name, provider, base_url, credential_ref, command_path, model,
       input_cost_per_million_usd, output_cost_per_million_usd,
       supports_vision, supports_text, task_types_json, enabled, sort_order, created_at, updated_at,
       CAST(CASE WHEN trim(api_key) != '' THEN 1 ELSE 0 END AS INTEGER) AS has_api_key,
       CASE
         WHEN length(trim(api_key)) > 4 THEN substr(trim(api_key), -4)
         ELSE ''
       END AS api_key_suffix
     FROM ai_provider_profiles
     ORDER BY sort_order, created_at`,
  )
  return rows.map(rowToAIProviderProfile)
}

/**
 * Verifies only safe native save metadata for keys entered in this edit.
 * The full secret remains in SQLite and never participates in this check.
 */
export function assertAIProviderKeySaveStatuses(
  profiles: ReadonlyArray<Pick<AIProviderProfile, 'id' | 'name' | 'apiKey'>>,
  statuses: ReadonlyArray<Pick<AIProviderProfile, 'id' | 'hasApiKey'>>,
) {
  for (const profile of profiles.filter((candidate) => candidate.apiKey)) {
    const status = statuses.find((candidate) => candidate.id === profile.id)
    if (!status?.hasApiKey) {
      throw new Error(`“${profile.name || profile.id}”的 API Key 保存事务校验失败`)
    }
  }
}

export async function saveAIProviderProfiles(
  profiles: AIProviderProfile[],
): Promise<AIProviderProfile[]> {
  if (!isDesktopRuntime()) {
    throw new Error('AI Provider 设置需要在 Axiom 桌面 App 中保存')
  }
  if (new Set(profiles.map((profile) => profile.id)).size !== profiles.length) {
    throw new Error('Provider ID 不能重复')
  }
  for (const profile of profiles) {
    if (!profile.name.trim()) throw new Error('Provider 名称不能为空')
    if (
      profile.provider === 'openai_compatible' &&
      profile.enabled &&
      (!profile.baseUrl.trim() || !profile.model.trim())
    ) {
      throw new Error(`“${profile.name}”启用前请填写 Base URL 和 Model`)
    }
    if (
      profile.provider === 'openai_compatible' &&
      profile.enabled &&
      !profile.apiKey.trim() &&
      !profile.hasApiKey
    ) {
      throw new Error(`“${profile.name}”启用前请保存 API Key`)
    }
    if (
      profile.provider === 'antigravity_cli' &&
      profile.enabled &&
      (!profile.commandPath.trim() || !profile.model.trim())
    ) {
      throw new Error(`“${profile.name}”启用前请填写 CLI 路径和 Model`)
    }
    for (const price of [profile.inputCostPerMillionUsd, profile.outputCostPerMillionUsd]) {
      if (price != null && (!Number.isFinite(price) || price < 0)) {
        throw new Error(`“${profile.name}”的 Token 单价必须是非负数字`)
      }
    }
  }
  const now = Date.now()
  const normalized = profiles.map((profile, sortOrder) => ({
    ...profile,
    name: profile.name.trim(),
    baseUrl: profile.baseUrl.trim(),
    apiKey: profile.apiKey.trim(),
    hasApiKey: profile.hasApiKey,
    apiKeySuffix: profile.apiKeySuffix,
    credentialRef:
      profile.provider === 'openai_compatible'
        ? profile.credentialRef.trim()
        : '',
    commandPath: profile.commandPath.trim(),
    model:
      profile.provider === 'mock'
        ? 'mock-vision-v1'
        : profile.model.trim(),
    taskTypes: [...new Set(profile.taskTypes ?? [])],
    sortOrder,
    createdAt: profile.createdAt || now,
    updatedAt: now,
  }))
  if (normalized.some((profile) => profile.apiKey.includes('••'))) {
    throw new Error('API Key 输入框只能填写真实的新 Key，不能保存掩码文本')
  }
  const saveStatuses = await persistAIProviderProfiles(normalized)
  const newlyEnteredKeyIds = new Set(
    normalized
      .filter((profile) => profile.apiKey)
      .map((profile) => profile.id),
  )
  assertAIProviderKeySaveStatuses(normalized, saveStatuses)
  const saved = await listAIProviderProfiles()
  for (const profile of normalized.filter((candidate) => newlyEnteredKeyIds.has(candidate.id))) {
    if (!saved.find((candidate) => candidate.id === profile.id)?.hasApiKey) {
      throw new Error(`“${profile.name}”的 API Key 保存后校验失败`)
    }
  }
  return saved
}

/** Explicit deletion is intentionally separate from normal Settings save. */
export async function deleteAIProviderProfileApiKey(
  providerId: string,
): Promise<AIProviderProfile[]> {
  if (!isDesktopRuntime()) {
    throw new Error('AI Provider 设置需要在 Axiom 桌面 App 中保存')
  }
  await deleteAIProviderApiKey(providerId)
  const profiles = await listAIProviderProfiles()
  if (profiles.find((profile) => profile.id === providerId)?.hasApiKey) {
    throw new Error('API Key 删除后校验失败')
  }
  return profiles
}

/** 将错题移入可恢复的回收站。ReviewLog、Evidence、模型运行和媒体均保留。 */
export async function deleteProblem(problemId: string): Promise<void> {
  if (!isDesktopRuntime()) {
    throw new Error('错题删除需要在 Axiom 桌面 App 中运行')
  }
  const db = await database()
  await db.execute(`UPDATE problems SET deleted_at=$1,archived_at=NULL,updated_at=$1
    WHERE id=$2 AND status='saved' AND deleted_at IS NULL`, [Date.now(), problemId])
}

export async function restoreProblem(problemId: string): Promise<void> {
  if (!isDesktopRuntime()) throw new Error('错题恢复需要在 Axiom 桌面 App 中运行')
  await (await database()).execute(`UPDATE problems SET deleted_at=NULL,updated_at=$1
    WHERE id=$2 AND status='saved' AND deleted_at IS NOT NULL`, [Date.now(), problemId])
}

/**
 * 扫描磁盘上的 media 目录，识别未被任何数据库行引用的孤立图片。
 *
 * 设计原则：
 *   - 只读扫描，不直接删除；调用方基于返回结果决定是否删除
 *   - 通过数据库引用表全量扫描，避免漏判
 *   - 任何无法解析路径的文件视为「无法判断」，跳过不删除
 *   - 返回的孤立文件按目录分组，便于调用方选择性清理
 *
 * 引用来源（不可删除）：
 *   - source_documents.original_image_path / corrected_image_path
 *   - problems.crop_image_path / ai_diagram_image_path
 *   - problem_regions.image_path
 *   - practice_attempt_pages.source_asset_path / corrected_asset_path
 *   - practice_responses.answer_asset_path
 */
export interface OrphanedMediaReport {
  /** media/original 目录下的孤立文件绝对路径 */
  original: string[]
  /** media/corrected 目录下的孤立文件绝对路径 */
  corrected: string[]
  /** media/problems 目录下的孤立文件绝对路径 */
  problems: string[]
  /** media/diagrams 目录下的孤立文件绝对路径 */
  diagrams: string[]
  /** media/practice 目录下的回传页与独立答题区域 */
  practice: string[]
}

/**
 * 用于全量查询数据库中所有「仍被引用」的媒体路径。
 * 此 SQL 覆盖 8 类引用源，缺一不可，否则 GC 会误删正在使用的文件。
 * 通过导出此常量便于测试断言完整性。
 */
export const REFERENCED_MEDIA_PATHS_SQL = `SELECT path FROM (
  SELECT original_image_path AS path FROM source_documents
  WHERE original_image_path IS NOT NULL
  UNION ALL
  SELECT corrected_image_path AS path FROM source_documents
  WHERE corrected_image_path IS NOT NULL
  UNION ALL
  SELECT crop_image_path AS path FROM problems
  WHERE crop_image_path IS NOT NULL
  UNION ALL
  SELECT ai_diagram_image_path AS path FROM problems
  WHERE ai_diagram_image_path IS NOT NULL
  UNION ALL
  SELECT image_path AS path FROM problem_regions
  WHERE image_path IS NOT NULL
  UNION ALL
  SELECT source_asset_path AS path FROM practice_attempt_pages
  WHERE source_asset_path IS NOT NULL
  UNION ALL
  SELECT corrected_asset_path AS path FROM practice_attempt_pages
  WHERE corrected_asset_path IS NOT NULL
  UNION ALL
  SELECT answer_asset_path AS path FROM practice_responses
  WHERE answer_asset_path IS NOT NULL
)`

/**
 * 从 REFERENCED_MEDIA_PATHS_SQL 的查询结果行中提取被引用的媒体路径集合。
 * 提取为独立函数便于单元测试：传入模拟行即可验证提取逻辑。
 */
export function extractReferencedMediaPaths(
  rows: Record<string, unknown>[],
): Set<string> {
  return new Set(
    rows
      .map((row) => nullableString(row.path))
      .filter((path): path is string => Boolean(path)),
  )
}

/**
 * 根据引用集合，将磁盘上实际存在的文件路径划分为「仍在使用」和「孤立」两类。
 * 路径分类规则（必须与 Rust 端 media_directory / diagram_media_directory 一致）：
 *   - 含 `/problems/` 的路径属于题块目录
 *   - 含 `/diagrams/` 的路径属于图形目录
 *   - 含 `/original/` 的路径属于原图目录
 *   - 含 `/corrected/` 的路径属于校正页目录
 *   - 含 `/practice/` 的路径属于练习回传目录
 */
export function classifyMediaPaths(
  diskPaths: string[],
  referenced: Set<string>,
): { orphaned: OrphanedMediaReport; retained: OrphanedMediaReport } {
  const orphaned: OrphanedMediaReport = {
    original: [],
    corrected: [],
    problems: [],
    diagrams: [],
    practice: [],
  }
  const retained: OrphanedMediaReport = {
    original: [],
    corrected: [],
    problems: [],
    diagrams: [],
    practice: [],
  }
  for (const path of diskPaths) {
    const bucket = path.includes('/practice/')
      ? 'practice'
      : path.includes('/diagrams/')
      ? 'diagrams'
      : path.includes('/problems/')
        ? 'problems'
        : path.includes('/corrected/')
          ? 'corrected'
          : path.includes('/original/')
            ? 'original'
            : null
    if (!bucket) continue // 不识别的路径不分类，避免误删
    if (referenced.has(path)) {
      retained[bucket].push(path)
    } else {
      orphaned[bucket].push(path)
    }
  }
  return { orphaned, retained }
}

export async function scanOrphanedMedia(): Promise<OrphanedMediaReport> {
  if (!isDesktopRuntime()) {
    return { original: [], corrected: [], problems: [], diagrams: [], practice: [] }
  }
  const db = await database()
  const rows = await db.select<Record<string, unknown>[]>(
    REFERENCED_MEDIA_PATHS_SQL,
  )
  const referenced = extractReferencedMediaPaths(rows)

  const report: OrphanedMediaReport = {
    original: [],
    corrected: [],
    problems: [],
    diagrams: [],
    practice: [],
  }
  const subdirs = ['original', 'corrected', 'problems', 'diagrams', 'practice'] as const
  for (const subdir of subdirs) {
    try {
      const entries = await listMediaDirectory(subdir)
      for (const entry of entries) {
        if (!referenced.has(entry.absolutePath)) {
          report[subdir].push(entry.absolutePath)
        }
      }
    } catch {
      // 单个子目录扫描失败不阻塞其他目录
    }
  }
  return report
}

/**
 * 删除指定的孤立媒体文件列表。每条路径在删除前会再次校验是否仍在数据库引用中，
 * 以避免误删（例如扫描与删除之间数据库又写入了引用）。
 *
 * 返回实际删除的路径列表；任何仍被引用或删除失败的文件不会被计入。
 * 覆盖全部五个媒体目录（original/corrected/problems/diagrams/practice）。
 */
export async function deleteOrphanedMedia(
  paths: string[],
): Promise<{ deleted: string[]; skipped: string[] }> {
  if (!isDesktopRuntime()) {
    return { deleted: [], skipped: paths }
  }
  const db = await database()
  const rows = await db.select<Record<string, unknown>[]>(
    REFERENCED_MEDIA_PATHS_SQL,
  )
  const referenced = extractReferencedMediaPaths(rows)

  const deleted: string[] = []
  const skipped: string[] = []
  for (const path of paths) {
    // 删除前再次检查引用（双重保护，避免误删）
    if (referenced.has(path)) {
      skipped.push(path)
      continue
    }
    try {
      await deleteMediaFile(path)
      deleted.push(path)
    } catch (error) {
      console.error(`[database] 删除孤立图片失败：${path}`, error)
      skipped.push(path)
    }
  }
  return { deleted, skipped }
}

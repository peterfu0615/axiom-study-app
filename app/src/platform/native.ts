import { Channel, convertFileSrc, invoke, isTauri } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type {
  CameraOrientationInfo,
  DocumentProcessingResult,
  NativeCapabilities,
  NormalizedRect,
  PersistedMedia,
  AIProviderProfile,
} from '../domain/models'

export interface PersistedProblemImage {
  path: string
  created: boolean
}

export interface NativeAIResponse {
  rawOutput: string
  errorMessage: string | null
}

export interface AIProviderSaveStatus {
  id: string
  provider: string
  hasApiKey: boolean
  apiKeySuffix: string
}

export interface TextbookExtractedPage {
  pageNumber: number
  evidenceText: string
  extractionMethod: 'pdf_text' | 'vision_ocr' | 'manual'
  confidence: number
}

export interface TextbookOutlineCandidate {
  title: string
  level: number
  pageNumber: number
  evidenceText: string
  confidence: number
}

export interface ImportedTextbookSource {
  sourcePath: string
  contentHash: string
  byteLength: number
  sourceType: 'pdf' | 'directory_image'
  extraction: {
    pageCount: number
    extractionMethod: 'pdf_text' | 'vision_ocr' | 'mixed'
    pages: TextbookExtractedPage[]
    outline: TextbookOutlineCandidate[]
    warnings: string[]
  }
}

export interface TextbookExtractionProgress {
  currentPage: number
  totalPages: number
  pdfTextPages: number
  ocrPages: number
  phase: 'reading' | 'pdf_text' | 'vision_ocr'
}

export function isDesktopRuntime() {
  return (
    isTauri() ||
    (typeof window !== 'undefined' && window.location.protocol === 'tauri:')
  )
}

export async function getNativeCapabilities(): Promise<NativeCapabilities | null> {
  if (!isDesktopRuntime()) return null
  return invoke<NativeCapabilities>('platform_capabilities')
}

export async function getCameraOrientation(deviceLabel: string) {
  if (!isDesktopRuntime()) return null
  return invoke<CameraOrientationInfo>('camera_orientation', { deviceLabel })
}

export async function importImage(sourcePath: string): Promise<PersistedMedia> {
  return invoke<PersistedMedia>('import_image', { sourcePath })
}

export async function importTextbookSource(
  sourcePath: string,
  requestId: string = crypto.randomUUID(),
  onProgress?: (progress: TextbookExtractionProgress) => void,
): Promise<ImportedTextbookSource> {
  const unlisten = onProgress
    ? await listen<TextbookExtractionProgress>('curriculum-extraction-progress', (event) => onProgress(event.payload))
    : null
  try {
    return await invoke<ImportedTextbookSource>('import_textbook_source', { sourcePath, requestId })
  } finally {
    unlisten?.()
  }
}

export async function cancelTextbookImport(requestId: string) {
  return invoke<void>('cancel_textbook_import', { requestId })
}

export async function verifyTextbookSource(sourcePath: string, expectedHash: string) {
  return invoke<void>('verify_textbook_source', { sourcePath, expectedHash })
}

export async function cleanupTextbookImportTemp(preservePaths: string[] = []) {
  return invoke<void>('cleanup_textbook_import_temp', { preservePaths })
}

export async function promoteTextbookSource(sourcePath: string) {
  return invoke<string>('promote_textbook_source', { path: sourcePath })
}

export async function removeTextbookSource(sourcePath: string) {
  return invoke<void>('remove_textbook_source', { path: sourcePath })
}

export async function persistCameraFrame(dataUrl: string): Promise<PersistedMedia> {
  return invoke<PersistedMedia>('persist_camera_frame', { dataUrl })
}

export function mediaAssetUrl(path: string) {
  return isDesktopRuntime() ? convertFileSrc(path) : path
}

export async function processDocument(
  sourceDocumentId: string,
  sourcePath: string,
  mode: 'color' | 'grayscale',
) {
  return invoke<DocumentProcessingResult>('process_document', {
    sourceDocumentId,
    sourcePath,
    mode,
  })
}

export async function cropProblemImage(
  problemId: string,
  sourcePath: string,
  rect: NormalizedRect,
) {
  return invoke<PersistedProblemImage>('crop_problem_image', {
    problemId,
    sourcePath,
    rect,
  })
}

export async function cropProblemDiagram(
  problemId: string,
  sourcePath: string,
  rect: NormalizedRect,
) {
  return invoke<PersistedProblemImage>('crop_problem_diagram', {
    problemId,
    sourcePath,
    rect,
  })
}

export async function removeProblemImage(path: string) {
  return invoke<void>('remove_problem_image', { path })
}

export async function removeProblemDiagram(path: string) {
  return invoke<void>('remove_problem_diagram', { path })
}

export interface MediaEntry {
  /** 相对 media/ 的路径，如 "original/uuid.jpg" */
  relativePath: string
  /** 绝对路径（规范形式），与数据库中存储的路径格式一致 */
  absolutePath: string
  /** 文件大小（字节） */
  size: number
  /** 创建时间（Unix 毫秒），失败时为 null */
  createdAt: number | null
}

/**
 * 枚举指定媒体子目录下的所有文件。
 * subdir 必须是 original / corrected / problems / diagrams 之一。
 */
export async function listMediaDirectory(subdir: string): Promise<MediaEntry[]> {
  return invoke<MediaEntry[]>('list_media_directory', { subdir })
}

/** 删除单个媒体文件（幂等，文件不存在时返回成功）。 */
export async function deleteMediaFile(path: string): Promise<void> {
  return invoke<void>('delete_media_file', { path })
}

/** 解析符号链接并返回路径的规范形式，用于数据库路径一致性校验。 */
export async function canonicalizePath(path: string): Promise<string> {
  return invoke<string>('canonicalize_path', { path })
}

/**
 * 将数据库文件从 from 复制到 to（仅复制，不删除源文件）。
 * 用于修复 plugin-sql 与 Rust sqlx 路径不一致。
 */
export async function migrateDatabase(from: string, to: string): Promise<void> {
  return invoke<void>('migrate_database', { from, to })
}

/** 获取 Rust 端实际使用的数据库文件绝对路径。 */
export async function getDatabasePath(): Promise<string> {
  return invoke<string>('get_database_path')
}

/** Runs the one-time Keychain → SQLite compatibility recovery after migrations. */
export async function recoverLegacyProviderApiKeys() {
  return invoke<void>('recover_legacy_api_keys')
}

export async function analyzeProblemWithOpenAICompatible(request: {
  baseUrl: string
  model: string
  /** Provider ID. Rust reads its API Key from local SQLite internally. */
  providerId: string
  /** 主图（可选，与 imagePaths 合并） */
  cropImagePath?: string
  /** 附加图片（多区域分析时使用） */
  imagePaths?: string[]
  /** System prompt */
  prompt: string
  /** 用户消息文本（可选） */
  userText?: string
  /** JSON Schema 字符串（可选；部分 Provider 支持 response_format json_schema） */
  jsonSchema?: string
  /** 流式回调（可选；传入时启用 SSE 流式输出） */
  onChunk?: (chunk: { accumulated: string; delta: string }) => void
}) {
  // Tauri v2 Channel：onChunk 必须作为独立参数传给 Rust 命令（不在 request 内），
  // 因为 Channel<StreamChunk> 不实现 Deserialize，必须作为 CommandArg 传入。
  // 即使不需要流式输出，也必须传一个 Channel（Rust 端用 stream flag 控制是否启用流式）。
  type StreamMessage = { accumulated: string; delta: string }
  const channel = new Channel<StreamMessage>()
  channel.onmessage = (message) => {
    request.onChunk?.(message)
  }
  const { onChunk: _onChunk, ...rest } = request
  return invoke<NativeAIResponse>(
    'analyze_problem_with_openai_compatible',
    {
      request: rest,
      onChunk: channel,
      stream: request.onChunk ? true : false,
    },
  )
}

/**
 * Save Provider fields and a newly-entered API Key in one native SQLite
 * transaction.  A blank `apiKey` means retain the existing database value.
 */
export async function persistAIProviderProfiles(profiles: AIProviderProfile[]) {
  return invoke<AIProviderSaveStatus[]>('persist_ai_provider_profiles', { profiles })
}

/** Explicit deletion is the only path that clears a saved SQLite API Key. */
export async function deleteAIProviderApiKey(providerId: string) {
  return invoke<void>('delete_ai_provider_api_key', { providerId })
}

export async function mergeTagDefinitions(
  subject: string,
  sourceTagId: string,
  targetTagId: string,
) {
  return invoke<void>('merge_tag_definitions', {
    subject,
    sourceTagId,
    targetTagId,
  })
}

export async function mergeKnowledgeNodes(
  subject: string,
  sourceNodeId: string,
  targetNodeId: string,
) {
  return invoke<void>('merge_knowledge_nodes', {
    subject,
    sourceNodeId,
    targetNodeId,
  })
}

export interface RelabelBatchItemClaim {
  problemId: string
  modelRunId: string | null
  claimToken: string
}

export async function claimRelabelBatchItem(
  batchId: string,
  claimToken: string,
) {
  return invoke<RelabelBatchItemClaim | null>('claim_relabel_batch_item', {
    request: { batchId, claimToken },
  })
}

export async function bindRelabelBatchItemModelRun(request: {
  batchId: string
  problemId: string
  claimToken: string
  modelRunId: string
}) {
  return invoke<boolean>('bind_relabel_batch_item_model_run', { request })
}

export async function recoverRelabelBatchItems() {
  return invoke<void>('recover_relabel_batch_items')
}

export interface BulkReviewCurriculumTagsResult {
  approvedDefinitions: number
  rejectedDefinitions: number
  approvedProblemTags: number
  rejectedProblemTags: number
  skippedUnmapped: number
  skippedLocked: number
  skippedInvalid: number
}

export async function bulkReviewCurriculumTags(request: {
  subject: string
  tagType: 'knowledge' | 'method' | 'model' | 'error'
  textbookId?: string | null
  definitionIds?: string[]
  problemTagIds?: string[]
  decision: 'approve' | 'reject'
}) {
  return invoke<BulkReviewCurriculumTagsResult>('bulk_review_curriculum_tags', { request })
}

export async function analyzeProblemWithAntigravityCLI(request: {
  commandPath: string
  model: string
  cropImagePath?: string
  imagePaths?: string[]
  prompt: string
  jsonSchema: string
}) {
  return invoke<NativeAIResponse>(
    'analyze_problem_with_antigravity_cli',
    { request },
  )
}

// ────────────────────────────────────────────────────────────
// 自动更新
// ────────────────────────────────────────────────────────────

/** 检查更新返回的信息。null 表示已是最新版本。 */
export interface UpdateInfo {
  /** 最新版本号（不含 v 前缀） */
  version: string
  /** 当前安装版本号 */
  currentVersion: string
  /** 更新日志（Markdown） */
  releaseNotes: string
  /** 发布时间（ISO 8601） */
  publishedAt: string
  /** `.app.zip` 下载 URL */
  downloadUrl: string
  /** 下载文件大小（字节） */
  downloadSize: number
  /** `.sha256` 校验文件 URL（可能为空） */
  sha256Url: string | null
}

/** 下载进度事件 payload。 */
export interface DownloadProgress {
  downloaded: number
  total: number
  percent: number
}

/** 获取当前应用版本号。 */
export async function getAppVersion(): Promise<string> {
  return invoke<string>('get_app_version')
}

/**
 * 检查 GitHub 最新 release。
 * 返回 null 表示已是最新；返回 UpdateInfo 表示有可用更新。
 * 网络错误时抛出异常，调用方应静默处理（启动检查场景）或提示（手动检查场景）。
 */
export async function checkForUpdates(): Promise<UpdateInfo | null> {
  return invoke<UpdateInfo | null>('check_for_updates')
}

/**
 * 下载并安装更新。下载进度通过 `update://progress` 事件报告。
 * 成功后当前进程退出，由 Rust 端 detached 脚本完成替换和重启。
 */
export async function downloadAndInstallUpdate(
  downloadUrl: string,
  sha256Url: string | null,
): Promise<void> {
  return invoke<void>('download_and_install_update', {
    downloadUrl,
    sha256Url,
  })
}

/**
 * 监听下载进度事件。返回取消监听的函数。
 *
 * 用法：
 *   const unlisten = await onDownloadProgress((p) => setPercent(p.percent))
 *   // ... 下载完成后
 *   unlisten()
 */
export async function onDownloadProgress(
  callback: (progress: DownloadProgress) => void,
): Promise<UnlistenFn> {
  return listen<DownloadProgress>('update://progress', (event) =>
    callback(event.payload),
  )
}
export type CurriculumAIStage =
  | 'ai_analyzing_structure'
  | 'ai_generating_tags'
  | 'ai_auditing'

export interface CurriculumImportAttemptLease {
  attemptId: string
  attemptNumber: number
  runToken: string
  runGeneration: number
  /** `false` means an already-running stage owns the lease. */
  created: boolean
}

export interface CurriculumImportAttemptIdentity {
  jobId: string
  stage: CurriculumAIStage
  attemptId: string
  attemptNumber: number
  runToken: string
  runGeneration: number
}

export interface CurriculumImportProgressUpdate extends CurriculumImportAttemptIdentity {
  progressCurrent: number
  progressTotal: number
  progressFraction: number
  progressLabel: string
}

export async function createCurriculumImportAttempt(request: {
  jobId: string
  stage: CurriculumAIStage
  promptVersion: string
  schemaVersion: string
  restartActiveAttempt?: boolean
}) {
  return invoke<CurriculumImportAttemptLease>('create_curriculum_import_attempt', { request })
}

export async function updateCurriculumImportProgress(request: CurriculumImportProgressUpdate) {
  return invoke<boolean>('update_curriculum_import_progress', { request })
}

export async function completeCurriculumImportAttempt(request: CurriculumImportAttemptIdentity & {
  rawOutput: string
  providerTaskId?: string | null
  metadataJson?: string | null
  structureJson?: string | null
  tagsJson?: string | null
  auditJson?: string | null
}) {
  return invoke<boolean>('complete_curriculum_import_attempt', { request })
}

export async function failCurriculumImportAttempt(request: CurriculumImportAttemptIdentity & {
  errorMessage: string
}) {
  return invoke<boolean>('fail_curriculum_import_attempt', { request })
}

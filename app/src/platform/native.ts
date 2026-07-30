import { convertFileSrc, invoke, isTauri } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type {
  CameraOrientationInfo,
  DocumentProcessingResult,
  NativeCapabilities,
  NormalizedRect,
  PersistedMedia,
} from '../domain/models'

export interface PersistedProblemImage {
  path: string
  created: boolean
}

export interface NativeAIResponse {
  rawOutput: string
  errorMessage: string | null
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

export async function analyzeProblemWithOpenAICompatible(request: {
  baseUrl: string
  model: string
  /** Keychain 凭据引用（provider id）。Rust 内部按 ref 从 Keychain 读取实际 key。 */
  credentialRef: string
  cropImagePath: string
  prompt: string
}) {
  return invoke<NativeAIResponse>(
    'analyze_problem_with_openai_compatible',
    { request },
  )
}

/**
 * 将 API Key 存入 macOS Keychain。返回 credential_ref（即 provider id）。
 * 数据库不再保存明文 key，降低泄露面。
 */
export async function storeApiKey(
  providerId: string,
  apiKey: string,
): Promise<string> {
  return invoke<string>('store_api_key', { providerId, apiKey })
}

/**
 * 从 Keychain 读取 API Key。
 * 仅在需要前端校验存在性时使用；AI 请求由 Rust 内部直接读取，不经过此调用。
 */
export async function loadApiKey(providerId: string): Promise<string> {
  return invoke<string>('load_api_key', { credentialRef: providerId })
}

/** 从 Keychain 删除 API Key（幂等，条目不存在时返回成功）。 */
export async function deleteApiKey(providerId: string): Promise<void> {
  return invoke<void>('delete_api_key', { credentialRef: providerId })
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

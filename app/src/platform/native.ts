import { convertFileSrc, invoke, isTauri } from '@tauri-apps/api/core'
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
  apiKey: string
  cropImagePath: string
  prompt: string
}) {
  return invoke<NativeAIResponse>(
    'analyze_problem_with_openai_compatible',
    { request },
  )
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

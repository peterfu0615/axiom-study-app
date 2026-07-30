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

import type { CameraDevice } from '../domain/models'
import {
  normalizeQuarterTurn,
  rotatedFrameDimensions,
  type QuarterTurn,
  uncroppedFourThreeFrame,
} from './cameraGeometry'

const CAMERA_REQUEST_TIMEOUT_MS = 25_000

function ensureMediaDevices() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('当前运行环境不支持相机访问')
  }
}

function cameraDevices(devices: MediaDeviceInfo[]): CameraDevice[] {
  return devices
    .filter((device) => device.kind === 'videoinput')
    .map((device, index) => ({
      id: device.deviceId,
      label: device.label || `摄像头 ${index + 1}`,
    }))
}

async function getUserMediaWithTimeout(
  constraints: MediaStreamConstraints,
  timeoutMs: number,
): Promise<MediaStream> {
  const pending = navigator.mediaDevices.getUserMedia(constraints)
  return await new Promise<MediaStream>((resolve, reject) => {
    let settled = false
    const timer = globalThis.setTimeout(() => {
      if (settled) return
      settled = true
      reject(
        new Error(
          `相机连接超过 ${Math.max(1, Math.ceil(timeoutMs / 1000))} 秒，请确认设备已就绪后重试`,
        ),
      )
    }, timeoutMs)
    void pending.then(
      (stream) => {
        if (settled) {
          stopCameraStream(stream)
          return
        }
        settled = true
        globalThis.clearTimeout(timer)
        resolve(stream)
      },
      (error: unknown) => {
        if (settled) return
        settled = true
        globalThis.clearTimeout(timer)
        reject(error)
      },
    )
  })
}

export async function requestCameraDevices(
  timeoutMs = CAMERA_REQUEST_TIMEOUT_MS,
): Promise<CameraDevice[]> {
  ensureMediaDevices()
  const knownDevices = await navigator.mediaDevices.enumerateDevices()
  const knownCameras = knownDevices.filter(
    (device) => device.kind === 'videoinput',
  )
  if (knownCameras.length && knownCameras.some((device) => device.label)) {
    return cameraDevices(knownDevices)
  }

  const permissionStream = await getUserMediaWithTimeout(
    {
      video: true,
      audio: false,
    },
    timeoutMs,
  )
  permissionStream.getTracks().forEach((track) => track.stop())

  const devices = await navigator.mediaDevices.enumerateDevices()
  return cameraDevices(devices)
}

export async function openCameraStream(
  deviceId?: string,
  timeoutMs = CAMERA_REQUEST_TIMEOUT_MS,
) {
  ensureMediaDevices()
  return getUserMediaWithTimeout(
    {
      audio: false,
      video: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        width: { ideal: 3840 },
        height: { ideal: 2880 },
        aspectRatio: { ideal: 4 / 3 },
        facingMode: { ideal: 'environment' },
      },
    },
    timeoutMs,
  )
}

export function stopCameraStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop())
}

export function drawOrientedVideoFrame(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  requestedRotation: number,
  maxLongEdge?: number,
) {
  if (!video.videoWidth || !video.videoHeight) {
    throw new Error('相机画面尚未准备好')
  }
  const rotation = normalizeQuarterTurn(requestedRotation)
  const source = uncroppedFourThreeFrame(video.videoWidth, video.videoHeight)
  const output = rotatedFrameDimensions(source.width, source.height, rotation)
  const scale = maxLongEdge
    ? Math.min(1, maxLongEdge / Math.max(output.width, output.height))
    : 1
  const renderedWidth = Math.round(output.width * scale)
  const renderedHeight = Math.round(output.height * scale)
  if (canvas.width !== renderedWidth) canvas.width = renderedWidth
  if (canvas.height !== renderedHeight) canvas.height = renderedHeight

  const context = canvas.getContext('2d')
  if (!context) throw new Error('无法创建图片画布')
  context.setTransform(1, 0, 0, 1, 0, 0)
  context.clearRect(0, 0, canvas.width, canvas.height)
  context.scale(scale, scale)

  switch (rotation as QuarterTurn) {
    case 90:
      context.translate(output.width, 0)
      context.rotate(Math.PI / 2)
      break
    case 180:
      context.translate(output.width, output.height)
      context.rotate(Math.PI)
      break
    case 270:
      context.translate(0, output.height)
      context.rotate(-Math.PI / 2)
      break
  }
  context.drawImage(
    video,
    source.x,
    source.y,
    source.width,
    source.height,
    0,
    0,
    source.width,
    source.height,
  )
  context.setTransform(1, 0, 0, 1, 0, 0)
  return output
}

export async function captureVideoFrame(
  video: HTMLVideoElement,
  rotation: QuarterTurn,
  onFrameCopied?: () => void,
): Promise<string> {
  const canvas = document.createElement('canvas')
  drawOrientedVideoFrame(video, canvas, rotation)
  onFrameCopied?.()
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (value) => {
        if (value) resolve(value)
        else reject(new Error('无法编码相机帧'))
      },
      'image/jpeg',
      0.94,
    )
  })
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('无法读取相机帧'))
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result)
      else reject(new Error('相机帧编码结果无效'))
    }
    reader.readAsDataURL(blob)
  })
}

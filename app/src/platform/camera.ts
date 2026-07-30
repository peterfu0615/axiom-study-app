import type { CameraDevice } from '../domain/models'
import {
  normalizeQuarterTurn,
  rotatedFrameDimensions,
  type QuarterTurn,
  uncroppedFourThreeFrame,
} from './cameraGeometry'

function ensureMediaDevices() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('当前运行环境不支持相机访问')
  }
}

export async function requestCameraDevices(): Promise<CameraDevice[]> {
  ensureMediaDevices()
  const permissionStream = await navigator.mediaDevices.getUserMedia({
    video: true,
    audio: false,
  })
  permissionStream.getTracks().forEach((track) => track.stop())

  const devices = await navigator.mediaDevices.enumerateDevices()
  return devices
    .filter((device) => device.kind === 'videoinput')
    .map((device, index) => ({
      id: device.deviceId,
      label: device.label || `摄像头 ${index + 1}`,
    }))
}

export async function openCameraStream(deviceId?: string) {
  ensureMediaDevices()
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      width: { ideal: 3840 },
      height: { ideal: 2880 },
      aspectRatio: { ideal: 4 / 3 },
      facingMode: { ideal: 'environment' },
    },
  })
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

export function captureVideoFrame(
  video: HTMLVideoElement,
  rotation: QuarterTurn,
) {
  const canvas = document.createElement('canvas')
  drawOrientedVideoFrame(video, canvas, rotation)
  return canvas.toDataURL('image/jpeg', 0.94)
}

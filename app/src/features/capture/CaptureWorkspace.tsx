import { useCallback, useEffect, useRef, useState } from 'react'
import { Toast } from '../../components/Toast'
import { useToast } from '../../platform/useToast'
import { open } from '@tauri-apps/plugin-dialog'
import type {
  CameraDevice,
  CameraStatus,
  NativeCapabilities,
  SourceDocument,
} from '../../domain/models'
import { Icon } from '../../components/Icon'
import {
  captureVideoFrame,
  drawOrientedVideoFrame,
  openCameraStream,
  requestCameraDevices,
  stopCameraStream,
} from '../../platform/camera'
import {
  normalizeQuarterTurn,
  resolveDocumentRotation,
  type QuarterTurn,
} from '../../platform/cameraGeometry'
import {
  getCameraOrientation,
  getNativeCapabilities,
  importImage,
  isDesktopRuntime,
  mediaAssetUrl,
  persistCameraFrame,
} from '../../platform/native'
import {
  listRecentSourceDocuments,
  saveSourceDocument,
} from '../../platform/database'
import { DocumentEditor } from './DocumentEditor'

type CaptureMode = 'camera' | 'import'

const cameraStatusCopy: Record<CameraStatus, string> = {
  idle: '等待授权',
  requesting: '正在检查',
  ready: '相机已连接',
  denied: '相机权限被拒绝',
  unavailable: '未发现相机',
  error: '相机不可用',
}

export function CaptureWorkspace() {
  const [mode, setMode] = useState<CaptureMode>('camera')
  const [cameraStatus, setCameraStatus] = useState<CameraStatus>('idle')
  const [devices, setDevices] = useState<CameraDevice[]>([])
  const [selectedDeviceId, setSelectedDeviceId] = useState('')
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [capabilities, setCapabilities] =
    useState<NativeCapabilities | null>(null)
  const [recent, setRecent] = useState<SourceDocument[]>([])
  const [preview, setPreview] = useState<SourceDocument | null>(null)
  const [editingDocument, setEditingDocument] =
    useState<SourceDocument | null>(null)
  const [busy, setBusy] = useState(false)
  const { toast, notify, dismiss } = useToast()
  const [rotation, setRotation] = useState<QuarterTurn>(0)
  const [manualRotation, setManualRotation] = useState(false)
  const [previewOrientation, setPreviewOrientation] = useState<
    'portrait' | 'landscape'
  >('portrait')
  const videoRef = useRef<HTMLVideoElement>(null)
  const previewCanvasRef = useRef<HTMLCanvasElement>(null)

  const refreshRecent = useCallback(async () => {
    try {
      setRecent(await listRecentSourceDocuments())
    } catch (error) {
      notify(`读取本地记录失败：${String(error)}`, 'error')
    }
  }, [])

  useEffect(() => {
    void getNativeCapabilities().then(setCapabilities).catch(() => null)
    void refreshRecent()
  }, [refreshRecent])

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = stream
      void videoRef.current.play().catch(() => null)
    }
    return () => stopCameraStream(stream)
  }, [stream])

  useEffect(() => {
    if (!stream || !videoRef.current || !previewCanvasRef.current) return
    const video = videoRef.current
    const canvas = previewCanvasRef.current
    let frameId = 0
    let lastOrientation = previewOrientation

    const draw = () => {
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        try {
          const dimensions = drawOrientedVideoFrame(
            video,
            canvas,
            rotation,
            1200,
          )
          const nextOrientation =
            dimensions.height >= dimensions.width ? 'portrait' : 'landscape'
          if (nextOrientation !== lastOrientation) {
            lastOrientation = nextOrientation
            setPreviewOrientation(nextOrientation)
          }
        } catch {
          // Metadata can be briefly unavailable while WebKit switches cameras.
        }
      }
      frameId = requestAnimationFrame(draw)
    }
    frameId = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frameId)
  }, [previewOrientation, rotation, stream])

  useEffect(() => {
    if (!stream || !selectedDeviceId || manualRotation) return
    const selected = devices.find((device) => device.id === selectedDeviceId)
    if (!selected) return
    let cancelled = false
    let timer = 0

    const syncOrientation = async () => {
      try {
        const orientation = await getCameraOrientation(selected.label)
        if (!cancelled && orientation) {
          const video = videoRef.current
          setRotation(
            resolveDocumentRotation(
              orientation.previewRotationAngle,
              video?.videoWidth ?? 0,
              video?.videoHeight ?? 0,
              orientation.isContinuityCamera
                || /iphone|continuity|连续互通/i.test(selected.label),
            ),
          )
        }
      } catch {
        const video = videoRef.current
        if (!cancelled && video?.videoWidth && video.videoWidth > video.videoHeight) {
          setRotation(90)
        }
      } finally {
        if (!cancelled) {
          timer = window.setTimeout(() => void syncOrientation(), 900)
        }
      }
    }
    void syncOrientation()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [devices, manualRotation, selectedDeviceId, stream])

  const connectCamera = useCallback(async () => {
    dismiss()
    setCameraStatus('requesting')
    try {
      const availableDevices = await requestCameraDevices()
      setDevices(availableDevices)
      if (!availableDevices.length) {
        setCameraStatus('unavailable')
        return
      }
      const preferred =
        availableDevices.find((device) =>
          /iphone|continuity|连续互通/i.test(device.label),
        ) ?? availableDevices[0]
      setSelectedDeviceId(preferred.id)
      setManualRotation(false)
      setRotation(0)
      stopCameraStream(stream)
      const nextStream = await openCameraStream(preferred.id)
      setStream(nextStream)
      setCameraStatus('ready')
    } catch (error) {
      const name = error instanceof DOMException ? error.name : ''
      setCameraStatus(
        name === 'NotAllowedError' || name === 'PermissionDeniedError'
          ? 'denied'
          : 'error',
      )
      notify(`无法连接相机：${String(error)}`, 'error')
    }
  }, [stream])

  const switchCamera = useCallback(
    async (deviceId: string) => {
      setSelectedDeviceId(deviceId)
      setManualRotation(false)
      setRotation(0)
      setCameraStatus('requesting')
      try {
        stopCameraStream(stream)
        const nextStream = await openCameraStream(deviceId)
        setStream(nextStream)
        setCameraStatus('ready')
      } catch (error) {
        setCameraStatus('error')
        notify(`切换相机失败：${String(error)}`, 'error')
      }
    },
    [stream],
  )

  const captureFrame = useCallback(async () => {
    if (!videoRef.current || !isDesktopRuntime()) return
    setBusy(true)
    dismiss()
    try {
      const dataUrl = captureVideoFrame(videoRef.current, rotation)
      const media = await persistCameraFrame(dataUrl)
      const document = await saveSourceDocument(media)
      setPreview(document)
      await refreshRecent()
      notify('照片已保存到本地处理队列', 'success')
      setEditingDocument(document)
    } catch (error) {
      notify(`拍照失败：${String(error)}`, 'error')
    } finally {
      setBusy(false)
    }
  }, [refreshRecent, rotation])

  const chooseImage = useCallback(async () => {
    if (!isDesktopRuntime()) {
      notify('图片导入需要在 Tauri 桌面窗口中运行', 'info')
      return
    }
    setBusy(true)
    dismiss()
    try {
      const selected = await open({
        multiple: false,
        directory: false,
        title: '选择试卷或错题图片',
        filters: [
          {
            name: '图片',
            extensions: ['jpg', 'jpeg', 'png', 'webp'],
          },
        ],
      })
      if (!selected) return
      const media = await importImage(selected)
      const document = await saveSourceDocument(media)
      setPreview(document)
      await refreshRecent()
      notify('图片已复制到 Axiom 本地资料库', 'success')
      setEditingDocument(document)
    } catch (error) {
      notify(`导入失败：${String(error)}`, 'error')
    } finally {
      setBusy(false)
    }
  }, [refreshRecent])

  const selectedDevice = devices.find(
    (device) => device.id === selectedDeviceId,
  )
  const isContinuityCamera =
    !!selectedDevice &&
    /iphone|continuity|连续互通/i.test(selectedDevice.label)

  if (editingDocument) {
    return (
      <DocumentEditor
        document={editingDocument}
        onBack={() => {
          setEditingDocument(null)
          void refreshRecent()
        }}
        onSaved={refreshRecent}
      />
    )
  }

  return (
    <main className="workspace">
      <header className="workspace-header" data-tauri-drag-region>
        <div>
          <p className="eyebrow">采集工作台</p>
          <h1>添加错题</h1>
          <p className="subtitle">拍下整页，下一阶段将自动校正并切分题目。</p>
        </div>
        <div className="runtime-pill">
          <span className={`status-dot ${capabilities ? 'online' : ''}`} />
          {capabilities
            ? `macOS ${capabilities.architecture} · 本地数据库`
            : '浏览器预览模式'}
        </div>
      </header>

      <section className="capture-layout">
        <div className="capture-card">
          <div className="mode-tabs" role="tablist">
            <button
              aria-selected={mode === 'camera'}
              className={mode === 'camera' ? 'active' : ''}
              onClick={() => setMode('camera')}
              role="tab"
              type="button"
            >
              <Icon name="camera" size={18} />
              iPhone 相机
            </button>
            <button
              aria-selected={mode === 'import'}
              className={mode === 'import' ? 'active' : ''}
              onClick={() => setMode('import')}
              role="tab"
              type="button"
            >
              <Icon name="image" size={18} />
              导入图片
            </button>
          </div>

          {mode === 'camera' ? (
            <div
              className={`camera-stage ${
                stream ? previewOrientation : 'portrait'
              }`}
            >
              {stream ? (
                <>
                  <canvas
                    aria-label="已校正方向的相机预览"
                    className="camera-preview"
                    ref={previewCanvasRef}
                  />
                  <video
                    autoPlay
                    className="camera-source-video"
                    muted
                    playsInline
                    ref={videoRef}
                  />
                </>
              ) : (
                <div className="camera-empty">
                  <div className="camera-orbit">
                    <Icon name="camera" size={34} />
                  </div>
                  <h2>连接 iPhone 连续互通相机</h2>
                  <p>
                    将 iPhone 靠近 Mac 并锁定屏幕，然后允许 Axiom
                    使用摄像头。
                  </p>
                  <button
                    className="primary-button"
                    disabled={cameraStatus === 'requesting'}
                    onClick={() => void connectCamera()}
                    type="button"
                  >
                    {cameraStatus === 'requesting' ? '正在连接…' : '检查相机'}
                  </button>
                </div>
              )}

              <div className="camera-toolbar">
                <div>
                  <span
                    className={`status-dot ${
                      cameraStatus === 'ready' ? 'online' : ''
                    }`}
                  />
                  {cameraStatusCopy[cameraStatus]}
                  {isContinuityCamera ? ' · iPhone' : ''}
                </div>
                {devices.length > 0 && (
                  <select
                    aria-label="选择摄像头"
                    onChange={(event) => void switchCamera(event.target.value)}
                    value={selectedDeviceId}
                  >
                    {devices.map((device) => (
                      <option key={device.id} value={device.id}>
                        {device.label}
                      </option>
                    ))}
                  </select>
                )}
                {stream && (
                  <>
                    <button
                      aria-label="顺时针旋转预览"
                      className="camera-rotate-button"
                      onClick={() => {
                        setManualRotation(true)
                        setRotation((current) =>
                          normalizeQuarterTurn(current + 90),
                        )
                      }}
                      title="手动顺时针旋转 90°；重新连接后恢复自动方向"
                      type="button"
                    >
                      <Icon name="rotate" size={16} />
                    </button>
                    <button
                      className="shutter-button"
                      disabled={busy}
                      onClick={() => void captureFrame()}
                      title="拍照"
                      type="button"
                    >
                      <span />
                    </button>
                  </>
                )}
              </div>
            </div>
          ) : (
            <button
              className="drop-zone"
              disabled={busy}
              onClick={() => void chooseImage()}
              type="button"
            >
              <span className="drop-icon">
                <Icon name="image" size={30} />
              </span>
              <strong>{busy ? '正在导入…' : '选择试卷图片'}</strong>
              <span>支持 JPG、PNG、WebP，单张不超过 30 MB</span>
              <span className="secondary-button">从 Finder 选择</span>
            </button>
          )}
        </div>

        <aside className="capture-side-panel">
          <div className="side-panel-heading">
            <div>
              <p className="eyebrow">最新采集</p>
              <h2>本地处理队列</h2>
            </div>
            <button
              aria-label="刷新"
              className="icon-button"
              onClick={() => void refreshRecent()}
              type="button"
            >
              <Icon name="refresh" size={18} />
            </button>
          </div>

          {preview && (
            <div className="latest-preview">
              <img
                alt="最新采集的错题"
                src={mediaAssetUrl(preview.originalImagePath)}
              />
              <div>
                <span className="queue-status">
                  <Icon name="check" size={14} /> 已安全保存
                </span>
                <strong>
                  {preview.processingStatus === 'ready_for_segmentation'
                    ? '题目块可编辑'
                    : '等待页面校正'}
                </strong>
              </div>
            </div>
          )}

          <div className="queue-list">
            {recent.length ? (
              recent.map((document) => (
                <button
                  className="queue-item"
                  key={document.id}
                  onClick={() => {
                    setPreview(document)
                    setEditingDocument(document)
                  }}
                  type="button"
                >
                  <img
                    alt=""
                    src={mediaAssetUrl(document.originalImagePath)}
                  />
                  <span>
                    <strong>
                      {document.sourceType === 'camera' ? '相机拍摄' : '图片导入'}
                    </strong>
                    <small>
                      {document.processingStatus === 'ready_for_segmentation'
                        ? '已生成题目块 · '
                        : ''}
                      {new Intl.DateTimeFormat('zh-CN', {
                          hour: '2-digit',
                          minute: '2-digit',
                          month: 'numeric',
                          day: 'numeric',
                        }).format(document.capturedAt)}
                    </small>
                  </span>
                  <Icon name="chevron" size={16} />
                </button>
              ))
            ) : (
              <div className="empty-queue">
                <span>0</span>
                <p>还没有待处理图片</p>
              </div>
            )}
          </div>

          <div className="stage-note">
            <span>阶段 1</span>
            <p>
              页面矫正、色彩优化与可编辑题目块均在本机完成，原图始终保留。
            </p>
          </div>
        </aside>
      </section>

      <Toast toast={toast} />
    </main>
  )
}

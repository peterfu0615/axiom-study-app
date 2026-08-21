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
  getNativeCapabilities,
  importImage,
  isDesktopRuntime,
  mediaAssetUrl,
  persistCameraFrame,
  startCameraOrientationWatch,
  warmUpDocumentProcessor,
} from '../../platform/native'
import {
  listRecentSourceDocuments,
  saveSourceDocument,
} from '../../platform/database'
import { DocumentEditor } from './DocumentEditor'
import { ListboxSelect, PageHeader, SegmentedControl } from '../../components/ui'

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
  const [continuousCapture, setContinuousCapture] = useState(true)
  const [frameReady, setFrameReady] = useState(false)
  const { toast, notify, dismiss } = useToast()
  const [rotation, setRotation] = useState<QuarterTurn>(0)
  const [manualRotation, setManualRotation] = useState(false)
  const [previewOrientation, setPreviewOrientation] = useState<
    'portrait' | 'landscape'
  >('portrait')
  const videoRef = useRef<HTMLVideoElement>(null)
  const previewCanvasRef = useRef<HTMLCanvasElement>(null)
  const latestOrientationRef = useRef<{
    rotationAngle: number
    isContinuityCamera: boolean
  } | null>(null)

  const refreshRecent = useCallback(async () => {
    try {
      setRecent(await listRecentSourceDocuments())
    } catch (error) {
      notify(`读取本地记录失败：${String(error)}`, 'error')
    }
  }, [notify])

  useEffect(() => {
    let cancelled = false
    void getNativeCapabilities()
      .then((next) => { if (!cancelled) setCapabilities(next) })
      .catch(() => null)
    void refreshRecent()
    return () => { cancelled = true }
  }, [refreshRecent])

  useEffect(() => {
    void warmUpDocumentProcessor().catch(() => undefined)
  }, [])

  useEffect(() => {
    setFrameReady(false)
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
    let lastOrientation: 'portrait' | 'landscape' | null = null
    let hasSuccessfulFrame = false

    const draw = () => {
      const canDrawFrame = Boolean(
        video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
        && video.videoWidth
        && video.videoHeight,
      )
      if (canDrawFrame) {
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
          if (!hasSuccessfulFrame) {
            hasSuccessfulFrame = true
            setFrameReady(true)
          }
        } catch {
          // Continuity Camera can transiently pause between otherwise valid
          // frames. Keep the last successfully copied frame available; the
          // capture path validates video dimensions again before release.
        }
      }
      frameId = requestAnimationFrame(draw)
    }
    frameId = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(frameId)
      setFrameReady(false)
    }
  }, [rotation, stream])

  const applyOrientation = useCallback(
    (update: {
      rotationAngle: number
      isContinuityCamera: boolean
    }) => {
      latestOrientationRef.current = update
      const video = videoRef.current
      if (!video?.videoWidth || !video.videoHeight) return
      setRotation(
        resolveDocumentRotation(
          update.rotationAngle,
          video.videoWidth,
          video.videoHeight,
          update.isContinuityCamera,
        ),
      )
    },
    [],
  )

  useEffect(() => {
    if (!stream || !selectedDeviceId || manualRotation) return
    const selected = devices.find((device) => device.id === selectedDeviceId)
    if (!selected) return
    let active = true
    let unlisten: (() => void) | null = null
    latestOrientationRef.current = null

    void startCameraOrientationWatch(selected.label, (update) => {
      if (active) {
        applyOrientation({
          rotationAngle: update.rotationAngle,
          isContinuityCamera:
            update.isContinuityCamera
            || /iphone|continuity|连续互通/i.test(selected.label),
        })
      }
    })
      .then((cleanup) => {
        if (active) unlisten = cleanup
        else cleanup()
      })
      .catch(() => {
        const video = videoRef.current
        if (active && video?.videoWidth && video.videoWidth > video.videoHeight) {
          setRotation(90)
        }
      })

    return () => {
      active = false
      unlisten?.()
      unlisten = null
    }
  }, [applyOrientation, devices, manualRotation, selectedDeviceId, stream])

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
      setStream(null)
      setFrameReady(false)
      latestOrientationRef.current = null
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
  }, [dismiss, notify, stream])

  const switchCamera = useCallback(
    async (deviceId: string) => {
      setSelectedDeviceId(deviceId)
      setManualRotation(false)
      setRotation(0)
      setCameraStatus('requesting')
      try {
        stopCameraStream(stream)
        setStream(null)
        setFrameReady(false)
        latestOrientationRef.current = null
        const nextStream = await openCameraStream(deviceId)
        setStream(nextStream)
        setCameraStatus('ready')
      } catch (error) {
        setCameraStatus('error')
        notify(`切换相机失败：${String(error)}`, 'error')
      }
    },
    [notify, stream],
  )

  const changeMode = useCallback(
    (nextMode: CaptureMode) => {
      if (nextMode === 'import') {
        stopCameraStream(stream)
        setStream(null)
        setCameraStatus('idle')
      }
      setMode(nextMode)
    },
    [stream],
  )

  const captureFrame = useCallback(async () => {
    if (!videoRef.current || !isDesktopRuntime()) return
    if (!frameReady) {
      notify('相机画面正在准备，请稍候再拍', 'info')
      return
    }
    setBusy(true)
    dismiss()
    try {
      const dataUrl = await captureVideoFrame(
        videoRef.current,
        rotation,
        () => {
          // Pixels are now owned by the canvas. Release Continuity Camera
          // before asynchronous JPEG encoding, persistence and OCR begin.
          stopCameraStream(stream)
          setStream(null)
          setCameraStatus('idle')
        },
      )
      const media = await persistCameraFrame(dataUrl)
      const document = await saveSourceDocument(media)
      setPreview(document)
      await refreshRecent()
      if (continuousCapture && selectedDeviceId) {
        setCameraStatus('requesting')
        try {
          const nextStream = await openCameraStream(selectedDeviceId)
          setStream(nextStream)
          setCameraStatus('ready')
          notify('本页已保存到队列，可以继续拍摄下一页', 'success')
        } catch (resumeError) {
          setCameraStatus('error')
          notify(`本页已保存；重新连接相机失败：${String(resumeError)}`, 'error')
        }
      } else {
        notify('照片已保存到本地处理队列', 'success')
        setEditingDocument(document)
      }
    } catch (error) {
      notify(`拍照失败：${String(error)}`, 'error')
    } finally {
      setBusy(false)
    }
  }, [continuousCapture, dismiss, frameReady, notify, refreshRecent, rotation, selectedDeviceId, stream])

  const chooseImage = useCallback(async () => {
    if (!isDesktopRuntime()) {
      notify('图片导入需要在 Tauri 桌面窗口中运行', 'info')
      return
    }
    setBusy(true)
    dismiss()
    try {
      const selected = await open({
        multiple: true,
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
      const paths = Array.isArray(selected) ? selected : [selected]
      const documents: SourceDocument[] = []
      for (const path of paths) {
        const media = await importImage(path)
        documents.push(await saveSourceDocument(media))
      }
      const document = documents.at(-1)
      if (!document) return
      setPreview(document)
      await refreshRecent()
      notify(
        documents.length > 1
          ? `${documents.length} 页图片已加入本地处理队列`
          : '图片已复制到 Axiom 本地资料库',
        'success',
      )
      stopCameraStream(stream)
      setStream(null)
      setCameraStatus('idle')
      if (documents.length === 1) setEditingDocument(document)
    } catch (error) {
      notify(`导入失败：${String(error)}`, 'error')
    } finally {
      setBusy(false)
    }
  }, [dismiss, notify, refreshRecent, stream])

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
    <main className="workspace capture-workspace">
      <PageHeader
        actions={<div className="runtime-pill">
          <span className={`status-dot ${capabilities ? 'online' : ''}`} />
          {capabilities
            ? '图片与题目数据保存在本机'
            : '正在准备采集…'}
        </div>}
        eyebrow="快速采集"
        title="添加错题"
      />

      <section className="capture-layout">
        <div className="capture-card">
          <SegmentedControl
            ariaLabel="采集方式"
            onChange={changeMode}
            options={[
              { value: 'camera', label: <><Icon name="camera" size={16} /> iPhone 相机</> },
              { value: 'import', label: <><Icon name="image" size={16} /> 导入图片</> },
            ]}
            value={mode}
          />

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
                    onLoadedMetadata={() => {
                      if (latestOrientationRef.current) {
                        applyOrientation(latestOrientationRef.current)
                      }
                    }}
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
                  <ListboxSelect
                    ariaLabel="选择摄像头"
                    disabled={cameraStatus === 'requesting'}
                    onValueChange={(value) => void switchCamera(value)}
                    options={devices.map((device) => ({ value: device.id, label: device.label }))}
                    value={selectedDeviceId}
                  />
                )}
                {stream && (
                  <>
                    <label className="continuous-capture-toggle">
                      <input
                        checked={continuousCapture}
                        disabled={busy}
                        onChange={(event) => setContinuousCapture(event.target.checked)}
                        type="checkbox"
                      />
                      连续多页
                    </label>
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
                      disabled={busy || !frameReady}
                      onClick={() => void captureFrame()}
                      title={frameReady ? '拍照' : '相机画面准备中'}
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
                    stopCameraStream(stream)
                    setStream(null)
                    setCameraStatus('idle')
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
        </aside>
      </section>

      <Toast toast={toast} />
    </main>
  )
}

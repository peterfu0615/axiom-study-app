import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from '../../components/Icon'
import { Button, Checkbox, InlineNotice } from '../../components/ui'
import type { PracticeScanPreview } from '../../domain/practiceAttempt'
import { userFacingError } from '../../domain/userFacingError'
import {
  captureVideoFrame,
  drawOrientedVideoFrame,
  openCameraStream,
  requestCameraDevices,
  stopCameraStream,
} from '../../platform/camera'
import { normalizeQuarterTurn, resolveDocumentRotation, type QuarterTurn } from '../../platform/cameraGeometry'
import {
  persistCameraFrame,
  previewPracticeScan,
  startCameraOrientationWatch,
} from '../../platform/native'
import {
  getPracticeSubmissionLayouts,
  type PracticeAnswerSubmission,
} from '../../platform/practiceAttemptDatabase'

async function canvasDataUrl(canvas: HTMLCanvasElement) {
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
    (value) => value ? resolve(value) : reject(new Error('无法编码实时取景帧')),
    'image/jpeg', .62,
  ))
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('无法读取实时取景帧'))
    reader.readAsDataURL(blob)
  })
}

export function PracticeSubmissionScanner({ practiceSetId, onCancel, onSubmit }: {
  practiceSetId: string
  onCancel: () => void
  onSubmit: (submissions: PracticeAnswerSubmission[]) => void
}) {
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [rotation, setRotation] = useState<QuarterTurn>(0)
  const [manualRotation, setManualRotation] = useState(false)
  const [preview, setPreview] = useState<PracticeScanPreview | null>(null)
  const [submissions, setSubmissions] = useState<PracticeAnswerSubmission[]>([])
  const [status, setStatus] = useState('正在连接相机…')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [autoCapture, setAutoCapture] = useState(true)
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const layoutsRef = useRef<Awaited<ReturnType<typeof getPracticeSubmissionLayouts>>['layouts']>([])
  const deviceLabelRef = useRef('')
  const submissionsRef = useRef<PracticeAnswerSubmission[]>([])
  const captureBusyRef = useRef(false)
  const stablePageRef = useRef<{
    pageId: string | null
    count: number
    captured: Set<string>
    lastPreview: PracticeScanPreview | null
  }>({ pageId: null, count: 0, captured: new Set(), lastPreview: null })

  useEffect(() => { submissionsRef.current = submissions }, [submissions])

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const [context, devices] = await Promise.all([getPracticeSubmissionLayouts(practiceSetId), requestCameraDevices()])
        if (!active) return
        layoutsRef.current = context.layouts
        const device = devices.find((item) => /iphone|continuity|连续互通/i.test(item.label)) ?? devices[0]
        if (!device) throw new Error('未发现可用相机')
        deviceLabelRef.current = device.label
        const next = await openCameraStream(device.id)
        if (!active) { stopCameraStream(next); return }
        setStream(next); setStatus('请将整张答题纸放入取景框')
      } catch (reason) {
        console.warn('连接练习拍摄相机失败', reason)
        if (active) {
          setError(userFacingError(
            reason,
            '无法连接相机。请确认相机已连接，并在 macOS“系统设置”中允许 Axiom 使用相机。',
          ))
        }
      }
    })()
    return () => { active = false }
  }, [practiceSetId])

  useEffect(() => {
    if (!videoRef.current) return
    videoRef.current.srcObject = stream
    void videoRef.current.play().catch(() => undefined)
    return () => stopCameraStream(stream)
  }, [stream])

  useEffect(() => {
    if (!stream || !deviceLabelRef.current || manualRotation) return
    let cleanup: (() => void) | null = null
    let active = true
    void startCameraOrientationWatch(deviceLabelRef.current, (update) => {
      const video = videoRef.current
      if (!active || !video?.videoWidth || !video.videoHeight) return
      setRotation(resolveDocumentRotation(
        update.rotationAngle,
        video.videoWidth,
        video.videoHeight,
        update.isContinuityCamera || /iphone|continuity|连续互通/i.test(deviceLabelRef.current),
      ))
    }).then((value) => { if (active) cleanup = value; else value() }).catch(() => undefined)
    return () => { active = false; cleanup?.() }
  }, [manualRotation, stream])

  useEffect(() => {
    if (!stream || !videoRef.current || !canvasRef.current) return
    const video = videoRef.current
    const canvas = canvasRef.current
    let frame = 0
    let active = true
    let recognizing = false
    let lastRecognition = 0
    const draw = (timestamp: number) => {
      if (!active) return
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth) {
        try { drawOrientedVideoFrame(video, canvas, rotation, 1100) } catch { /* transient camera frame */ }
        if (!recognizing && timestamp - lastRecognition >= 900 && canvas.width > 0) {
          recognizing = true; lastRecognition = timestamp
          void canvasDataUrl(canvas)
            .then((dataUrl) => previewPracticeScan(dataUrl, layoutsRef.current))
            .then((result) => {
              if (!active) return
              setPreview(result); setStatus(result.message)
            })
            .catch(() => undefined)
            .finally(() => { recognizing = false })
        }
      }
      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    return () => { active = false; cancelAnimationFrame(frame) }
  }, [rotation, stream])

  const capture = useCallback(async (target = preview) => {
    if (captureBusyRef.current || !videoRef.current || !target?.matched || !target.practiceDocumentPageId) return
    const pageId = target.practiceDocumentPageId
    if (submissionsRef.current.some((item) => item.practiceDocumentPageId === pageId)) {
      setError(`第 ${(target.pageIndex ?? 0) + 1} 页已经拍摄`); return
    }
    captureBusyRef.current = true
    stablePageRef.current.captured.add(pageId)
    setBusy(true); setError(null)
    try {
      const dataUrl = await captureVideoFrame(videoRef.current, rotation)
      const media = await persistCameraFrame(dataUrl)
      setSubmissions((current) => {
        if (current.some((item) => item.practiceDocumentPageId === pageId)) return current
        return [...current, {
          sourcePath: media.path,
          practiceDocumentPageId: pageId,
          submissionGroupId: crypto.randomUUID(),
          sourceKind: 'camera_scan',
          originalAssetPath: media.path,
          sourcePageIndex: 0,
          pageCount: 1,
          annotationsPreserved: false,
          liveDetectionConfidence: target.confidence,
        }]
      })
      setStatus(`第 ${(target.pageIndex ?? 0) + 1} 页已加入，继续拍下一页`)
    } catch (reason) {
      stablePageRef.current.captured.delete(pageId)
      console.warn('拍摄练习答题页失败', reason)
      setError(userFacingError(
        reason,
        '这一页没有拍摄成功，之前已拍摄的页面仍然保留。请重新对准后重试。',
      ))
    } finally {
      captureBusyRef.current = false
      setBusy(false)
    }
  }, [preview, rotation])

  useEffect(() => {
    if (stablePageRef.current.lastPreview === preview) return
    stablePageRef.current.lastPreview = preview
    if (!autoCapture || busy || !preview?.matched || !preview.practiceDocumentPageId) {
      if (!preview?.matched) { stablePageRef.current.pageId = null; stablePageRef.current.count = 0 }
      return
    }
    const pageId = preview.practiceDocumentPageId
    if (stablePageRef.current.pageId === pageId) stablePageRef.current.count += 1
    else { stablePageRef.current.pageId = pageId; stablePageRef.current.count = 1 }
    if (stablePageRef.current.count < 2 || stablePageRef.current.captured.has(pageId)) return
    void capture(preview)
  }, [autoCapture, busy, capture, preview])

  return <section className="practice-live-scanner">
    <div className="practice-live-scanner__stage">
      <video aria-hidden="true" className="practice-live-scanner__source" muted playsInline ref={videoRef} />
      <div className="practice-live-scanner__viewport">
        <canvas aria-label="实时作答页取景" ref={canvasRef} />
        {preview?.answerRegions.length ? <svg aria-hidden="true" preserveAspectRatio="none" viewBox="0 0 1 1">
          {preview.answerRegions.map((points, index) => <polygon key={index} points={points.map((point) => `${point.x},${point.y}`).join(' ')} />)}
        </svg> : null}
      </div>
      <div className={`practice-live-scanner__status${preview?.matched ? ' is-ready' : ''}`}>{status}</div>
    </div>
    <InlineNotice feedback={error ? { tone: 'danger', message: error } : null} onClose={() => setError(null)} />
    <div className="practice-live-scanner__pages">
      {submissions.map((submission, index) => <span key={submission.submissionGroupId}><Icon name="check" size={14} />第 {index + 1} 张</span>)}
      {!submissions.length && <span>尚未拍摄页面</span>}
    </div>
    <Checkbox checked={autoCapture} className="practice-live-scanner__auto" label="页面稳定后自动拍摄" onChange={(event) => setAutoCapture(event.target.checked)} />
    <div className="practice-live-scanner__actions">
      <Button disabled={busy} onClick={onCancel} variant="ghost">取消</Button>
      <Button disabled={busy} onClick={() => { setManualRotation(true); setRotation((value) => normalizeQuarterTurn(value + 90)) }} variant="ghost"><Icon name="rotate" size={16} />旋转</Button>
      <Button disabled={!preview?.matched || busy} loading={busy} onClick={() => void capture()} variant="secondary">拍摄这一页</Button>
      <Button disabled={!submissions.length || busy} onClick={() => onSubmit(submissions)} variant="primary">完成并开始批改</Button>
    </div>
  </section>
}

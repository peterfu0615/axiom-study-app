import { open } from '@tauri-apps/plugin-dialog'
import { useEffect, useRef, useState } from 'react'
import type { CurriculumImportJob, TextbookRecognition } from '../../domain/horizon'
import {
  Button,
  Dialog,
  EmptyState,
  ErrorState,
  FlowingTaskSurface,
  FileDropzone,
  IconButton,
  ListboxSelect,
  StatusBadge,
} from '../../components/ui'
import { classifyAIError } from '../../domain/aiError'
import { cancelTextbookImport, mediaAssetUrl } from '../../platform/native'
import type { TextbookExtractionProgress, TextbookOutlineCandidate } from '../../platform/native'
import {
  cancelCurriculumImportJob,
  confirmCurriculumImportJob,
  createCurriculumImportJob,
  prepareCurriculumImport,
  retryCurriculumImportJob,
  saveCurriculumImportOutline,
} from '../../platform/horizonDatabase'
import { useCurriculumAnalysisStatus } from './CurriculumAnalysisContext'
import { Icon } from '../../components/Icon'
import {
  curriculumAnalysisProgress,
  curriculumAnalysisStageLabel,
  isCurriculumAnalysisRunning,
} from './curriculumAnalysisStatus'

type ImportPhase = 'select' | 'preview' | 'processing' | 'confirm' | 'structure'

interface MetadataForm {
  title: string
  subject: string
  grade: string
  volume: string
  publisher: string
  edition: string
}

type RecognitionFieldKey = 'title' | 'subject' | 'grade' | 'volume' | 'publisher' | 'edition'

const fieldLabels: Array<[keyof MetadataForm, string, RecognitionFieldKey]> = [
  ['title', '教材名称', 'title'],
  ['subject', '科目', 'subject'],
  ['grade', '年级', 'grade'],
  ['volume', '册别', 'volume'],
  ['publisher', '出版社', 'publisher'],
  ['edition', '版本', 'edition'],
]

function formFromRecognition(recognition: TextbookRecognition | null, sourcePath: string): MetadataForm {
  const fallbackTitle = sourcePath.split(/[\\/]/u).filter(Boolean).at(-1)?.replace(/\.[^.]+$/u, '') || ''
  return {
    title: recognition?.title.value ?? fallbackTitle,
    subject: recognition?.subject.value ?? '',
    grade: recognition?.grade.value ?? '',
    volume: recognition?.volume.value ?? '',
    publisher: recognition?.publisher.value ?? '',
    edition: recognition?.edition.value ?? '',
  }
}

function sourceKind(sourcePath: string) {
  return /\.(png|jpe?g|webp)$/iu.test(sourcePath) ? 'image' : 'pdf'
}

export function CurriculumImportFlow({
  initialJobId,
  onBack,
  onCompleted,
  onManual,
}: {
  initialJobId?: string | null
  onBack: () => void
  onCompleted: (textbookId: string) => void
  onManual: () => void
}) {
  const {
    job: globalJob,
    publishJob,
    refresh: refreshGlobalJob,
  } = useCurriculumAnalysisStatus()
  const [phase, setPhase] = useState<ImportPhase>('select')
  const [sourcePath, setSourcePath] = useState('')
  const [createdJobId, setCreatedJobId] = useState<string | null>(null)
  const [form, setForm] = useState<MetadataForm>(() => formFromRecognition(null, ''))
  const [outline, setOutline] = useState<TextbookOutlineCandidate[]>([])
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false)
  const [extractionProgress, setExtractionProgress] = useState<TextbookExtractionProgress | null>(null)
  const hydratedJob = useRef<string | null>(null)
  const extractionRequestId = useRef<string | null>(null)
  const targetJobId = initialJobId ?? createdJobId
  const job: CurriculumImportJob | null = targetJobId && globalJob?.id === targetJobId
    ? globalJob : null

  useEffect(() => {
    if (!initialJobId) return
    if (!globalJob || globalJob.id !== initialJobId) {
      void refreshGlobalJob()
      return
    }
    setSourcePath(globalJob.originalSourcePath)
    setPhase(globalJob.status === 'waiting_for_review' ? 'confirm' : 'processing')
  }, [globalJob, initialJobId, refreshGlobalJob])

  useEffect(() => {
    if (!job || job.status !== 'waiting_for_review' || hydratedJob.current === job.id || !job.recognition) return
    hydratedJob.current = job.id
    setForm(formFromRecognition(job.recognition, job.sourcePath))
    setOutline(job.extraction?.outline ?? [])
    setPhase('confirm')
  }, [job])

  const selectSource = (path: string) => {
    setSourcePath(path)
    setForm(formFromRecognition(null, path))
    setCreatedJobId(null)
    setError(null)
    setPhase('preview')
  }

  const chooseFile = async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: '教材或目录图片', extensions: ['pdf', 'jpg', 'jpeg', 'png', 'webp'] }],
    })
    if (typeof selected === 'string') selectSource(selected)
  }

  const startRecognition = async () => {
    if (!sourcePath) return
    setSubmitting(true)
    setError(null)
    try {
      setPhase('processing')
      const requestId = crypto.randomUUID()
      extractionRequestId.current = requestId
      const imported = await prepareCurriculumImport(sourcePath, requestId, setExtractionProgress)
      extractionRequestId.current = null
      const finished = await createCurriculumImportJob(sourcePath, imported)
      if (finished) {
        setCreatedJobId(finished.id)
        publishJob(finished)
      }
    } catch (reason) {
      setError(String(reason))
      setPhase('preview')
    } finally {
      setSubmitting(false)
    }
  }

  const retry = async () => {
    if (!job) return
    setSubmitting(true)
    setError(null)
    try {
      setPhase('processing')
      const retryPromise = retryCurriculumImportJob(job.id)
      window.setTimeout(() => { void refreshGlobalJob() }, 60)
      const next = await retryPromise
      publishJob(next)
    } catch (reason) {
      setError(String(reason))
    } finally {
      setSubmitting(false)
    }
  }

  const cancel = async () => {
    setCancelConfirmOpen(false)
    setSubmitting(true)
    setError(null)
    try {
      if (extractionRequestId.current) {
        await cancelTextbookImport(extractionRequestId.current)
        extractionRequestId.current = null
      }
      if (job) await cancelCurriculumImportJob(job.id)
      publishJob(null)
      onBack()
    } catch (reason) {
      setError(String(reason))
    } finally {
      setSubmitting(false)
    }
  }

  const continueToStructure = () => {
    if (!form.title.trim() || !form.subject.trim()) {
      setError('请确认教材名称和科目后继续。')
      return
    }
    setError(null)
    setPhase('structure')
  }

  const confirmStructure = async () => {
    if (!job) return
    setSaving(true)
    setError(null)
    try {
      await saveCurriculumImportOutline(job.id, outline)
      const textbookId = await confirmCurriculumImportJob(job.id, form)
      onCompleted(textbookId)
    } catch (reason) {
      setError(String(reason))
    } finally {
      setSaving(false)
    }
  }

  const step = phase === 'select' ? 1 : phase === 'preview' ? 2 : phase === 'processing' ? 3 : phase === 'confirm' ? 4 : 5

  return (
    <main className="workspace curriculum-workspace curriculum-import-workspace curriculum-task-page">
      <header className="workspace-header curriculum-page-header">
        <div>
          <p className="eyebrow">课程</p>
          <h1>导入教材</h1>
          <p className="subtitle">先在本地识别带页码全文，再由 AI 分析结构与候选标签。</p>
        </div>
        <Button onClick={onBack} variant="ghost">返回课程</Button>
      </header>

      <div className="curriculum-task-safe-area">
      {!(phase === 'processing' && job) && <ol className="curriculum-import-steps" aria-label="教材导入步骤">
        {['选择文件', '文件预览', 'AI 识别', '确认教材信息', '检查课程结构'].map((label, index) => (
          <li className={index + 1 === step ? 'is-active' : index + 1 < step ? 'is-complete' : ''} key={label}>
            <span>{index + 1}</span>{label}
          </li>
        ))}
      </ol>}

      {error && <div className="curriculum-inline-error" role="alert"><span>{error}</span><IconButton label="关闭提示" onClick={() => setError(null)}><Icon name="close" size={14} /></IconButton></div>}

      {phase === 'select' && (
        <section className="curriculum-import-card">
          <FileDropzone
            accept=".pdf,.jpg,.jpeg,.png,.webp"
            onFiles={(files) => {
              const nativePath = (files[0] as File & { path?: string } | undefined)?.path
              if (nativePath) selectSource(nativePath)
              else setError('请使用“从 Finder 选择”导入文件。')
            }}
          >
            <span className="curriculum-drop-icon">⌑</span>
            <strong>拖入 PDF 或目录图片</strong>
            <small>支持文字版 PDF、扫描版 PDF、JPG、PNG 和 WebP</small>
          </FileDropzone>
          <div className="curriculum-import-card__actions">
            <Button onClick={() => void chooseFile()} variant="primary">从 Finder 选择</Button>
            <Button onClick={onManual} variant="ghost">手动创建课程</Button>
          </div>
        </section>
      )}

      {phase === 'preview' && sourcePath && (
        <section className="curriculum-import-card curriculum-file-preview">
          <div className="curriculum-file-preview__visual">
            {sourceKind(sourcePath) === 'image'
              ? <img alt="待导入的目录图片" src={mediaAssetUrl(sourcePath)} />
              : <object aria-label="待导入教材 PDF 预览" data={mediaAssetUrl(sourcePath)} type="application/pdf"><span>PDF 教材</span></object>}
          </div>
          <div className="curriculum-file-preview__details">
            <StatusBadge tone="brand">{sourceKind(sourcePath) === 'image' ? '目录图片' : 'PDF 教材'}</StatusBadge>
            <h2>{sourcePath.split(/[\\/]/u).filter(Boolean).at(-1)}</h2>
            <p>确认文件后，Axiom 会先提取文字与目录，再识别科目、版本等信息。你可以在下一步中校正结果。</p>
            <div className="curriculum-import-card__actions">
              <Button loading={submitting} onClick={() => void startRecognition()} variant="primary">开始识别</Button>
              <Button onClick={() => setPhase('select')}>重新选择</Button>
            </div>
          </div>
        </section>
      )}

      {phase === 'processing' && !job && (
        <FlowingTaskSurface
          actions={<Button onClick={() => setCancelConfirmOpen(true)} variant="ghost">取消</Button>}
          detail={extractionProgress
            ? `第 ${extractionProgress.currentPage}/${extractionProgress.totalPages} 页 · PDF 文字 ${extractionProgress.pdfTextPages} 页 · OCR ${extractionProgress.ocrPages} 页${extractionProgress.failedPages > 0 ? ` · 失败 ${extractionProgress.failedPages} 页` : ''}`
            : '正在流式复制、校验文件并启动提取器'}
          progress={extractionProgress?.totalPages
            ? extractionProgress.currentPage / extractionProgress.totalPages
            : null}
          progressCurrent={extractionProgress?.currentPage}
          progressLabel="本地全文识别"
          progressTotal={extractionProgress?.totalPages}
          state="running"
          title="正在本地提取教材全文"
          widthMode="full"
        />
      )}

      {phase === 'processing' && job && isCurriculumAnalysisRunning(job) && (
        <FlowingTaskSurface
          actions={<button className="curriculum-analysis-cancel" onClick={() => setCancelConfirmOpen(true)} type="button">取消分析</button>}
          detail={job.progressLabel && job.progressLabel !== curriculumAnalysisStageLabel(job) ? job.progressLabel : null}
          progress={curriculumAnalysisProgress(job)}
          progressCurrent={job.progressCurrent}
          progressLabel={job.progressLabel || curriculumAnalysisStageLabel(job)}
          progressTotal={job.progressTotal}
          state="running"
          title={curriculumAnalysisStageLabel(job)}
          widthMode="full"
        />
      )}

      {job?.status === 'ai_failed_recoverable' && (
        <ErrorState
          error={job.error ?? classifyAIError(job.errorMessage || '请检查文件后重试。')}
          onRetry={submitting ? undefined : () => void retry()}
          secondaryAction={<Button onClick={() => setCancelConfirmOpen(true)} variant="ghost">放弃分析</Button>}
        />
      )}

      {phase === 'confirm' && job?.recognition && (
        <section className="curriculum-import-card curriculum-metadata-form">
          <div className="curriculum-section-heading"><div><h2>确认教材信息</h2><p>请检查自动填写的信息；缺少内容的字段需要补充。</p></div><StatusBadge tone="warning">待确认</StatusBadge></div>
          <div className="curriculum-metadata-grid">
            {fieldLabels.map(([key, label, recognitionKey]) => {
              const recognition = job.recognition?.[recognitionKey]
              const needsReview = !recognition?.value
              return <label className={needsReview ? 'needs-review' : ''} key={key}><span>{label}{needsReview && <em>请确认</em>}</span><input onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))} value={form[key]} />{recognition?.evidence && <small>{recognition.evidence}</small>}</label>
            })}
          </div>
          {job.recognition.warnings.length > 0 && <p className="curriculum-form-warning">{job.recognition.warnings.join(' ')}</p>}
          <div className="curriculum-import-card__actions"><Button onClick={continueToStructure} variant="primary">检查课程结构</Button><Button onClick={onBack} variant="ghost">稍后继续</Button></div>
        </section>
      )}

      {phase === 'structure' && job?.extraction && (
        <section className="curriculum-import-card curriculum-outline-review">
          <div className="curriculum-section-heading"><div><h2>检查课程结构</h2><p>已识别 {job.extraction.pageCount} 页、{outline.length} 个目录节点。你可以直接修改名称与层级。</p></div><StatusBadge tone="warning">待确认</StatusBadge></div>
          <div className="curriculum-outline-list">
            {outline.map((item, index) => (
              <div className="curriculum-outline-row" key={`${item.title}-${index}`}>
                <ListboxSelect
                  ariaLabel={`${item.title} 的层级`}
                  className="curriculum-outline-level"
                  onValueChange={(value) => setOutline((items) => items.map((current, currentIndex) => currentIndex === index ? { ...current, level: Number(value) } : current))}
                  options={[{ value: '1', label: '章节/单元' }, { value: '2', label: '知识点' }]}
                  value={String(item.level > 1 ? 2 : 1)}
                />
                <input aria-label="目录名称" onChange={(event) => setOutline((items) => items.map((current, currentIndex) => currentIndex === index ? { ...current, title: event.target.value } : current))} value={item.title} />
                <small>p.{item.pageNumber}</small>
              </div>
            ))}
            {!outline.length && <EmptyState description="没有检测到清晰目录。你仍可以先使用空课程，再手动补充章节和知识点。" title="目录需要手动建立" />}
          </div>
          {job.extraction.warnings.length > 0 && <p className="curriculum-form-warning">{job.extraction.warnings.join(' ')}</p>}
          {saving
            ? <FlowingTaskSurface compact detail="正在保存教材、知识结构和候选标签" state="running" title="正在保存课程" widthMode="full" />
            : <div className="curriculum-import-card__actions"><Button loading={saving} onClick={() => void confirmStructure()} variant="primary">使用此课程结构</Button><Button onClick={() => setPhase('confirm')}>返回教材信息</Button></div>}
        </section>
      )}
      </div>

      <Dialog onClose={() => setCancelConfirmOpen(false)} open={cancelConfirmOpen} title="取消教材分析">
        <div className="curriculum-dialog-form">
          <p>取消后将清理本次分析的断点和临时数据，不会删除原始 PDF。</p>
          <div className="curriculum-dialog-actions">
            <Button onClick={() => setCancelConfirmOpen(false)} variant="ghost">暂不取消</Button>
            <Button loading={submitting} onClick={() => void cancel()} variant="secondary">确认取消</Button>
          </div>
        </div>
      </Dialog>
    </main>
  )
}

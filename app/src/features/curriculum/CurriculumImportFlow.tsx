import { open } from '@tauri-apps/plugin-dialog'
import { useEffect, useRef, useState } from 'react'
import type { CurriculumImportJob, TextbookRecognition } from '../../domain/horizon'
import {
  Button,
  EmptyState,
  FileDropzone,
  IconButton,
  Progress,
  StatusBadge,
} from '../../components/ui'
import { mediaAssetUrl } from '../../platform/native'
import type { TextbookOutlineCandidate } from '../../platform/native'
import {
  cancelCurriculumImportJob,
  confirmCurriculumImportJob,
  createCurriculumImportJob,
  getCurriculumImportJob,
  retryCurriculumImportJob,
  saveCurriculumImportOutline,
} from '../../platform/horizonDatabase'
import { startCurriculumImport } from './importCoordinator'

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

function stageLabel(job: CurriculumImportJob) {
  if (job.status === 'extracting') return '正在读取教材文本与目录'
  if (job.status === 'recognizing') return '正在识别教材信息'
  if (job.status === 'failed') return '识别暂时失败'
  return '正在准备教材'
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
  const [phase, setPhase] = useState<ImportPhase>('select')
  const [sourcePath, setSourcePath] = useState('')
  const [job, setJob] = useState<CurriculumImportJob | null>(null)
  const [form, setForm] = useState<MetadataForm>(() => formFromRecognition(null, ''))
  const [outline, setOutline] = useState<TextbookOutlineCandidate[]>([])
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const hydratedJob = useRef<string | null>(null)

  useEffect(() => {
    if (!initialJobId) return
    void getCurriculumImportJob(initialJobId).then((next) => {
      if (next) {
        setJob(next)
        setSourcePath(next.sourcePath)
        if (['pending', 'extracting', 'recognizing', 'failed'].includes(next.status)) {
          setPhase('processing')
        } else if (next.stage === 'review_structure') {
          setPhase('structure')
        } else if (next.status === 'needs_review') {
          setPhase('confirm')
        }
      }
    })
  }, [initialJobId])

  useEffect(() => {
    if (!job || !['extracting', 'recognizing', 'pending'].includes(job.status)) return undefined
    const timer = window.setInterval(() => {
      void getCurriculumImportJob(job.id).then((next) => next && setJob(next))
    }, 900)
    return () => window.clearInterval(timer)
  }, [job])

  useEffect(() => {
    if (!job || job.status !== 'needs_review' || hydratedJob.current === job.id || !job.recognition) return
    hydratedJob.current = job.id
    setForm(formFromRecognition(job.recognition, job.sourcePath))
    setOutline(job.extraction?.outline ?? [])
    setPhase(job.stage === 'review_structure' ? 'structure' : 'confirm')
  }, [job])

  const selectSource = (path: string) => {
    setSourcePath(path)
    setForm(formFromRecognition(null, path))
    setJob(null)
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
      const created = await createCurriculumImportJob(sourcePath)
      setJob(created)
      setPhase('processing')
      const finished = await startCurriculumImport(created.id)
      if (finished) setJob(finished)
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
      const next = await retryCurriculumImportJob(job.id)
      if (next) {
        setJob(next)
        setPhase('processing')
      }
    } catch (reason) {
      setError(String(reason))
    } finally {
      setSubmitting(false)
    }
  }

  const cancel = async () => {
    if (job) await cancelCurriculumImportJob(job.id)
    onBack()
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
    setSubmitting(true)
    setError(null)
    try {
      await saveCurriculumImportOutline(job.id, outline)
      const textbookId = await confirmCurriculumImportJob(job.id, form)
      onCompleted(textbookId)
    } catch (reason) {
      setError(String(reason))
    } finally {
      setSubmitting(false)
    }
  }

  const step = phase === 'select' ? 1 : phase === 'preview' ? 2 : phase === 'processing' ? 3 : phase === 'confirm' ? 4 : 5

  return (
    <main className="workspace curriculum-workspace curriculum-import-workspace">
      <header className="workspace-header curriculum-page-header">
        <div>
          <p className="eyebrow">课程</p>
          <h1>导入教材</h1>
          <p className="subtitle">导入后，Axiom 会先识别教材信息与目录，再由你确认课程结构。</p>
        </div>
        <Button onClick={onBack} variant="ghost">返回课程</Button>
      </header>

      <ol className="curriculum-import-steps" aria-label="教材导入步骤">
        {['选择文件', '文件预览', 'AI 识别', '确认教材信息', '检查课程结构'].map((label, index) => (
          <li className={index + 1 === step ? 'is-active' : index + 1 < step ? 'is-complete' : ''} key={label}>
            <span>{index + 1}</span>{label}
          </li>
        ))}
      </ol>

      {error && <div className="curriculum-inline-error" role="alert"><span>{error}</span><IconButton label="关闭提示" onClick={() => setError(null)}>×</IconButton></div>}

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

      {phase === 'processing' && job && ['pending', 'extracting', 'recognizing'].includes(job.status) && (
        <section className="curriculum-import-card curriculum-import-processing">
          <span className="ax-spinner" />
          <h2>{stageLabel(job)}</h2>
          <p>任务会在后台继续。你现在可以返回课程，稍后从教材导入入口继续查看。</p>
          <Progress
            detail={job.status === 'extracting' ? '正在提取内容' : '正在整理教材信息'}
            label={job.status === 'extracting' ? '读取教材' : '识别教材信息'}
            value={job.status === 'extracting' ? 42 : 76}
          />
          <div className="curriculum-import-card__actions"><Button onClick={onBack}>后台继续</Button><Button onClick={() => void cancel()} variant="ghost">取消导入</Button></div>
        </section>
      )}

      {job?.status === 'failed' && (
        <section className="curriculum-import-card curriculum-import-processing curriculum-import-processing--error">
          <h2>这次识别没有完成</h2>
          <p>{job.errorMessage || '请检查文件后重试。'}</p>
          <div className="curriculum-import-card__actions"><Button loading={submitting} onClick={() => void retry()} variant="primary">重试</Button><Button onClick={() => setPhase('select')}>重新选择文件</Button></div>
        </section>
      )}

      {phase === 'confirm' && job?.recognition && (
        <section className="curriculum-import-card curriculum-metadata-form">
          <div className="curriculum-section-heading"><div><h2>确认教材信息</h2><p>通常只需确认。标记为“请确认”的字段来自低置信度识别。</p></div><StatusBadge tone={job.recognition.overallConfidence >= .72 ? 'success' : 'warning'}>{Math.round(job.recognition.overallConfidence * 100)}% 识别可信度</StatusBadge></div>
          <div className="curriculum-metadata-grid">
            {fieldLabels.map(([key, label, recognitionKey]) => {
              const recognition = job.recognition?.[recognitionKey]
              const needsReview = !recognition?.value || recognition.confidence < .72
              return <label className={needsReview ? 'needs-review' : ''} key={key}><span>{label}{needsReview && <em>请确认</em>}</span><input onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))} value={form[key]} />{recognition?.evidence && <small>{recognition.evidence}</small>}</label>
            })}
          </div>
          {job.recognition.warnings.length > 0 && <p className="curriculum-form-warning">{job.recognition.warnings.join(' ')}</p>}
          <div className="curriculum-import-card__actions"><Button onClick={continueToStructure} variant="primary">检查课程结构</Button><Button onClick={onBack} variant="ghost">稍后继续</Button></div>
        </section>
      )}

      {phase === 'structure' && job?.extraction && (
        <section className="curriculum-import-card curriculum-outline-review">
          <div className="curriculum-section-heading"><div><h2>检查课程结构</h2><p>已识别 {job.extraction.pageCount} 页、{outline.length} 个目录节点。你可以直接修改名称与层级。</p></div><StatusBadge tone="warning">{outline.filter((item) => item.confidence < .72).length} 项待确认</StatusBadge></div>
          <div className="curriculum-outline-list">
            {outline.map((item, index) => (
              <div className="curriculum-outline-row" key={`${item.title}-${index}`}>
                <select aria-label={`${item.title} 的层级`} onChange={(event) => setOutline((items) => items.map((current, currentIndex) => currentIndex === index ? { ...current, level: Number(event.target.value) } : current))} value={item.level}>
                  <option value={1}>章</option><option value={2}>节</option><option value={3}>知识点</option>
                </select>
                <input aria-label="目录名称" onChange={(event) => setOutline((items) => items.map((current, currentIndex) => currentIndex === index ? { ...current, title: event.target.value } : current))} value={item.title} />
                <small>p.{item.pageNumber} · {Math.round(item.confidence * 100)}%</small>
              </div>
            ))}
            {!outline.length && <EmptyState description="没有检测到清晰目录。你仍可以先使用空课程，再手动补充章节和知识点。" title="目录需要手动建立" />}
          </div>
          <div className="curriculum-import-card__actions"><Button loading={submitting} onClick={() => void confirmStructure()} variant="primary">使用此课程结构</Button><Button onClick={() => setPhase('confirm')}>返回教材信息</Button></div>
        </section>
      )}
    </main>
  )
}

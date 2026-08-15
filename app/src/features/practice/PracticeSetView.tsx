import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { open, save } from '@tauri-apps/plugin-dialog'
import { Icon } from '../../components/Icon'
import { MathMarkdown } from '../../components/MathMarkdown'
import { Badge, Button, FlowingTaskSurface, IconButton, InlineNotice, PageHeader, SegmentedControl, StatusBadge, type Feedback } from '../../components/ui'
import type { PracticeItem, PracticeSet } from '../../domain/practice'
import type { PracticeAttempt, PracticeCapturedResponse } from '../../domain/practiceAttempt'
import type { PracticeLoop } from '../../domain/practiceLoop'
import { importImage, mediaAssetUrl, preparePracticeSubmission, renderPracticePdfPage, type PracticePdfPagePreview } from '../../platform/native'
import {
  openExportedPracticePdf,
  practiceDocumentDiagnostic,
  preparePracticeDocument,
  printExportedPracticePdf,
  saveExportedPracticePdf,
  type PracticeDocumentDiagnostic,
  type PracticeDocumentRecord,
} from '../../platform/practiceDocumentDatabase'
import { capturePracticeAnswerSheet, getLatestPracticeAttempt } from '../../platform/practiceAttemptDatabase'
import { correctAndRegradePracticeResponse, extractAndGradePracticeAttempt, overridePracticeGrade } from '../../platform/practiceGradingDatabase'
import { finalizePracticeAttempt, getPracticeLoopForSet } from '../../platform/practiceLoopDatabase'
import { getPracticeSet } from '../../platform/practiceDatabase'
import { practiceErrorMessage } from './productLanguage'
import { shouldAutoPreparePracticeDocument, type PracticeDocumentState } from './practiceDocumentState'
import './PracticeSetView.css'

type PracticePdfSection = 'exercise' | 'solution'

const documentTabs: Array<{ value: PracticePdfSection; label: string }> = [
  { value: 'exercise', label: '练习' },
  { value: 'solution', label: '解析' },
]

function ResultCorrection({ response, item, onChange, onError }: {
  response: PracticeCapturedResponse
  item: PracticeItem
  onChange: (response: PracticeCapturedResponse) => void
  onError: (reason: unknown) => void
}) {
  const [answer, setAnswer] = useState(response.extractedAnswer?.rawMarkdown ?? '')
  const [busy, setBusy] = useState(false)
  useEffect(() => { setAnswer(response.extractedAnswer?.rawMarkdown ?? '') }, [response.extractedAnswer?.rawMarkdown])
  const regrade = async () => {
    setBusy(true)
    try {
      const result = await correctAndRegradePracticeResponse(response.regionId, item, answer)
      onChange({ ...response, extractedAnswer: result.answer, gradingResult: result.grading })
    } catch (reason) { onError(reason) }
    finally { setBusy(false) }
  }
  const override = async (correctness: 'correct' | 'incorrect') => {
    setBusy(true)
    try { onChange({ ...response, gradingResult: await overridePracticeGrade(response.regionId, correctness) }) }
    catch (reason) { onError(reason) }
    finally { setBusy(false) }
  }
  return <details className="practice-result__correction">
    <summary>修改识别或批改</summary>
    <div className="practice-result__correction-body">
      <img alt={`第 ${item.orderIndex + 1} 题作答区域`} src={mediaAssetUrl(response.answerAssetPath)} />
      <label>识别到的作答<textarea aria-label={`第 ${item.orderIndex + 1} 题识别结果`} onChange={(event) => setAnswer(event.target.value)} value={answer} /></label>
      <div>
        <Button disabled={busy || !answer.trim()} onClick={() => void regrade()} variant="secondary">按修改内容重新批改</Button>
        <Button disabled={busy} onClick={() => void override('correct')} variant="ghost">标为正确</Button>
        <Button disabled={busy} onClick={() => void override('incorrect')} variant="ghost">标为错误</Button>
      </div>
    </div>
  </details>
}

function ResultItem({ item, response, onChange, onError }: {
  item: PracticeItem
  response: PracticeCapturedResponse
  onChange: (response: PracticeCapturedResponse) => void
  onError: (reason: unknown) => void
}) {
  const result = response.gradingResult
  const tone = result?.correctness === 'correct' ? 'success' : result?.correctness === 'needs_review' || !result ? 'warning' : 'danger'
  const label = result?.correctness === 'correct' ? '正确' : result?.correctness === 'partial' ? '部分正确' : result?.correctness === 'incorrect' ? '错误' : '需要检查'
  const tags = item.targetTags.filter((tag) => tag.type !== 'error').slice(0, 3)
  return <article className="practice-result-item">
    <header><strong>第 {item.orderIndex + 1} 题</strong><StatusBadge tone={tone}>{label}</StatusBadge></header>
    <MathMarkdown className="practice-result-item__question">{item.statementMarkdown}</MathMarkdown>
    <dl>
      <div><dt>你的作答</dt><dd><MathMarkdown>{response.extractedAnswer?.rawMarkdown || '未识别到清晰作答'}</MathMarkdown></dd></div>
      <div><dt>参考答案</dt><dd><MathMarkdown>{item.canonicalAnswer}</MathMarkdown></dd></div>
    </dl>
    {result?.explanation && <p className="practice-result-item__explanation">{result.explanation}</p>}
    {tags.length > 0 && <div className="practice-result-item__tags"><span>相关知识</span>{tags.map((tag) => <Badge key={tag.id || tag.name}>{tag.name}</Badge>)}</div>}
    <ResultCorrection item={item} onChange={onChange} onError={onError} response={response} />
  </article>
}

export function PracticeSetView({ practiceSet, onBack, onOpenPracticeSet, initialAttempt, initialMode }: {
  practiceSet: PracticeSet
  onBack: () => void
  onOpenPracticeSet?: (practiceSet: PracticeSet) => void
  initialAttempt?: PracticeAttempt
  initialMode?: 'ready' | 'results'
}) {
  const [selectedSection, setSelectedSection] = useState<PracticePdfSection>('exercise')
  const [document, setDocument] = useState<PracticeDocumentRecord | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [pagePreview, setPagePreview] = useState<PracticePdfPagePreview | null>(null)
  const [documentState, setDocumentState] = useState<PracticeDocumentState>('idle')
  const [mode, setMode] = useState<'ready' | 'submit' | 'processing' | 'results'>(initialMode ?? 'ready')
  const [processingStep, setProcessingStep] = useState({ title: '正在读取作答', detail: '正在安全导入文件…', progress: .12 })
  const [attempt, setAttempt] = useState<PracticeAttempt | null>(initialAttempt ?? null)
  const [loop, setLoop] = useState<PracticeLoop | null>(null)
  const [attemptLoaded, setAttemptLoaded] = useState(Boolean(initialAttempt))
  const [finalizing, setFinalizing] = useState(false)
  const [feedback, setFeedback] = useState<Feedback>(null)
  const [documentDiagnostic, setDocumentDiagnostic] = useState<PracticeDocumentDiagnostic | null>(null)
  const documentRequest = useRef<Promise<PracticeDocumentRecord> | null>(null)

  useEffect(() => {
    let cancelled = false
    documentRequest.current = null
    setDocument(null); setSelectedSection('exercise'); setCurrentPage(1); setPagePreview(null); setDocumentState('idle'); setFeedback(null); setDocumentDiagnostic(null)
    setAttempt(initialAttempt ?? null); setMode(initialMode ?? 'ready'); setAttemptLoaded(Boolean(initialAttempt))
    if (!initialAttempt) {
      void getLatestPracticeAttempt(practiceSet.id).then((latest) => {
        if (!cancelled) {
          setAttempt(latest); setAttemptLoaded(true)
          if (latest?.responses.some((response) => response.gradingResult)) setMode('results')
        }
      }).catch(() => null)
    }
    // PracticeLoop is supplementary data and must not delay the result render.
    void getPracticeLoopForSet(practiceSet.id).then((recoveredLoop) => {
      if (!cancelled) setLoop(recoveredLoop)
    }).catch(() => null)
    return () => { cancelled = true }
  }, [initialAttempt, initialMode, practiceSet])

  useEffect(() => {
    if (!document) return undefined
    let cancelled = false
    setPagePreview(null)
    void renderPracticePdfPage(document.filePath, currentPage)
      .then((preview) => { if (!cancelled) setPagePreview(preview) })
      .catch((reason) => { if (!cancelled) setFeedback({ tone: 'danger', message: practiceErrorMessage(reason) }) })
    return () => { cancelled = true }
  }, [currentPage, document])

  const ensureDocument = useCallback(async () => {
    if (document) return document
    if (documentRequest.current) return documentRequest.current
    setDocumentState('loading')
    setFeedback(null)
    const request = (async () => {
      try {
        const record = await preparePracticeDocument(practiceSet)
        setDocument(record)
        setDocumentDiagnostic(null)
        setDocumentState('ready')
        return record
      } catch (reason) {
        setDocumentState('error')
        setDocumentDiagnostic(practiceDocumentDiagnostic(reason, practiceSet.id))
        // The stage owns the retry affordance; avoid repeating the same error
        // in a second global notice above the preview.
        setFeedback(null)
        throw reason
      } finally {
        documentRequest.current = null
      }
    })()
    documentRequest.current = request
    return request
  }, [document, practiceSet])
  useEffect(() => {
    if (!shouldAutoPreparePracticeDocument({ attemptLoaded, mode, hasDocument: Boolean(document), documentState })) return
    void ensureDocument().catch(() => null)
  }, [attemptLoaded, mode, document, documentState, ensureDocument])
  const retryDocument = () => {
    setDocumentState('idle')
    setFeedback(null)
    setDocumentDiagnostic(null)
    void ensureDocument().catch(() => null)
  }
  const chooseSection = (section: PracticePdfSection) => {
    setSelectedSection(section)
    if (document) setCurrentPage(document.sectionPageRanges[section].startPage)
  }
  const saveCurrent = async () => {
    const record = document ?? await ensureDocument()
    const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(practiceSet.createdAt)
    const safeSubject = practiceSet.subject.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, '').slice(0, 24) || '练习'
    const destination = await save({
      defaultPath: `Axiom-${safeSubject}练习-${date}.pdf`,
      filters: [{ name: 'PDF 文档', extensions: ['pdf'] }],
    })
    if (!destination) return
    await saveExportedPracticePdf(record, destination)
    setFeedback({ tone: 'success', message: 'PDF 已保存。' })
  }
  const printCurrent = async () => {
    const record = document ?? await ensureDocument()
    await printExportedPracticePdf(record)
    const exercise = record.sectionPageRanges.exercise
    setFeedback({
      tone: 'success',
      message: `已在系统预览中打开。打印作答页请选择第 ${exercise.startPage}–${exercise.endPage} 页；如需解析，可打印完整文档。`,
    })
  }
  const submitAnswer = async () => {
    setFeedback(null)
    await ensureDocument()
    const selected = await open({ directory: false, multiple: false })
    if (typeof selected !== 'string') return
    if (!/\.(?:pdf|jpe?g|png|heic)$/iu.test(selected)) {
      setMode('submit')
      setFeedback({ tone: 'danger', message: '请选择 PDF、JPG、PNG 或 HEIC 作答文件。' })
      return
    }
    setMode('processing')
    try {
      setProcessingStep({ title: '正在读取作答', detail: '正在安全导入文件…', progress: .12 })
      const sourcePath = selected.toLowerCase().endsWith('.pdf')
        ? await preparePracticeSubmission(selected)
        : (await importImage(selected)).path
      setProcessingStep({ title: '正在匹配练习', detail: '正在识别页面并校正拍摄角度…', progress: .38 })
      const captured = await capturePracticeAnswerSheet(practiceSet.id, sourcePath)
      setAttempt(captured)
      setProcessingStep({ title: '正在读取答案', detail: `已找到 ${captured.responses.length} 个作答区域…`, progress: .64 })
      setProcessingStep({ title: '正在批改', detail: '正在逐题核对答案与关键步骤…', progress: .82 })
      const graded = await extractAndGradePracticeAttempt(practiceSet, captured)
      if (!graded) throw new Error('批改完成后无法读取结果')
      setAttempt(graded); setMode('results')
    } catch (reason) {
      setMode('submit'); setFeedback({ tone: 'danger', message: practiceErrorMessage(reason) })
    }
  }
  const updateResponse = (updated: PracticeCapturedResponse) => setAttempt((current) => current ? {
    ...current, responses: current.responses.map((response) => response.regionId === updated.regionId ? updated : response),
  } : current)
  const canFinalize = Boolean(attempt?.responses.length && attempt.responses.every((response) =>
    response.gradingResult && response.gradingResult.correctness !== 'needs_review'))
  const finalize = async () => {
    if (!attempt) return
    setFinalizing(true); setFeedback(null)
    try {
      const nextLoop = await finalizePracticeAttempt(practiceSet, attempt)
      setLoop(nextLoop); setAttempt({ ...attempt, status: 'completed', submittedAt: Date.now() })
    } catch (reason) { setFeedback({ tone: 'danger', message: practiceErrorMessage(reason) }) }
    finally { setFinalizing(false) }
  }
  const openNextRound = async () => {
    if (!loop?.nextPracticeSetId || !onOpenPracticeSet) return
    const next = await getPracticeSet(loop.nextPracticeSetId)
    if (next) onOpenPracticeSet(next)
  }

  const results = useMemo(() => attempt?.responses.flatMap((response) => response.gradingResult ? [response.gradingResult] : []) ?? [], [attempt])
  const correct = results.filter((result) => result.correctness === 'correct').length
  const score = results.length ? Math.round(results.reduce((sum, result) => sum + (result.score ?? 0), 0) / results.length) : 0
  const needsWork = results.filter((result) => result.correctness !== 'correct').length

  if (mode === 'processing') return <main className="workspace practice-workspace practice-processing">
    <FlowingTaskSurface detail={processingStep.detail} progress={processingStep.progress} progressLabel="自动处理作答" state="running" title={processingStep.title} widthMode="full">
      <p className="practice-processing__note">请保持 Axiom 打开，处理完成后会自动显示逐题结果。</p>
    </FlowingTaskSurface>
  </main>

  if (mode === 'results' && attempt) return <main className="workspace practice-workspace">
    <PageHeader
      className="practice-header practice-header--result"
      eyebrow="练习结果"
      leading={<IconButton appearance="plain" label="返回今日学习" onClick={onBack}><Icon name="chevron" size={20} /></IconButton>}
      summary={`${practiceSet.subject} · ${practiceSet.items.length} 题`}
      title="本次练习"
    />
    <InlineNotice feedback={feedback} onClose={() => setFeedback(null)} />
    <section className="practice-result-summary">
      <div><span>得分</span><strong>{score}</strong><small>/ 100</small></div>
      <div><span>答对</span><strong>{correct}</strong><small>/ {results.length}</small></div>
      <div><span>需要巩固</span><strong>{needsWork}</strong><small>题</small></div>
    </section>
    <section className="practice-results" aria-label="逐题结果">
      {attempt.responses.map((response) => {
        const item = practiceSet.items.find((candidate) => candidate.id === response.practiceItemId)
        return item ? <ResultItem item={item} key={response.regionId} onChange={updateResponse} onError={() => setFeedback({ tone: 'danger', message: '未能保存这次批改修改，请重试。' })} response={response} /> : null
      })}
    </section>
    <section className="practice-result-next">
      {attempt.status !== 'completed' ? <>
        <div><h2>{canFinalize ? '确认本次结果' : '还有结果需要检查'}</h2><p>{canFinalize ? '确认后将自动更新学习进度并安排后续练习。' : '请先修改或确认标记为“需要检查”的题目。'}</p></div>
        <Button disabled={!canFinalize || finalizing} loading={finalizing} onClick={() => void finalize()} variant="primary">确认结果</Button>
      </> : loop?.status === 'active' && loop.nextPracticeSetId && loop.nextPracticeSetId !== practiceSet.id ? <>
        <div><h2>这部分还需要巩固</h2><p>下一组会换一批题，继续练习刚才没有掌握的内容。</p></div>
        <Button onClick={() => void openNextRound()} variant="primary">再练一组</Button>
      </> : <>
        <div><h2>本轮练习完成</h2><p>后续学习已经根据本次结果自动安排。</p></div>
        <Button onClick={onBack} variant="primary">完成</Button>
      </>}
    </section>
  </main>

  return <main className="workspace practice-workspace">
    <PageHeader
      actions={<div className="practice-header__actions">
        <Button disabled={!document || documentState === 'loading'} onClick={() => void saveCurrent()} variant="secondary"><Icon name="download" size={16} /> 保存 PDF</Button>
        <Button disabled={!document || documentState === 'loading'} onClick={() => void printCurrent()} variant="secondary"><Icon name="print" size={16} /> 打印</Button>
        <Button onClick={() => setMode('submit')} variant="primary">提交作答</Button>
      </div>}
      className="practice-header"
      eyebrow="打印与作答"
      leading={<IconButton appearance="plain" label="返回今日学习" onClick={onBack}><Icon name="chevron" size={20} /></IconButton>}
      summary={`${practiceSet.items.length} 题 · 已保存`}
      title={`${practiceSet.subject}练习`}
    />
    <InlineNotice feedback={feedback} onClose={() => setFeedback(null)} />
    {mode === 'submit' ? <section className="practice-submit">
      <div className="practice-submit__copy"><p className="eyebrow">提交作答</p><h2>上传作答页或清晰照片</h2><p>支持 PDF、JPG、PNG 和 HEIC。请确保整页完整、四角清晰，Axiom 会自动识别并批改。</p></div>
      <button className="practice-submit__dropzone" onClick={() => void submitAnswer()} type="button">
        <Icon name="image" size={28} />
        <strong>选择作答文件</strong>
        <span>PDF 或照片</span>
      </button>
      <div className="practice-submit__actions"><Button onClick={() => setMode('ready')} variant="ghost">返回练习</Button></div>
    </section> : <>
      <nav className="practice-section-nav" aria-label="练习文档章节">
        <SegmentedControl ariaLabel="练习章节" onChange={chooseSection} options={documentTabs} value={selectedSection} />
      </nav>
      <section className="practice-document-stage" aria-label={`${documentTabs.find((tab) => tab.value === selectedSection)?.label} PDF 预览`}>
        {documentState === 'error' ? <div className="practice-document-error" role="alert">
          <strong>练习文档暂时无法生成</strong>
          <span>请重试；如果仍然失败，请重新生成这组练习。</span>
          <Button onClick={retryDocument} variant="secondary">重新生成</Button>
          {documentDiagnostic && <details className="practice-document-diagnostic">
            <summary>详情</summary>
            <dl>
              <div><dt>阶段</dt><dd>{documentDiagnostic.stage}</dd></div>
              <div><dt>代码</dt><dd>{documentDiagnostic.code}</dd></div>
              <div><dt>文档契约</dt><dd>{documentDiagnostic.rendererContract}</dd></div>
              {documentDiagnostic.rendererVersion && <div><dt>排版引擎</dt><dd>{documentDiagnostic.rendererVersion}</dd></div>}
              <div><dt>练习 ID</dt><dd>{documentDiagnostic.practiceSetId}</dd></div>
            </dl>
          </details>}
        </div> : documentState === 'loading' || !document ? <div className="practice-document-loading"><span className="ax-spinner" /><strong>正在准备完整文档…</strong></div> : <>
          <div className="practice-document-page">
            {pagePreview
              ? <img alt={`练习 PDF 第 ${currentPage} 页`} src={mediaAssetUrl(pagePreview.path)} />
              : <div className="practice-document-loading"><span className="ax-spinner" /><strong>正在载入第 {currentPage} 页…</strong></div>}
          </div>
          <footer>
            <span>{document.pageCount} 页 · {Math.max(1, Math.round(document.byteLength / 1024))} KB</span>
            <div className="practice-document-pagination">
              <IconButton className="practice-document-pagination__previous" label="上一页" disabled={currentPage <= 1} onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}><Icon name="chevron" size={16} /></IconButton>
              <span>第 {currentPage} / {document.pageCount} 页</span>
              <IconButton label="下一页" disabled={currentPage >= document.pageCount} onClick={() => setCurrentPage((page) => Math.min(document.pageCount, page + 1))}><Icon name="chevron" size={16} /></IconButton>
            </div>
            <Button onClick={() => void openExportedPracticePdf(document)} variant="ghost">在系统预览中打开</Button>
          </footer>
        </>}
      </section>
      <details className="practice-content-summary">
        <summary>查看本组练习内容</summary>
        <div>{practiceSet.items.map((item) => <article key={item.id}><strong>{item.orderIndex + 1}</strong><MathMarkdown>{item.statementMarkdown}</MathMarkdown></article>)}</div>
      </details>
    </>}
  </main>
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { open, save } from '@tauri-apps/plugin-dialog'
import { Icon } from '../../components/Icon'
import { MathMarkdown } from '../../components/MathMarkdown'
import { Badge, Button, FlowingTaskSurface, IconButton, InlineNotice, PageHeader, SegmentedControl, StatusBadge, Textarea, type Feedback } from '../../components/ui'
import type { PracticeItem, PracticeSet } from '../../domain/practice'
import type { PracticeAttempt, PracticeCapturedResponse } from '../../domain/practiceAttempt'
import type { PracticeLoop } from '../../domain/practiceLoop'
import { importImage, mediaAssetUrl, openPracticeSubmission, preparePracticeSubmission, renderPracticePdfPage, type PracticePdfPagePreview } from '../../platform/native'
import { mapWithConcurrency } from '../../platform/concurrency'
import {
  openExportedPracticePdf,
  practiceDocumentDiagnostic,
  preparePracticeDocument,
  printExportedPracticePdf,
  saveExportedPracticePdf,
  type PracticeDocumentDiagnostic,
  type PracticeDocumentRecord,
} from '../../platform/practiceDocumentDatabase'
import {
  capturePracticeAnswerPages,
  getLatestPracticeAttempt,
  PracticeSubmissionMatchError,
  type PracticeAnswerSubmission,
  type PracticeSubmissionPageOption,
} from '../../platform/practiceAttemptDatabase'
import { correctAndRegradePracticeResponse, extractAndGradePracticeAttempt, overridePracticeGrade } from '../../platform/practiceGradingDatabase'
import { finalizePracticeAttempt, getPracticeLoopForSet } from '../../platform/practiceLoopDatabase'
import { getPracticeSet } from '../../platform/practiceDatabase'
import { practiceErrorMessage } from './productLanguage'
import { shouldAutoPreparePracticeDocument, type PracticeDocumentState } from './practiceDocumentState'
import { PracticeSubmissionScanner } from './PracticeSubmissionScanner'
import './PracticeSetView.css'

type PracticePdfSection = 'exercise' | 'answer_sheet' | 'solution'

const baseDocumentTabs: Array<{ value: PracticePdfSection; label: string }> = [
  { value: 'exercise', label: '练习' },
  { value: 'solution', label: '解析' },
]

function variantFallbackReason(code: string) {
  if (code.includes('no_variant_provider')) return '没有可用的变式生成模型'
  if (code.includes('no_variant_verification_provider')) return '没有可用于检查答案的模型'
  if (code.includes('missing_confirmed_target_tags')) return '原题信息暂时不足'
  if (code.includes('missing_required_solution_steps')) return '原题解答缺少必要步骤'
  if (code.includes('diagram') || code.includes('geometry')) return '图形版本暂时不可用'
  if (code.includes('provider') || code.includes('REQUEST_')) return 'AI 服务暂时没有完成请求'
  return '这次生成的变式暂时不可用'
}

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
      <Textarea aria-label={`第 ${item.orderIndex + 1} 题识别结果`} label="识别到的作答" onChange={(event) => setAnswer(event.target.value)} value={answer} />
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
    <header><strong>第 {item.orderIndex + 1} 题</strong>{item.sourceType === 'generated_variant' && <Badge>AI 变式</Badge>}<StatusBadge tone={tone}>{label}</StatusBadge></header>
    <MathMarkdown className="practice-result-item__question">{item.statementMarkdown}</MathMarkdown>
    <dl>
      <div><dt>你的作答</dt><dd><MathMarkdown>{response.extractedAnswer?.rawMarkdown || '未识别到清晰作答'}</MathMarkdown></dd></div>
      <div><dt>参考答案</dt><dd><MathMarkdown>{item.canonicalAnswer}</MathMarkdown></dd></div>
    </dl>
    {result?.explanation && <p className="practice-result-item__explanation">{result.explanation}</p>}
    {result?.firstErrorStep && <div className="practice-result-item__first-error">
      <strong>首个错误：第 {result.firstErrorStep} 步</strong>
      {result.errorReason && <span>{result.errorReason}</span>}
      {result.correctAlternativeStep && <MathMarkdown>{result.correctAlternativeStep}</MathMarkdown>}
    </div>}
    {(result?.tagEvidence?.length ?? 0) > 0 && <div className="practice-result-item__evidence" aria-label="标签证据">
      {result!.tagEvidence.map((entry) => {
        const tag = item.targetTags.find((candidate) => candidate.id === entry.tagId)
        const evidenceLabel = entry.result === 'demonstrated' ? '已证明' : entry.result === 'contradicted' ? '存在冲突' : '证据不足'
        return <div key={`${entry.tagType}:${entry.tagId}`}>
          <Badge>{tag?.name ?? entry.tagId}</Badge><span>{evidenceLabel}</span><small>{entry.evidence}</small>
        </div>
      })}
    </div>}
    {result?.requiresReview && <p className="practice-result-item__review-note">批改证据置信度不足，请检查后再应用学习进度。</p>}
    {tags.length > 0 && <div className="practice-result-item__tags"><span>相关知识</span>{tags.map((tag) => <Badge key={tag.id || tag.name}>{tag.name}</Badge>)}</div>}
    <ResultCorrection item={item} onChange={onChange} onError={onError} response={response} />
  </article>
}

export function PracticeSetView({ practiceSet, onBack, onOpenPracticeSet, initialAttempt, initialMode }: {
  practiceSet: PracticeSet
  onBack: () => void
  onOpenPracticeSet?: (practiceSet: PracticeSet) => void
  initialAttempt?: PracticeAttempt
  initialMode?: 'ready' | 'submit' | 'results'
}) {
  const [selectedSection, setSelectedSection] = useState<PracticePdfSection>('exercise')
  const [document, setDocument] = useState<PracticeDocumentRecord | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [pagePreview, setPagePreview] = useState<PracticePdfPagePreview | null>(null)
  const [documentState, setDocumentState] = useState<PracticeDocumentState>('idle')
  const [mode, setMode] = useState<'ready' | 'submit' | 'scanner' | 'manual_match' | 'processing' | 'results'>(initialMode ?? 'ready')
  const [processingStep, setProcessingStep] = useState({ title: '正在读取作答', detail: '正在安全导入文件…', progress: .12 })
  const [attempt, setAttempt] = useState<PracticeAttempt | null>(initialAttempt ?? null)
  const [loop, setLoop] = useState<PracticeLoop | null>(null)
  const [attemptLoaded, setAttemptLoaded] = useState(Boolean(initialAttempt))
  const [finalizing, setFinalizing] = useState(false)
  const [feedback, setFeedback] = useState<Feedback>(null)
  const [documentDiagnostic, setDocumentDiagnostic] = useState<PracticeDocumentDiagnostic | null>(null)
  const [manualMatch, setManualMatch] = useState<{
    submissions: PracticeAnswerSubmission[]
    pageOptions: PracticeSubmissionPageOption[]
    message: string
  } | null>(null)
  const documentRequest = useRef<Promise<PracticeDocumentRecord> | null>(null)
  const documentTabs = useMemo(() => practiceSet.sessionMode === 'mock_test' || practiceSet.sessionSettings?.includeAnswerSheet
    ? [baseDocumentTabs[0], { value: 'answer_sheet' as const, label: '答题页' }, baseDocumentTabs[1]]
    : baseDocumentTabs, [practiceSet.sessionMode, practiceSet.sessionSettings?.includeAnswerSheet])
  const generatedVariantCount = Number(practiceSet.generationMetadata.generatedVariantCount ?? 0)
  const fallbackCount = Number(practiceSet.generationMetadata.fallbackCount ?? 0)
  const fallbackReasons = [...new Set(practiceSet.items.flatMap((item) => {
    const code = item.generationMetadata?.variantFallbackCode
    return typeof code === 'string' && code ? [variantFallbackReason(code)] : []
  }))]

  useEffect(() => {
    let cancelled = false
    documentRequest.current = null
    setDocument(null); setSelectedSection('exercise'); setCurrentPage(1); setPagePreview(null); setDocumentState('idle'); setFeedback(null); setDocumentDiagnostic(null)
    setAttempt(initialAttempt ?? null); setMode(initialMode ?? 'ready'); setAttemptLoaded(Boolean(initialAttempt)); setManualMatch(null)
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
    void renderPracticePdfPage(document.filePath, currentPage, practiceSet.id)
      .then((preview) => { if (!cancelled) setPagePreview(preview) })
      .catch((reason) => { if (!cancelled) setFeedback({ tone: 'danger', message: practiceErrorMessage(reason) }) })
    return () => { cancelled = true }
  }, [currentPage, document, practiceSet.id])

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
    const range = document?.sectionPageRanges[section]
    if (range) setCurrentPage(range.startPage)
  }
  const saveCurrent = async () => {
    try {
      const record = document ?? await ensureDocument()
      // Use the system local timezone so the file name date matches the dates
      // shown elsewhere in the app (review/planner both use local dates).
      const date = new Intl.DateTimeFormat('sv-SE').format(practiceSet.createdAt)
      const safeSubject = practiceSet.subject.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, '').slice(0, 24) || '练习'
      const destination = await save({
        defaultPath: `Axiom-${safeSubject}练习-${date}.pdf`,
        filters: [{ name: 'PDF 文档', extensions: ['pdf'] }],
      })
      if (!destination) return
      await saveExportedPracticePdf(record, destination)
      setFeedback({ tone: 'success', message: 'PDF 已保存。' })
    } catch (reason) {
      setFeedback({ tone: 'danger', message: `保存 PDF 失败：${practiceErrorMessage(reason)}` })
    }
  }
  const printCurrent = async () => {
    try {
      const record = document ?? await ensureDocument()
      await printExportedPracticePdf(record)
      const exercise = record.sectionPageRanges.exercise
      const answerSheet = record.sectionPageRanges.answer_sheet
      setFeedback({
        tone: 'success',
        message: answerSheet
          ? `已在系统预览中打开。模拟练习请打印第 ${exercise.startPage}–${answerSheet.endPage} 页；解析位于其后。`
          : `已在系统预览中打开。打印作答页请选择第 ${exercise.startPage}–${exercise.endPage} 页；如需解析，可打印完整文档。`,
      })
    } catch (reason) {
      setFeedback({ tone: 'danger', message: `打开打印预览失败：${practiceErrorMessage(reason)}` })
    }
  }
  const processSubmissions = async (submissions: PracticeAnswerSubmission[]) => {
    setMode('processing')
    try {
      setProcessingStep({
        title: '正在匹配练习',
        detail: `正在识别并校正 ${submissions.length} 页作答…`,
        progress: .38,
      })
      const captured = await capturePracticeAnswerPages(practiceSet.id, submissions)
      setAttempt(captured)
      setProcessingStep({ title: '正在读取答案', detail: `已找到 ${captured.responses.length} 个作答区域…`, progress: .64 })
      setProcessingStep({ title: '正在批改', detail: '正在逐题核对答案与关键步骤…', progress: .82 })
      const graded = await extractAndGradePracticeAttempt(practiceSet, captured)
      if (!graded) throw new Error('批改完成后无法读取结果')
      setAttempt(graded); setMode('results')
    } catch (reason) {
      if (reason instanceof PracticeSubmissionMatchError) {
        setManualMatch({
          submissions: reason.submissions,
          pageOptions: reason.pageOptions,
          message: reason.message,
        })
        setFeedback(null)
        setMode('manual_match')
      } else {
        setMode('submit')
        setFeedback({ tone: 'danger', message: practiceErrorMessage(reason) })
      }
    }
  }
  const submitAnswer = async () => {
    setFeedback(null)
    await ensureDocument()
    const selected = await open({
      directory: false,
      multiple: true,
      filters: [{ name: '作答文件', extensions: ['pdf', 'jpg', 'jpeg', 'png', 'heic'] }],
    })
    const selectedPaths = typeof selected === 'string' ? [selected] : selected ?? []
    if (!selectedPaths.length) return
    if (selectedPaths.some((path) => !/\.(?:pdf|jpe?g|png|heic)$/iu.test(path))) {
      setMode('submit')
      setFeedback({ tone: 'danger', message: '请选择 PDF、JPG、PNG 或 HEIC 作答文件。' })
      return
    }
    setMode('processing')
    setProcessingStep({ title: '正在读取作答', detail: `正在安全导入 ${selectedPaths.length} 个文件…`, progress: .12 })
    try {
      // Import files with bounded concurrency (order-preserving): one IPC per
      // file adds up quickly for multi-page submissions.
      const results = await mapWithConcurrency(selectedPaths, 4, async (path) => {
        if (path.toLowerCase().endsWith('.pdf')) {
          const prepared = await preparePracticeSubmission(path)
          return prepared.pages.map((page) => ({
            sourcePath: page.sourcePath,
            submissionGroupId: prepared.submissionGroupId,
            sourceKind: prepared.sourceKind,
            originalAssetPath: prepared.originalAssetPath,
            sourcePageIndex: page.pageIndex,
            pageCount: prepared.pageCount,
            annotationsPreserved: prepared.annotationsPreserved,
          }))
        }
        const media = await importImage(path)
        return [{
          sourcePath: media.path,
          submissionGroupId: crypto.randomUUID(),
          sourceKind: 'image' as const,
          originalAssetPath: media.path,
          sourcePageIndex: 0,
          pageCount: 1,
          annotationsPreserved: false,
        }]
      })
      await processSubmissions(results.flat())
    } catch (reason) {
      setMode('submit')
      setFeedback({ tone: 'danger', message: practiceErrorMessage(reason) })
    }
  }
  const resumeManualMatch = async (practiceDocumentPageId: string) => {
    if (!manualMatch?.submissions.length) return
    const [failed, ...remaining] = manualMatch.submissions
    setManualMatch(null)
    await processSubmissions([
      { ...failed, practiceDocumentPageId },
      ...remaining,
    ])
  }
  const updateResponse = (updated: PracticeCapturedResponse) => setAttempt((current) => current ? {
    ...current, responses: current.responses.map((response) => response.regionId === updated.regionId ? updated : response),
  } : current)
  const canFinalize = Boolean(attempt?.responses.length && attempt.responses.every((response) =>
    response.gradingResult && response.gradingResult.correctness !== 'needs_review' && !response.gradingResult.requiresReview))
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
    try {
      const next = await getPracticeSet(loop.nextPracticeSetId)
      if (next) onOpenPracticeSet(next)
    } catch (reason) {
      setFeedback({ tone: 'danger', message: `打开下一组练习失败：${practiceErrorMessage(reason)}` })
    }
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

  if (mode === 'scanner') return <main className="workspace practice-workspace">
    <PageHeader
      className="practice-header"
      eyebrow="连续扫描"
      leading={<IconButton appearance="plain" label="返回提交作答" onClick={() => setMode('submit')}><Icon name="chevron" size={20} /></IconButton>}
      summary="实时识别页面身份、纸张四角和当前作答区域"
      title="拍摄作答页"
    />
    <PracticeSubmissionScanner
      onCancel={() => setMode('submit')}
      onSubmit={(submissions) => void processSubmissions(submissions)}
      practiceSetId={practiceSet.id}
    />
  </main>

  if (mode === 'manual_match' && manualMatch) return <main className="workspace practice-workspace">
    <PageHeader
      className="practice-header"
      eyebrow="页面恢复"
      leading={<IconButton appearance="plain" label="返回提交作答" onClick={() => { setManualMatch(null); setMode('submit') }}><Icon name="chevron" size={20} /></IconButton>}
      summary="二维码不可读时，仅使用当前练习已保存的页面布局"
      title="选择这张作答页"
    />
    <section className="practice-manual-match">
      <figure>
        <img alt="等待手动匹配的作答页" src={mediaAssetUrl(manualMatch.submissions[0].sourcePath)} />
        <figcaption>{practiceErrorMessage(manualMatch.message)}</figcaption>
      </figure>
      <div>
        <InlineNotice feedback={{ tone: 'warning', message: '请按纸面页码选择；Axiom 只会使用该页已保存的作答区域，不会猜测或跨练习匹配。' }} />
        <div className="practice-manual-match__options">
          {manualMatch.pageOptions.map((option) => <Button
            key={option.pageId}
            onClick={() => void resumeManualMatch(option.pageId)}
            variant="secondary"
          >第 {option.pageIndex + 1} 页 · {option.responseCount} 个作答区</Button>)}
        </div>
        <Button onClick={() => { setManualMatch(null); setMode('submit') }} variant="ghost">重新选择文件</Button>
      </div>
    </section>
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
    {fallbackCount > 0 && <InlineNotice feedback={{
      tone: 'warning',
      message: `${fallbackCount} 道题已换用原题：${fallbackReasons.join('；') || '暂时没有可用变式'}。`,
    }} />}
    <section className="practice-result-summary">
      <div><span>得分</span><strong>{score}</strong><small>/ 100</small></div>
      <div><span>答对</span><strong>{correct}</strong><small>/ {results.length}</small></div>
      <div><span>需要巩固</span><strong>{needsWork}</strong><small>题</small></div>
    </section>
    {attempt.submissionAssets?.some((asset) => asset.annotationsPreserved) && <section className="practice-submission-provenance">
      <div><strong>原始批注 PDF 已保留</strong><span>逐页识别不会改写平板批注或原文件。</span></div>
      {attempt.submissionAssets.filter((asset) => asset.annotationsPreserved).map((asset) => <Button key={asset.id} onClick={() => void openPracticeSubmission(asset.originalAssetPath)} variant="ghost">打开原文件 · {asset.pageCount} 页</Button>)}
    </section>}
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
      summary={`${practiceSet.items.length} 题 · 已保存 · ${generatedVariantCount} 道变式${fallbackCount ? ` · ${fallbackCount} 道换用原题` : ''}`}
      title={`${practiceSet.subject}练习`}
    />
    <InlineNotice feedback={feedback} onClose={() => setFeedback(null)} />
    {mode === 'submit' ? <section className="practice-submit">
      <div className="practice-submit__copy"><p className="eyebrow">提交作答</p><h2>上传或连续扫描作答页</h2><p>带批注 PDF 会完整保留原文件并逐页读取；也可以按页码导入多张照片，或用 iPhone 相机实时识别页面与作答区域。</p></div>
      <div className="practice-submit__methods">
        <button className="practice-submit__dropzone" onClick={() => void submitAnswer()} type="button">
          <Icon name="image" size={28} />
          <strong>选择作答文件</strong>
          <span>多页 PDF、JPG、PNG 或 HEIC</span>
        </button>
        <button className="practice-submit__dropzone" onClick={() => setMode('scanner')} type="button">
          <Icon name="camera" size={28} />
          <strong>连续扫描多页</strong>
          <span>实时确认页面身份与作答区域</span>
        </button>
      </div>
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

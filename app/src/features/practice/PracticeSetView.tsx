import { useEffect, useMemo, useState } from 'react'
import { open, save } from '@tauri-apps/plugin-dialog'
import { Icon } from '../../components/Icon'
import { MathMarkdown } from '../../components/MathMarkdown'
import { Badge, Button, FlowingTaskSurface, IconButton, InlineNotice, StatusBadge, Tabs, type Feedback } from '../../components/ui'
import type { PracticeItem, PracticeSet } from '../../domain/practice'
import type { PracticeAttempt, PracticeCapturedResponse } from '../../domain/practiceAttempt'
import type { PracticeLoop } from '../../domain/practiceLoop'
import type { PracticeDocumentType } from '../../domain/practiceDocument'
import { importImage, mediaAssetUrl, preparePracticeSubmission } from '../../platform/native'
import {
  exportPracticePdf,
  openExportedPracticePdf,
  printExportedPracticePdf,
  saveExportedPracticePdf,
  type PracticeDocumentRecord,
} from '../../platform/practiceDocumentDatabase'
import { capturePracticeAnswerSheet, getLatestPracticeAttempt } from '../../platform/practiceAttemptDatabase'
import { correctAndRegradePracticeResponse, extractAndGradePracticeAttempt, overridePracticeGrade } from '../../platform/practiceGradingDatabase'
import { finalizePracticeAttempt, getPracticeLoopForSet } from '../../platform/practiceLoopDatabase'
import { getPracticeSet } from '../../platform/practiceDatabase'
import './PracticeSetView.css'

const documentTabs: Array<{ value: PracticeDocumentType; label: string }> = [
  { value: 'questions', label: '练习' },
  { value: 'answer_sheet', label: '答题卡' },
  { value: 'solutions', label: '解析' },
]

function ResultCorrection({ response, item, onChange }: {
  response: PracticeCapturedResponse
  item: PracticeItem
  onChange: (response: PracticeCapturedResponse) => void
}) {
  const [answer, setAnswer] = useState(response.extractedAnswer?.rawMarkdown ?? '')
  const [busy, setBusy] = useState(false)
  useEffect(() => { setAnswer(response.extractedAnswer?.rawMarkdown ?? '') }, [response.extractedAnswer?.rawMarkdown])
  const regrade = async () => {
    setBusy(true)
    try {
      const result = await correctAndRegradePracticeResponse(response.regionId, item, answer)
      onChange({ ...response, extractedAnswer: result.answer, gradingResult: result.grading })
    } finally { setBusy(false) }
  }
  const override = async (correctness: 'correct' | 'incorrect') => {
    setBusy(true)
    try { onChange({ ...response, gradingResult: await overridePracticeGrade(response.regionId, correctness) }) }
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

function ResultItem({ item, response, onChange }: {
  item: PracticeItem
  response: PracticeCapturedResponse
  onChange: (response: PracticeCapturedResponse) => void
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
    <ResultCorrection item={item} onChange={onChange} response={response} />
  </article>
}

export function PracticeSetView({ practiceSet, onBack, onOpenPracticeSet }: {
  practiceSet: PracticeSet
  onBack: () => void
  onOpenPracticeSet?: (practiceSet: PracticeSet) => void
}) {
  const [selectedDocument, setSelectedDocument] = useState<PracticeDocumentType>('questions')
  const [documents, setDocuments] = useState<Partial<Record<PracticeDocumentType, PracticeDocumentRecord>>>({})
  const [exporting, setExporting] = useState<PracticeDocumentType | null>('questions')
  const [mode, setMode] = useState<'ready' | 'submit' | 'processing' | 'results'>('ready')
  const [processingStep, setProcessingStep] = useState({ title: '正在读取作答', detail: '正在安全导入文件…', progress: .12 })
  const [attempt, setAttempt] = useState<PracticeAttempt | null>(null)
  const [loop, setLoop] = useState<PracticeLoop | null>(null)
  const [finalizing, setFinalizing] = useState(false)
  const [feedback, setFeedback] = useState<Feedback>(null)

  useEffect(() => {
    let cancelled = false
    setDocuments({}); setSelectedDocument('questions'); setExporting('questions'); setMode('ready'); setFeedback(null)
    void (async () => {
      try {
        const questions = await exportPracticePdf(practiceSet, 'questions')
        if (cancelled) return
        setDocuments((current) => ({ ...current, questions }))
        setExporting('answer_sheet')
        const answerSheet = await exportPracticePdf(practiceSet, 'answer_sheet')
        if (!cancelled) setDocuments((current) => ({ ...current, answer_sheet: answerSheet }))
      } catch (reason) {
        if (!cancelled) setFeedback({ tone: 'danger', message: String(reason) })
      } finally { if (!cancelled) setExporting(null) }
    })()
    void Promise.all([getLatestPracticeAttempt(practiceSet.id), getPracticeLoopForSet(practiceSet.id)])
      .then(([latest, recoveredLoop]) => {
        if (cancelled) return
        setAttempt(latest); setLoop(recoveredLoop)
        if (latest?.responses.some((response) => response.gradingResult)) setMode('results')
      }).catch(() => null)
    return () => { cancelled = true }
  }, [practiceSet])

  const ensureDocument = async (documentType: PracticeDocumentType) => {
    if (documents[documentType]) return documents[documentType]!
    setExporting(documentType); setFeedback(null)
    try {
      const record = await exportPracticePdf(practiceSet, documentType)
      setDocuments((current) => ({ ...current, [documentType]: record }))
      return record
    } finally { setExporting(null) }
  }
  const chooseDocument = (documentType: PracticeDocumentType) => {
    setSelectedDocument(documentType)
    if (!documents[documentType]) void ensureDocument(documentType).catch((reason) => setFeedback({ tone: 'danger', message: String(reason) }))
  }
  const currentDocument = documents[selectedDocument]
  const saveCurrent = async () => {
    const record = currentDocument ?? await ensureDocument(selectedDocument)
    const destination = await save({
      defaultPath: `Axiom_${documentTabs.find((tab) => tab.value === selectedDocument)?.label ?? '练习'}.pdf`,
      filters: [{ name: 'PDF 文档', extensions: ['pdf'] }],
    })
    if (!destination) return
    await saveExportedPracticePdf(record, destination)
    setFeedback({ tone: 'success', message: 'PDF 已保存。' })
  }
  const printCurrent = async () => {
    const record = currentDocument ?? await ensureDocument(selectedDocument)
    await printExportedPracticePdf(record)
    setFeedback({ tone: 'success', message: '已在系统预览中打开，可使用“文件 → 打印”。' })
  }
  const submitAnswer = async () => {
    setFeedback(null)
    await ensureDocument('answer_sheet')
    const selected = await open({
      multiple: false,
      filters: [{ name: '作答文件', extensions: ['pdf', 'jpg', 'jpeg', 'png', 'heic'] }],
    })
    if (typeof selected !== 'string') return
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
      setMode('submit'); setFeedback({ tone: 'danger', message: String(reason) })
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
    } catch (reason) { setFeedback({ tone: 'danger', message: String(reason) }) }
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
    <header className="practice-header practice-header--result">
      <IconButton appearance="plain" label="返回今日学习" onClick={onBack}><Icon name="chevron" size={20} /></IconButton>
      <div><p className="eyebrow">练习结果</p><h1>本次练习</h1><p>{practiceSet.subject} · {practiceSet.items.length} 题</p></div>
    </header>
    <InlineNotice feedback={feedback} onClose={() => setFeedback(null)} />
    <section className="practice-result-summary">
      <div><span>得分</span><strong>{score}</strong><small>/ 100</small></div>
      <div><span>答对</span><strong>{correct}</strong><small>/ {results.length}</small></div>
      <div><span>需要巩固</span><strong>{needsWork}</strong><small>题</small></div>
    </section>
    <section className="practice-results" aria-label="逐题结果">
      {attempt.responses.map((response) => {
        const item = practiceSet.items.find((candidate) => candidate.id === response.practiceItemId)
        return item ? <ResultItem item={item} key={response.regionId} onChange={updateResponse} response={response} /> : null
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
    <header className="practice-header">
      <IconButton appearance="plain" label="返回今日学习" onClick={onBack}><Icon name="chevron" size={20} /></IconButton>
      <div><p className="eyebrow">练习</p><h1>{practiceSet.subject}练习</h1><p>{practiceSet.items.length} 题 · 已保存</p></div>
    </header>
    <InlineNotice feedback={feedback} onClose={() => setFeedback(null)} />
    {mode === 'submit' ? <section className="practice-submit">
      <div className="practice-submit__copy"><p className="eyebrow">提交作答</p><h2>上传答题卡或清晰照片</h2><p>支持 PDF、JPG、PNG 和 HEIC。请确保整页完整、四角清晰，Axiom 会自动识别并批改。</p></div>
      <button className="practice-submit__dropzone" onClick={() => void submitAnswer()} type="button">
        <Icon name="image" size={28} />
        <strong>选择作答文件</strong>
        <span>PDF 或照片</span>
      </button>
      <div className="practice-submit__actions"><Button onClick={() => setMode('ready')} variant="ghost">返回练习</Button></div>
    </section> : <>
      <section className="practice-toolbar" aria-label="练习文档工具栏">
        <Tabs ariaLabel="练习文档" onChange={chooseDocument} options={documentTabs} value={selectedDocument} variant="rail" />
        <div className="practice-toolbar__actions">
          <Button disabled={!currentDocument || exporting !== null} onClick={() => void saveCurrent()} variant="secondary"><Icon name="download" size={16} /> 保存 PDF</Button>
          <Button disabled={!currentDocument || exporting !== null} onClick={() => void printCurrent()} variant="secondary"><Icon name="print" size={16} /> 打印</Button>
          <Button onClick={() => setMode('submit')} variant="primary">提交作答</Button>
        </div>
      </section>
      <section className="practice-document-stage" aria-label={`${documentTabs.find((tab) => tab.value === selectedDocument)?.label} PDF 预览`}>
        {exporting === selectedDocument || !currentDocument ? <div className="practice-document-loading"><span className="ax-spinner" /><strong>正在准备文档…</strong></div> : <>
          <object data={mediaAssetUrl(currentDocument.filePath)} type="application/pdf">
            <div className="practice-document-fallback"><p>当前窗口无法直接预览 PDF。</p><Button onClick={() => void openExportedPracticePdf(currentDocument)}>在系统预览中打开</Button></div>
          </object>
          <footer><span>{currentDocument.pageCount} 页 · {Math.max(1, Math.round(currentDocument.byteLength / 1024))} KB</span><span>A4 文档</span></footer>
        </>}
      </section>
      <details className="practice-content-summary">
        <summary>查看本组练习内容</summary>
        <div>{practiceSet.items.map((item) => <article key={item.id}><strong>{item.orderIndex + 1}</strong><MathMarkdown>{item.statementMarkdown}</MathMarkdown></article>)}</div>
      </details>
    </>}
  </main>
}

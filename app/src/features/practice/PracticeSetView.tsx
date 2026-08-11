import { useEffect, useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { DiagramView } from '../../components/DiagramView'
import { MathMarkdown } from '../../components/MathMarkdown'
import { Badge, Button, StatusTag } from '../../components/ui'
import type { Diagram } from '../../domain/diagram'
import type { PracticeItem, PracticeSet } from '../../domain/practice'
import type { PracticeAttempt } from '../../domain/practiceAttempt'
import type { PracticeCapturedResponse } from '../../domain/practiceAttempt'
import type { PracticeLoop } from '../../domain/practiceLoop'
import { listDiagrams } from '../../platform/diagramDatabase'
import { importImage, mediaAssetUrl } from '../../platform/native'
import { exportPracticePdf, openExportedPracticePdf, type PracticeDocumentRecord } from '../../platform/practiceDocumentDatabase'
import { capturePracticeAnswerSheet, getLatestPracticeAttempt } from '../../platform/practiceAttemptDatabase'
import { correctAndRegradePracticeResponse, extractAndGradePracticeAttempt, overridePracticeGrade } from '../../platform/practiceGradingDatabase'
import { finalizePracticeAttempt, getPracticeLoopForSet, stopPracticeLoop } from '../../platform/practiceLoopDatabase'
import { getPracticeSet } from '../../platform/practiceDatabase'
import type { PracticeDocumentType } from '../../domain/practiceDocument'
import './PracticeSetView.css'

const difficultyLabel = { basic: '基础', intermediate: '中档', advanced: '压轴' }

function PracticeQuestion({ item }: { item: PracticeItem }) {
  const [diagrams, setDiagrams] = useState<Diagram[]>([])
  const [revealed, setRevealed] = useState(false)
  useEffect(() => {
    let cancelled = false
    void listDiagrams('practice_item', item.id).then((rows) => { if (!cancelled) setDiagrams(rows) })
    return () => { cancelled = true }
  }, [item.id])
  return <article className="practice-question">
    <header>
      <span className="practice-question__number">{String(item.orderIndex + 1).padStart(2, '0')}</span>
      <div><Badge>{difficultyLabel[item.difficulty]}</Badge><StatusTag kind="completed">已验证</StatusTag></div>
    </header>
    <MathMarkdown className="practice-question__statement">{item.statementMarkdown}</MathMarkdown>
    {item.questionImagePath ? <img alt="练习题原图" className="practice-question__image" src={mediaAssetUrl(item.questionImagePath)} /> : null}
    {item.diagramImagePaths.map((path) => <img alt="练习题图形" className="practice-question__image practice-question__image--diagram" key={path} src={mediaAssetUrl(path)} />)}
    {diagrams.map((diagram) => <DiagramView diagram={diagram} key={diagram.id} />)}
    {item.options?.length ? <ol className="practice-question__options">{item.options.map((option) => <li key={option}>{option}</li>)}</ol> : null}
    {!revealed ? <Button onClick={() => setRevealed(true)} variant="ghost">查看答案与解法</Button> : <section className="practice-question__solution">
      <strong>参考答案</strong>
      <MathMarkdown>{item.canonicalAnswer}</MathMarkdown>
      <MathMarkdown>{solutionMarkdown(item.solutionJson)}</MathMarkdown>
    </section>}
  </article>
}

function solutionMarkdown(value: string) {
  try {
    const solution = JSON.parse(value) as { contentMarkdown?: string; steps?: Array<{ content?: string; contentMarkdown?: string; content_markdown?: string }> }
    return solution.contentMarkdown || solution.steps?.map((step) => step.content ?? step.contentMarkdown ?? step.content_markdown ?? '').filter(Boolean).join('\n\n') || ''
  } catch { return '' }
}

function PracticeResponseReview({ response, item, onChange }: { response: PracticeCapturedResponse; item: PracticeItem; onChange: (response: PracticeCapturedResponse) => void }) {
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
  return <article className="practice-response-review">
    <img alt={`第 ${response.regionIndex + 1} 个答题区域`} src={mediaAssetUrl(response.answerAssetPath)} />
    <div>
      <label>识别到的学生答案<textarea aria-label={`题目 ${item.orderIndex + 1} 的学生答案`} onChange={(event) => setAnswer(event.target.value)} value={answer} /></label>
      <div className="practice-response-review__actions">
        <Button disabled={busy || !answer.trim()} onClick={() => void regrade()} variant="secondary">{busy ? '处理中…' : '按修正答案重批'}</Button>
        <Button disabled={busy} onClick={() => void override('correct')} variant="ghost">确认正确</Button>
        <Button disabled={busy} onClick={() => void override('incorrect')} variant="ghost">确认错误</Button>
      </div>
      {response.gradingResult ? <div className="practice-response-review__grade">
        <StatusTag kind={response.gradingResult.correctness === 'correct' ? 'completed' : 'pending'}>{response.gradingResult.correctness === 'correct' ? '正确' : response.gradingResult.correctness === 'incorrect' ? '错误' : '需要检查'}</StatusTag>
        <span>{response.gradingResult.explanation}{response.gradingResult.userConfirmed ? ' · 用户已确认' : ''}</span>
      </div> : <span className="practice-response-review__pending">尚未识别答案</span>}
      <details><summary>查看标准答案</summary><MathMarkdown>{item.canonicalAnswer}</MathMarkdown></details>
    </div>
  </article>
}

export function PracticeSetView({ practiceSet, onBack, onOpenPracticeSet }: {
  practiceSet: PracticeSet
  onBack: () => void
  onOpenPracticeSet?: (practiceSet: PracticeSet) => void
}) {
  const [exporting, setExporting] = useState<PracticeDocumentType | null>(null)
  const [exported, setExported] = useState<PracticeDocumentRecord | null>(null)
  const [capturing, setCapturing] = useState(false)
  const [extracting, setExtracting] = useState(false)
  const [attempt, setAttempt] = useState<PracticeAttempt | null>(null)
  const [loop, setLoop] = useState<PracticeLoop | null>(null)
  const [finalizing, setFinalizing] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const warnings = Array.isArray(practiceSet.generationMetadata.warnings)
    ? practiceSet.generationMetadata.warnings.filter((value): value is string => typeof value === 'string') : []
  const namedTargets = practiceSet.targetSkills.filter((target) => !target.id.startsWith('bundle:'))
  const visibleTargets = namedTargets.length ? namedTargets : practiceSet.targetSkills.slice(0, 1)
  useEffect(() => {
    let cancelled = false
    void Promise.all([getLatestPracticeAttempt(practiceSet.id), getPracticeLoopForSet(practiceSet.id)])
      .then(([latest, recoveredLoop]) => { if (!cancelled) { setAttempt(latest); setLoop(recoveredLoop) } }).catch(() => null)
    return () => { cancelled = true }
  }, [practiceSet.id])
  const exportDocument = async (documentType: PracticeDocumentType) => {
    setExporting(documentType); setExportError(null)
    try { setExported(await exportPracticePdf(practiceSet, documentType)) }
    catch (reason) { setExportError(String(reason)) }
    finally { setExporting(null) }
  }
  const importAnswerSheet = async () => {
    setExportError(null)
    const selected = await open({ multiple: false, filters: [{ name: '答题卡照片', extensions: ['jpg', 'jpeg', 'png', 'heic'] }] })
    if (typeof selected !== 'string') return
    setCapturing(true)
    try {
      const media = await importImage(selected)
      setAttempt(await capturePracticeAnswerSheet(practiceSet.id, media.path))
    } catch (reason) { setExportError(String(reason)) }
    finally { setCapturing(false) }
  }
  const extractAnswers = async () => {
    if (!attempt) return
    setExtracting(true); setExportError(null)
    try { setAttempt(await extractAndGradePracticeAttempt(practiceSet, attempt)) }
    catch (reason) { setExportError(String(reason)) }
    finally { setExtracting(false) }
  }
  const updateResponse = (updated: PracticeCapturedResponse) => setAttempt((current) => current ? {
    ...current, responses: current.responses.map((response) => response.regionId === updated.regionId ? updated : response),
  } : current)
  const canFinalize = Boolean(attempt?.responses.length && attempt.responses.every((response) =>
    response.gradingResult && response.gradingResult.correctness !== 'needs_review'))
  const finalize = async () => {
    if (!attempt) return
    setFinalizing(true); setExportError(null)
    try {
      const nextLoop = await finalizePracticeAttempt(practiceSet, attempt)
      setLoop(nextLoop); setAttempt({ ...attempt, status: 'completed', submittedAt: Date.now() })
    } catch (reason) { setExportError(String(reason)) }
    finally { setFinalizing(false) }
  }
  const openNextRound = async () => {
    if (!loop?.nextPracticeSetId || !onOpenPracticeSet) return
    const next = await getPracticeSet(loop.nextPracticeSetId)
    if (next) onOpenPracticeSet(next)
  }
  const stopLoop = async () => {
    if (!loop) return
    await stopPracticeLoop(loop.id)
    setLoop(await getPracticeLoopForSet(practiceSet.id))
  }
  return <main className="workspace practice-workspace">
    <header className="practice-header">
      <Button onClick={onBack} variant="ghost">返回 Review Unit</Button>
      <div><p className="eyebrow">Practice Set</p><h1>针对性练习</h1><p>{practiceSet.subject} · {practiceSet.items.length} 题 · {practiceSet.strategy}</p></div>
      <StatusTag kind="pending">已保存</StatusTag>
    </header>
    <section className="practice-export" aria-label="PDF 导出">
      <div><strong>打印与回传</strong><span>A4 · 固定题号 · 机器可识别页面身份</span></div>
      <div>
        <Button disabled={exporting !== null} onClick={() => void exportDocument('questions')} variant="secondary">{exporting === 'questions' ? '生成中…' : '题目版 PDF'}</Button>
        <Button disabled={exporting !== null} onClick={() => void exportDocument('answer_sheet')} variant="primary">{exporting === 'answer_sheet' ? '生成中…' : '机器答题卡'}</Button>
        <Button disabled={exporting !== null} onClick={() => void exportDocument('solutions')} variant="ghost">{exporting === 'solutions' ? '生成中…' : '答案解析版'}</Button>
        <Button disabled={exporting !== null || capturing} onClick={() => void importAnswerSheet()} variant="secondary">{capturing ? '识别与裁切中…' : '导入作答照片'}</Button>
      </div>
      {exported ? <p><span>{exported.pageCount} 页 · {Math.max(1, Math.round(exported.byteLength / 1024))} KB{exported.cacheHit ? ' · 已复用稳定产物' : ''}</span><Button onClick={() => void openExportedPracticePdf(exported)} variant="ghost">打开 PDF</Button></p> : null}
      {exportError ? <p className="practice-export__error" role="alert">{exportError}</p> : null}
      {attempt ? <section className="practice-capture-result" aria-label="作答回传结果">
        <div><StatusTag kind="completed">页面已识别</StatusTag><span>方向矫正 {attempt.orientationDegrees}° · 已独立提取 {attempt.responses.length} 个答题区</span><Button disabled={extracting} onClick={() => void extractAnswers()} variant="primary">{extracting ? '正在识别答案…' : '自动识别并批改'}</Button></div>
        <img alt="透视矫正后的答题卡" src={mediaAssetUrl(attempt.correctedAssetPath)} />
        <div className="practice-capture-result__responses">{attempt.responses.map((response) => {
          const item = practiceSet.items.find((candidate) => candidate.id === response.practiceItemId)
          return item ? <PracticeResponseReview item={item} key={response.regionId} onChange={updateResponse} response={response} /> : null
        })}</div>
        <section className="practice-loop-summary" aria-label="Practice Loop 状态">
          <div><strong>Practice Loop</strong><span>{loop ? `第 ${loop.roundIndex} 轮 · 已使用 ${loop.consumedItems}/${loop.itemBudget} 题` : '批改确认后提交为学习证据'}</span></div>
          {loop?.status === 'mastered' ? <StatusTag kind="completed">已掌握</StatusTag>
            : loop?.status === 'stopped' ? <StatusTag kind="deferred">已结束</StatusTag>
              : loop ? <StatusTag kind="pending">继续练习</StatusTag> : null}
          <div className="practice-loop-summary__actions">
            {attempt.status !== 'completed' ? <Button disabled={!canFinalize || finalizing} onClick={() => void finalize()} variant="primary">{finalizing ? '正在写入 SkillState…' : '最终提交并更新能力'}</Button> : null}
            {loop?.status === 'active' && loop.nextPracticeSetId && loop.nextPracticeSetId !== practiceSet.id && onOpenPracticeSet
              ? <Button onClick={() => void openNextRound()} variant="primary">进入下一轮</Button> : null}
            {loop && (loop.status === 'active' || loop.status === 'needs_reinforcement')
              ? <Button onClick={() => void stopLoop()} variant="ghost">停止循环</Button> : null}
          </div>
          {loop?.stopReason === 'no_distinct_items' ? <p>没有找到同 Skill 且表面结构不同的已验证题目，本轮已安全结束，不重复原题。</p> : null}
          {loop?.stopReason === 'budget_reached' ? <p>已达到练习题量预算，本轮停止继续生成。</p> : null}
        </section>
      </section> : null}
    </section>
    {warnings.map((warning) => <p className="practice-warning" key={warning}>{warning}</p>)}
    <section className="practice-targets" aria-label="练习目标">
      <span>目标能力</span>
      {visibleTargets.map((target) => <Badge key={target.id}>{target.name}</Badge>)}
    </section>
    <section className="practice-list" aria-label="练习题目">
      {practiceSet.items.map((item) => <PracticeQuestion item={item} key={item.id} />)}
    </section>
  </main>
}

import { useEffect, useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { DiagramView } from '../../components/DiagramView'
import { MathMarkdown } from '../../components/MathMarkdown'
import { Badge, Button, StatusTag } from '../../components/ui'
import type { Diagram } from '../../domain/diagram'
import type { PracticeItem, PracticeSet } from '../../domain/practice'
import type { PracticeAttempt } from '../../domain/practiceAttempt'
import { listDiagrams } from '../../platform/diagramDatabase'
import { importImage, mediaAssetUrl } from '../../platform/native'
import { exportPracticePdf, openExportedPracticePdf, type PracticeDocumentRecord } from '../../platform/practiceDocumentDatabase'
import { capturePracticeAnswerSheet, getLatestPracticeAttempt } from '../../platform/practiceAttemptDatabase'
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

export function PracticeSetView({ practiceSet, onBack }: { practiceSet: PracticeSet; onBack: () => void }) {
  const [exporting, setExporting] = useState<PracticeDocumentType | null>(null)
  const [exported, setExported] = useState<PracticeDocumentRecord | null>(null)
  const [capturing, setCapturing] = useState(false)
  const [attempt, setAttempt] = useState<PracticeAttempt | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  const warnings = Array.isArray(practiceSet.generationMetadata.warnings)
    ? practiceSet.generationMetadata.warnings.filter((value): value is string => typeof value === 'string') : []
  const namedTargets = practiceSet.targetSkills.filter((target) => !target.id.startsWith('bundle:'))
  const visibleTargets = namedTargets.length ? namedTargets : practiceSet.targetSkills.slice(0, 1)
  useEffect(() => {
    let cancelled = false
    void getLatestPracticeAttempt(practiceSet.id).then((latest) => { if (!cancelled) setAttempt(latest) }).catch(() => null)
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
        <div><StatusTag kind="completed">页面已识别</StatusTag><span>方向矫正 {attempt.orientationDegrees}° · 已独立提取 {attempt.responses.length} 个答题区</span></div>
        <img alt="透视矫正后的答题卡" src={mediaAssetUrl(attempt.correctedAssetPath)} />
        <div className="practice-capture-result__responses">{attempt.responses.map((response) => <figure key={response.regionId}>
          <img alt={`第 ${response.regionIndex + 1} 个答题区域`} src={mediaAssetUrl(response.answerAssetPath)} />
          <figcaption>题目 {response.practiceItemId.slice(-8)}{response.pixelWidth ? ` · ${response.pixelWidth}×${response.pixelHeight}` : ''}</figcaption>
        </figure>)}</div>
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

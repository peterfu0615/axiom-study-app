import { useEffect, useState } from 'react'
import { DiagramView } from '../../components/DiagramView'
import { MathMarkdown } from '../../components/MathMarkdown'
import { Badge, Button, StatusTag } from '../../components/ui'
import type { Diagram } from '../../domain/diagram'
import type { PracticeItem, PracticeSet } from '../../domain/practice'
import { listDiagrams } from '../../platform/diagramDatabase'
import { mediaAssetUrl } from '../../platform/native'
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
  const warnings = Array.isArray(practiceSet.generationMetadata.warnings)
    ? practiceSet.generationMetadata.warnings.filter((value): value is string => typeof value === 'string') : []
  const namedTargets = practiceSet.targetSkills.filter((target) => !target.id.startsWith('bundle:'))
  const visibleTargets = namedTargets.length ? namedTargets : practiceSet.targetSkills.slice(0, 1)
  return <main className="workspace practice-workspace">
    <header className="practice-header">
      <Button onClick={onBack} variant="ghost">返回 Review Unit</Button>
      <div><p className="eyebrow">Practice Set</p><h1>针对性练习</h1><p>{practiceSet.subject} · {practiceSet.items.length} 题 · {practiceSet.strategy}</p></div>
      <StatusTag kind="pending">已保存</StatusTag>
    </header>
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

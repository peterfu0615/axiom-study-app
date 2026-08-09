import { useCallback, useEffect, useMemo, useState } from 'react'
import { Icon } from '../../components/Icon'
import { MathMarkdown } from '../../components/MathMarkdown'
import { AsyncState, Badge, Button, EmptyState, Progress, StatusBadge } from '../../components/ui'
import type { AppSection } from '../../components/Sidebar'
import type { ReviewRating } from '../../domain/review'
import {
  addTodayReviewUnit,
  deferTodayReviewUnit,
  getOrCreateTodayPlan,
  recordTodayReviewResult,
  refreshTodayPlan,
  replaceTodayReviewUnit,
  type TodayReviewPlan,
  type TodayReviewUnit,
} from '../../platform/reviewDatabase'
import './Today.css'

const difficultyLabels = { basic: '基础', intermediate: '中档', advanced: '压轴' }
const ratingOptions: Array<{ rating: ReviewRating; label: string; hint: string }> = [
  { rating: 'again', label: '忘记', hint: '需要很快再练' },
  { rating: 'hard', label: '困难', hint: '完成了但不够熟练' },
  { rating: 'good', label: '掌握', hint: '能够独立完成' },
  { rating: 'easy', label: '轻松', hint: '熟练且有余力' },
]

function minutes(seconds: number) {
  return Math.max(1, Math.round(seconds / 60))
}

function solutionContent(unit: TodayReviewUnit) {
  try {
    const solution = JSON.parse(unit.question.solutionJson) as {
      contentMarkdown?: string
      steps?: Array<{ title?: string; contentMarkdown?: string; content_markdown?: string }>
    }
    if (solution.contentMarkdown?.trim()) return solution.contentMarkdown
    const steps = solution.steps ?? []
    return steps.map((step) => [step.title ? `### ${step.title}` : '', step.contentMarkdown ?? step.content_markdown ?? ''].filter(Boolean).join('\n')).join('\n\n')
  } catch {
    return ''
  }
}

function unitSupportTags(unit: TodayReviewUnit) {
  const titleNames = new Set(unit.title.split(' · '))
  return [...unit.tags, ...unit.errorCategories]
    .filter((tag) => !titleNames.has(tag.name))
    .filter((tag, index, all) => all.findIndex((item) => `${item.type}:${item.id || item.name}` === `${tag.type}:${tag.id || tag.name}`) === index)
    .slice(0, 3)
}

function ReviewUnitRow({
  unit,
  busy,
  onStart,
  onReplace,
  onDefer,
}: {
  unit: TodayReviewUnit
  busy: boolean
  onStart: () => void
  onReplace: () => void
  onDefer: () => void
}) {
  const supportTags = unitSupportTags(unit)
  return <article className={`today-unit today-unit--${unit.status}`}>
    <div className="today-unit__order" aria-hidden="true">{unit.orderIndex + 1}</div>
    <div className="today-unit__body">
      <div className="today-unit__heading">
        <div>
          <span>{unit.subject}</span>
          <h2>{unit.title}</h2>
        </div>
        <StatusBadge tone={unit.status === 'completed' ? 'success' : unit.status === 'deferred' ? 'neutral' : 'brand'}>
          {unit.status === 'completed' ? '已完成' : unit.status === 'deferred' ? '已暂缓' : `${minutes(unit.estimatedDurationSeconds)} 分钟`}
        </StatusBadge>
      </div>
      <div className="today-unit__tags">
        <Badge>{unit.associationCount} 道相关错题</Badge>
        <Badge>{difficultyLabels[unit.difficulty]}</Badge>
        {supportTags.map((tag) => <Badge key={`${tag.type}:${tag.id || tag.name}`}>{tag.name}</Badge>)}
      </div>
      <p>{unit.status === 'completed' ? '本次复习已完成，后续时间已根据反馈更新' : unit.selectionReason}</p>
    </div>
    <div className="today-unit__actions">
      {unit.status === 'pending' && <>
        <Button disabled={busy} onClick={onStart} variant="primary">开始复习</Button>
        <Button disabled={busy} onClick={onReplace} variant="ghost">换一个</Button>
        <Button disabled={busy} onClick={onDefer} variant="ghost">稍后复习</Button>
      </>}
      {unit.status === 'completed' && unit.rating && <span className="today-unit__result">本次：{ratingOptions.find((item) => item.rating === unit.rating)?.label}</span>}
    </div>
  </article>
}

function ReviewRunner({
  unit,
  busy,
  onBack,
  onComplete,
}: {
  unit: TodayReviewUnit
  busy: boolean
  onBack: () => void
  onComplete: (rating: ReviewRating, durationSeconds: number) => Promise<void>
}) {
  const [revealed, setRevealed] = useState(false)
  const [startedAt] = useState(Date.now())
  const solution = useMemo(() => solutionContent(unit), [unit])
  return <main className="workspace today-workspace today-runner">
    <header className="today-runner__header">
      <Button onClick={onBack} variant="ghost">返回今日计划</Button>
      <span>{unit.subject} · {minutes(unit.estimatedDurationSeconds)} 分钟</span>
    </header>
    <section className="today-question" aria-label="复习题目">
      <div className="today-question__index">今日复习 · {unit.orderIndex + 1}</div>
      <h1>{unit.question.title}</h1>
      <MathMarkdown className="today-question__stem">{unit.question.stemMarkdown}</MathMarkdown>
    </section>
    {!revealed ? <section className="today-answer-gate">
      <h2>先独立完成，再查看解答</h2>
      <p>可以在纸上作答。确认完成后，标准解法和本次掌握反馈才会显示。</p>
      <Button onClick={() => setRevealed(true)} variant="primary">我已完成作答</Button>
    </section> : <section className="today-solution" aria-label="标准解答与复习结果">
      <div>
        <p className="eyebrow">标准解答</p>
        <h2>核对思路与关键步骤</h2>
      </div>
      {solution ? <MathMarkdown className="today-solution__content">{solution}</MathMarkdown> : <p className="today-solution__empty">这道题暂时没有完整解答。请根据你的订正结果完成本次掌握反馈。</p>}
      <div className="today-rating">
        <div><h3>这次完成得怎么样？</h3><p>反馈会用于安排下一次复习。</p></div>
        <div className="today-rating__options">
          {ratingOptions.map((option) => <Button disabled={busy} key={option.rating} onClick={() => onComplete(option.rating, Math.max(1, Math.round((Date.now() - startedAt) / 1000)))} variant={option.rating === 'good' ? 'primary' : 'secondary'}>
            <span className="today-rating__copy"><strong>{option.label}</strong><small>{option.hint}</small></span>
          </Button>)}
        </div>
      </div>
    </section>}
  </main>
}

export function TodayWorkspace({ onNavigate }: { onNavigate: (section: AppSection) => void }) {
  const [plan, setPlan] = useState<TodayReviewPlan | null>(null)
  const [activeUnitId, setActiveUnitId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try { setPlan(await getOrCreateTodayPlan()) }
    catch (reason) { setError(String(reason)) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  const mutate = async (operation: () => Promise<TodayReviewPlan | void>) => {
    setBusy(true); setError(null)
    try {
      const next = await operation()
      setPlan(next ?? await refreshTodayPlan())
    } catch (reason) { setError(String(reason)) }
    finally { setBusy(false) }
  }
  const activeUnit = plan?.units.find((unit) => unit.id === activeUnitId) ?? null
  if (activeUnit) return <ReviewRunner
    busy={busy}
    onBack={() => setActiveUnitId(null)}
    onComplete={async (rating, durationSeconds) => {
      await mutate(async () => {
        await recordTodayReviewResult({ questionId: activeUnit.question.id, rating, durationSeconds })
        return refreshTodayPlan()
      })
      setActiveUnitId(null)
    }}
    unit={activeUnit}
  />

  const completed = plan?.units.filter((unit) => unit.status === 'completed').length ?? 0
  const actionable = plan?.units.filter((unit) => unit.status !== 'deferred').length ?? 0
  const progress = actionable ? completed / actionable * 100 : 0
  return <main className="workspace today-workspace">
    <header className="workspace-header today-header">
      <div><p className="eyebrow">今天的学习计划</p><h1>今日</h1><p className="subtitle">集中复习真正重复出现的知识、方法与错误模式。</p></div>
      {plan && plan.units.length > 0 && <div className="today-header__summary"><strong>{completed}/{actionable}</strong><span>已完成</span></div>}
    </header>
    <AsyncState error={error} loading={loading} loadingLabel="正在整理今天的复习内容…" onRetry={load}>
      {plan && plan.units.length === 0 ? <EmptyState
        action={<Button onClick={() => void mutate(() => addTodayReviewUnit())} variant="primary">重新检查错题</Button>}
        description="保存并完成解析的错题会在这里形成复习模块。旧错题即使标签不完整，也会安全参与计划。"
        icon={<Icon name="today" size={22} />}
        secondaryAction={<><Button onClick={() => onNavigate('library')} variant="secondary">前往错题库</Button><Button onClick={() => onNavigate('curriculum')} variant="ghost">查看课程</Button></>}
        title="今天暂时没有可复习内容"
      /> : plan && <>
        <section className="today-overview">
          <div><strong>今天共 {actionable} 个复习单元</strong><span>预计 {minutes(plan.estimatedDurationSeconds)} 分钟</span></div>
          <Progress detail={`${completed} 个已完成`} label="今日进度" value={progress} />
        </section>
        <section className="today-units" aria-label="今日复习单元">
          {plan.units.map((unit) => <ReviewUnitRow
            busy={busy}
            key={unit.id}
            onDefer={() => void mutate(async () => { await deferTodayReviewUnit(unit.id) })}
            onReplace={() => void mutate(() => replaceTodayReviewUnit(unit.id))}
            onStart={() => setActiveUnitId(unit.id)}
            unit={unit}
          />)}
        </section>
        <div className="today-more"><Button disabled={busy} onClick={() => void mutate(() => addTodayReviewUnit())} variant="secondary">今日加练</Button></div>
      </>}
    </AsyncState>
    <footer className="today-horizon-mark">Powered by Horizon</footer>
  </main>
}

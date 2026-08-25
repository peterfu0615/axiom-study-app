import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from '../../components/Icon'
import { MathMarkdown } from '../../components/MathMarkdown'
import { AsyncState, Button, EmptyState, IconButton, PageHeader, SegmentedControl, StatusTag } from '../../components/ui'
import type { AppSection } from '../../components/Sidebar'
import type { ReviewForecastDay } from '../../domain/reviewForecast'
import type { PracticeSet } from '../../domain/practice'
import type { PracticeAttempt } from '../../domain/practiceAttempt'
import {
  addTodayReviewUnit,
  getOrCreateTodayPlan,
  getReviewForecast,
  listTodayCorrectionTasks,
  refreshTodayPlan,
  type TodayCorrectionTask,
  type TodayReviewPlan,
  type TodayReviewUnit,
} from '../../platform/reviewDatabase'
import {
  findPracticeSetForSource,
  getPracticeSet,
  getOrCreatePracticeSetFromTodayPlan,
} from '../../platform/practiceDatabase'
import { PracticeSetView } from '../practice/PracticeSetView'
import { getLatestPracticeAttempt, getPracticeAttempt } from '../../platform/practiceAttemptDatabase'
import { practiceErrorMessage } from '../practice/productLanguage'
import { LEARNING_STATE_EVENT } from '../../platform/learningStateEvents'
import { mediaAssetUrl } from '../../platform/native'
import {
  completePracticePreparation,
  claimPracticePreparation,
  createOrResumePracticePreparation,
  failPracticePreparation,
  getActivePracticePreparation,
  PRACTICE_PREPARATION_EVENT,
  updatePracticePreparationPhase,
  type PracticePreparationSnapshot,
} from '../../platform/practicePreparationDatabase'
import './Today.css'

const difficultyLabels = { basic: '基础', intermediate: '中档', advanced: '进阶' }
const unitStatusLabels = { completed: '已完成', deferred: '已稍后处理' }

function minutes(seconds: number) {
  return Math.max(1, Math.round(seconds / 60))
}

export type ForecastRange = 7 | 14 | 30

const forecastRangeOptions: Array<{ value: string; label: string }> = [
  { value: '7', label: '未来 7 天' },
  { value: '14', label: '未来 14 天' },
  { value: '30', label: '未来 30 天' },
]

function ForecastTimelineChart({ days }: { days: ReviewForecastDay[] }) {
  const [activeIndex, setActiveIndex] = useState(0)
  const width = 1000
  const height = 170
  const padLeft = 46
  const padRight = 24
  const padTop = 12
  const padBottom = 38
  const chartW = width - padLeft - padRight
  const chartH = height - padTop - padBottom

  const maxMinutes = Math.max(1, ...days.map((day) => day.estimatedMinutes))
  const stepX = chartW / Math.max(1, days.length)
  const barWidth = Math.max(4, Math.min(28, stepX * .58))
  const labelEvery = days.length <= 7 ? 1 : days.length <= 14 ? 2 : 5
  const active = days[Math.min(activeIndex, Math.max(0, days.length - 1))]

  return (
    <div className="today-forecast__chart-wrapper">
      <svg
        className="today-forecast__chart"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        aria-label="未来每日预计复习分钟数"
        role="img"
      >
        {[0, .5, 1].map((fraction) => {
          const y = padTop + chartH * (1 - fraction)
          return <g key={fraction}>
            <line x1={padLeft} y1={y} x2={width - padRight} y2={y} stroke="var(--ax-border-subtle)" strokeWidth="1" />
            <text className="today-forecast__axis-label" textAnchor="end" x={padLeft - 8} y={y + 4}>{Math.round(maxMinutes * fraction)}</text>
          </g>
        })}
        <line
          x1={padLeft}
          y1={padTop + chartH}
          x2={width - padRight}
          y2={padTop + chartH}
          stroke="var(--ax-border-subtle)"
          strokeWidth="1"
        />
        {days.map((day, index) => {
          const heightValue = day.estimatedMinutes / maxMinutes * chartH
          const x = padLeft + index * stepX + (stepX - barWidth) / 2
          const date = new Date(day.dayStart)
          const label = `${date.getMonth() + 1}/${date.getDate()}`
          const detail = `${label}，预计 ${day.estimatedMinutes} 分钟，${day.estimatedUnitCount} 组，${day.estimatedProblemCount} 题${day.overdueProblemCount ? `，含 ${day.overdueProblemCount} 道逾期` : ''}`
          return <g
            aria-label={detail}
            className={`today-forecast__bar${activeIndex === index ? ' is-active' : ''}`}
            key={day.date}
            onBlur={() => undefined}
            onFocus={() => setActiveIndex(index)}
            onMouseEnter={() => setActiveIndex(index)}
            role="img"
            tabIndex={0}
          >
            <title>{detail}</title>
            <rect fill="transparent" height={chartH + 14} width={Math.max(20, stepX)} x={padLeft + index * stepX} y={padTop - 7} />
            <rect
              className="today-forecast__bar-value"
              fill={index === 0 ? 'var(--brand-pressed)' : 'var(--brand)'}
              height={Math.max(day.estimatedMinutes ? 2 : 0, heightValue)}
              opacity={day.estimatedMinutes ? 1 : .18}
              rx="3"
              width={barWidth}
              x={x}
              y={padTop + chartH - heightValue}
            />
            {(index % labelEvery === 0 || index === days.length - 1) && <text className="today-forecast__axis-label" textAnchor="middle" x={x + barWidth / 2} y={height - 14}>{index === 0 ? '今天' : label}</text>}
          </g>
        })}
      </svg>
      {active && <div aria-live="polite" className="today-forecast__tooltip">
        <strong>{activeIndex === 0 ? '今天' : new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', weekday: 'short' }).format(new Date(active.dayStart))}</strong>
        <span>{active.estimatedMinutes} 分钟 · {active.estimatedUnitCount} 组 · {active.estimatedProblemCount} 题{active.overdueProblemCount ? ` · ${active.overdueProblemCount} 道逾期` : ''}</span>
      </div>}
    </div>
  )
}

function ForecastStrip({
  days,
  onRangeChange,
  range,
}: {
  days: ReviewForecastDay[]
  onRangeChange: (range: ForecastRange) => void
  range: ForecastRange
}) {
  return (
    <section className="today-forecast" aria-label="未来复习任务量">
      <div className="today-forecast__heading">
        <div>
          <h2>未来复习计划</h2>
          <small className="today-forecast__subheading">预计复习组、题目与每日分钟数</small>
        </div>
        <div className="today-forecast__controls">
          <SegmentedControl
            ariaLabel="预测时间范围"
            onChange={(value) => onRangeChange(Number(value) as ForecastRange)}
            options={forecastRangeOptions}
            value={String(range)}
          />
          <IconButton appearance="plain" label="假设每次复习都按时完成且结果良好；真实作答结果会立即重新计算后续任务。">
            <Icon name="info" size={14} />
          </IconButton>
        </div>
      </div>

      <ForecastTimelineChart days={days} />
    </section>
  )
}

function supportTags(unit: TodayReviewUnit) {
  const titleNames = new Set(unit.title.split(' · '))
  return [...unit.tags, ...unit.errorCategories]
    .filter((tag) => !titleNames.has(tag.name))
    .filter((tag, index, all) => all.findIndex((item) => `${item.type}:${item.id || item.name}` === `${tag.type}:${tag.id || tag.name}`) === index)
    .slice(0, 3)
}

function LearningTopicRow({ unit }: {
  unit: TodayReviewUnit
}) {
  const [expanded, setExpanded] = useState(false)
  const [imageFailed, setImageFailed] = useState(false)
  const supporting = supportTags(unit).map((tag) => tag.name)
  const primaryKnowledge = unit.tags.find((tag) => tag.type === 'knowledge' && tag.role === 'primary')?.name
    ?? unit.title.split(' · ')[0]
  const imagePath = unit.question.questionImagePath ?? unit.question.diagramImagePaths[0] ?? null
  return <article className={`today-unit today-unit--${unit.status}`}>
    <div className="today-unit__order" aria-hidden="true">{unit.status === 'completed' ? <Icon name="check" size={16} /> : String(unit.orderIndex + 1).padStart(2, '0')}</div>
    <button className="today-unit__body today-unit__expand" onClick={() => setExpanded((value) => !value)} type="button" aria-expanded={expanded}>
      <div className="today-unit__heading"><h2>{primaryKnowledge}</h2></div>
      <div className="today-unit__meta">
        <span>{unit.associationCount} 道关联题目</span>
        <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={14} />
      </div>
      {expanded && <div className="today-unit__details">
        <div className="today-unit__detail-copy">
          <strong>{unit.question.title}</strong>
          <span>{unit.subject} · {difficultyLabels[unit.difficulty]}</span>
          <MathMarkdown className="today-unit__stem">{unit.question.stemMarkdown}</MathMarkdown>
        </div>
        {imagePath && !imageFailed && <img
          alt={`${unit.question.title}的题目图片`}
          className="today-unit__image"
          decoding="async"
          loading="lazy"
          onError={() => setImageFailed(true)}
          src={mediaAssetUrl(imagePath)}
        />}
        {supporting.length > 0 && <small>{supporting.join(' · ')}</small>}
      </div>}
    </button>
    <div className="today-unit__aside">
      {unit.status !== 'pending' && <StatusTag kind={unit.status}>{unitStatusLabels[unit.status]}</StatusTag>}
    </div>
  </article>
}

type PreparationPhase = 'selecting' | 'generating' | 'verifying' | 'rendering'
const activePreparationRuns = new Map<string, Promise<{ practiceSet: PracticeSet; attempt: PracticeAttempt | null }>>()

function PracticePreparationView({ snapshot }: { snapshot: PracticePreparationSnapshot }) {
  const labels: Record<PreparationPhase, string> = {
    selecting: '正在选择题目', generating: '正在生成所需变式', verifying: '正在独立审校', rendering: '正在准备图形与练习页',
  }
  const order: PreparationPhase[] = ['selecting', 'generating', 'verifying', 'rendering']
  const phase = order.includes(snapshot.status as PreparationPhase) ? snapshot.status as PreparationPhase : 'rendering'
  const active = order.indexOf(phase)
  return <main className="workspace today-workspace practice-preparation" aria-live="polite">
    <PageHeader eyebrow="今日练习" title="正在准备练习" summary={`${snapshot.totalSlots} 个学习主题 · 窗口可继续移动和操作`} />
    <section className="practice-preparation__card">
      <div className="practice-preparation__spinner" aria-hidden="true" />
      <h2>{labels[phase]}</h2>
      <p>AI、TikZ 与文件排版都在后台执行，完成安全兜底后会自动进入练习。</p>
      <ol>{order.map((item, index) => <li className={index <= active ? 'is-active' : ''} key={item}>{labels[item]}</li>)}</ol>
    </section>
  </main>
}

export function TodayWorkspace({ onNavigate }: { onNavigate: (section: AppSection) => void }) {
  const [plan, setPlan] = useState<TodayReviewPlan | null>(null)
  const [forecast, setForecast] = useState<ReviewForecastDay[]>([])
  const [corrections, setCorrections] = useState<TodayCorrectionTask[]>([])
  const [forecastRange, setForecastRange] = useState<ForecastRange>(7)
  const forecastRangeRef = useRef<ForecastRange>(7)
  forecastRangeRef.current = forecastRange
  const [activePracticeSet, setActivePracticeSet] = useState<PracticeSet | null>(null)
  const [activeAttempt, setActiveAttempt] = useState<PracticeAttempt | null>(null)
  const [todayPracticeSet, setTodayPracticeSet] = useState<PracticeSet | null>(null)
  const [todayAttempt, setTodayAttempt] = useState<PracticeAttempt | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preparation, setPreparation] = useState<PracticePreparationSnapshot | null>(null)

  const refreshForecast = useCallback(async (range: ForecastRange) => {
    try { setForecast(await getReviewForecast(range)) }
    catch (reason) { console.warn('复习预测加载失败：', reason) }
  }, [])

  const runPreparation = useCallback(async (
    snapshot: PracticePreparationSnapshot,
    nextPlan: TodayReviewPlan,
    existingPracticeSet: PracticeSet | null,
  ) => {
    let task = activePreparationRuns.get(snapshot.id)
    if (!task) {
      task = (async () => {
        const generating = await claimPracticePreparation(snapshot.id, snapshot.updatedAt)
        if (!generating) throw new Error('练习准备作业已由另一个窗口恢复')
        const moduleIds = nextPlan.units.filter((unit) => unit.status === 'pending').map((unit) => unit.id)
        const budget = Math.max(3, moduleIds.length * 2)
        const practiceSet = existingPracticeSet?.sessionMode === snapshot.sessionMode
          ? existingPracticeSet
          : await getOrCreatePracticeSetFromTodayPlan(nextPlan.id, moduleIds, budget, snapshot.sessionMode)
        await updatePracticePreparationPhase(snapshot.id, 'verifying')
        await updatePracticePreparationPhase(snapshot.id, 'rendering')
        const attempt = await getLatestPracticeAttempt(practiceSet.id)
        await completePracticePreparation(snapshot.id, practiceSet.id)
        return { practiceSet, attempt }
      })()
      activePreparationRuns.set(snapshot.id, task)
      void task.finally(() => {
        if (activePreparationRuns.get(snapshot.id) === task) activePreparationRuns.delete(snapshot.id)
      }).catch(() => undefined)
    }
    try {
      const { practiceSet, attempt } = await task
      setTodayPracticeSet(practiceSet); setTodayAttempt(attempt); setActiveAttempt(attempt); setActivePracticeSet(practiceSet)
    } catch (reason) {
      await failPracticePreparation(snapshot.id, reason).catch(() => undefined)
      setError(practiceErrorMessage(reason))
    } finally {
      setPreparation(null)
    }
  }, [])

  const load = useCallback(async (isCancelled: () => boolean = () => false) => {
    setLoading(true); setError(null)
    try {
      // The forward forecast is independent of today's plan; overlap it with
      // the practice-set lookup instead of waiting for both sequentially.
      const nextPlan = await getOrCreateTodayPlan()
      const [nextForecast, existingPracticeSet, nextCorrections, activePreparation] = await Promise.all([
        getReviewForecast(forecastRangeRef.current),
        findPracticeSetForSource('today', nextPlan.id, nextPlan.preferences.preferredMode),
        listTodayCorrectionTasks(),
        getActivePracticePreparation('today', nextPlan.id, nextPlan.preferences.preferredMode),
      ])
      if (isCancelled()) return
      setPlan(nextPlan); setForecast(nextForecast); setCorrections(nextCorrections)
      setTodayPracticeSet(existingPracticeSet)
      setTodayAttempt(existingPracticeSet ? await getLatestPracticeAttempt(existingPracticeSet.id) : null)
      if (activePreparation) {
        setPreparation(activePreparation)
        window.requestAnimationFrame(() => void runPreparation(activePreparation, nextPlan, existingPracticeSet))
      }
    } catch (reason) { if (!isCancelled()) setError(practiceErrorMessage(reason)) }
    finally { if (!isCancelled()) setLoading(false) }
  }, [runPreparation])
  useEffect(() => {
    let cancelled = false
    void load(() => cancelled)
    return () => { cancelled = true }
  }, [load])
  useEffect(() => {
    const update = (event: Event) => {
      const snapshot = (event as CustomEvent<PracticePreparationSnapshot>).detail
      if (!snapshot || snapshot.sourceType !== 'today') return
      setPreparation((current) => current && (current.id === 'pending' || current.id === snapshot.id)
        ? (snapshot.status === 'ready' || snapshot.status === 'failed' ? current : snapshot)
        : current)
    }
    window.addEventListener(PRACTICE_PREPARATION_EVENT, update)
    return () => window.removeEventListener(PRACTICE_PREPARATION_EVENT, update)
  }, [])
  useEffect(() => {
    const refresh = () => {
      void refreshForecast(forecastRangeRef.current)
      void listTodayCorrectionTasks().then(setCorrections).catch(() => undefined)
    }
    window.addEventListener(LEARNING_STATE_EVENT, refresh)
    window.addEventListener('focus', refresh)
    const timer = window.setInterval(refresh, 60_000)
    return () => {
      window.removeEventListener(LEARNING_STATE_EVENT, refresh)
      window.removeEventListener('focus', refresh)
      window.clearInterval(timer)
    }
  }, [refreshForecast])

  const changeForecastRange = (range: ForecastRange) => {
    setForecastRange(range)
    void refreshForecast(range)
  }

  const mutate = async (operation: () => Promise<TodayReviewPlan | void>) => {
    setBusy(true); setError(null)
    try {
      const next = await operation()
      setPlan(next ?? await refreshTodayPlan())
      void refreshForecast(forecastRangeRef.current)
    } catch (reason) { setError(practiceErrorMessage(reason)) }
    finally { setBusy(false) }
  }
  const openTodayPractice = () => {
    if (!plan) return
    const sessionMode = plan.preferences.preferredMode
    const moduleIds = plan.units.filter((unit) => unit.status === 'pending').map((unit) => unit.id)
    setError(null)
    const optimistic: PracticePreparationSnapshot = {
      id: 'pending', sourceType: 'today', sourceRef: plan.id, sessionMode,
      status: 'selecting', totalSlots: moduleIds.length, practiceSetId: null,
      safeErrorCode: null, errorMessage: null, updatedAt: Date.now(), slots: [],
    }
    setPreparation(optimistic)
    window.requestAnimationFrame(() => void (async () => {
      try {
        const snapshot = await createOrResumePracticePreparation({
          sourceType: 'today', sourceRef: plan.id, sessionMode, slotRefs: moduleIds,
        })
        setPreparation(snapshot)
        await runPreparation(snapshot, plan, todayPracticeSet)
      } catch (reason) { setPreparation(null); setError(practiceErrorMessage(reason)) }
    })())
  }

  const openCorrection = async (task: TodayCorrectionTask) => {
    setBusy(true); setError(null)
    try {
      const [practiceSet, attempt] = await Promise.all([
        getPracticeSet(task.practiceSetId),
        getPracticeAttempt(task.practiceAttemptId),
      ])
      if (!practiceSet || !attempt) throw new Error('找不到这组待订正练习')
      setActiveAttempt(attempt)
      setActivePracticeSet(practiceSet)
    } catch (reason) { setError(practiceErrorMessage(reason)) }
    finally { setBusy(false) }
  }

  if (activePracticeSet) return <PracticeSetView
    onBack={() => { setActivePracticeSet(null); setActiveAttempt(null); void load() }}
    onOpenPracticeSet={setActivePracticeSet}
    initialAttempt={activeAttempt?.practiceSetId === activePracticeSet.id ? activeAttempt : undefined}
    initialMode={activeAttempt?.practiceSetId === activePracticeSet.id && (
      corrections.some((task) => task.practiceAttemptId === activeAttempt.id) || activeAttempt.status === 'completed'
    ) ? 'results' : undefined}
    practiceSet={activePracticeSet}
  />
  if (preparation) return <PracticePreparationView snapshot={preparation} />

  const actionableUnits = plan?.units.filter((unit) => unit.status !== 'deferred') ?? []
  const completed = actionableUnits.filter((unit) => unit.status === 'completed').length
  const pendingUnits = plan?.units.filter((unit) => unit.status === 'pending') ?? []
  const now = new Date()
  const todayDate = `${now.getMonth() + 1} 月 ${now.getDate()} 日 · ${new Intl.DateTimeFormat('zh-CN', { weekday: 'short' }).format(now)}`
  const practiceCta = !todayPracticeSet
    ? '生成今日练习'
    : todayAttempt?.status === 'completed'
      ? '查看结果'
      : todayAttempt && ['capturing', 'captured', 'extracting', 'extracted', 'grading'].includes(todayAttempt.status)
        ? '查看批改进度'
      : '查看今日练习'
  const correctionProblems = corrections.reduce((sum, task) => sum + task.pendingProblemCount, 0)
  const correctionMinutes = corrections.reduce((sum, task) => sum + task.estimatedMinutes, 0)
  return <main className="workspace today-workspace">
    <PageHeader
      actions={plan && plan.units.length > 0 ? <div className="today-header__actions">
        <Button className="today-header__cta" disabled={busy || (!todayPracticeSet && pendingUnits.length === 0)} onClick={openTodayPractice} variant="primary">{practiceCta}</Button>
      </div> : undefined}
      className="today-header"
      eyebrow={todayDate}
      summary={plan ? `${completed} / ${actionableUnits.length} · 复习 ${minutes(plan.estimatedDurationSeconds)} 分钟${correctionProblems ? ` · 待订正 ${correctionProblems} 题` : ''}` : undefined}
      title="今日"
    />
    <AsyncState error={error} loading={loading} loadingLabel="正在准备今天的学习内容…" onRetry={load}>
      {corrections.length > 0 && <section className="today-corrections" aria-label="待订正练习">
        <header>
          <div><p className="eyebrow">先完成学习闭环</p><h2>待订正</h2></div>
          <span>{correctionProblems} 题 · 预计 {correctionMinutes} 分钟</span>
        </header>
        {corrections.map((task) => <article key={task.id}>
          <div><strong>{task.subject}练习</strong><span>{task.pendingProblemCount} 道结果尚未确认</span></div>
          <Button disabled={busy} onClick={() => void openCorrection(task)} variant="secondary">继续订正</Button>
        </article>)}
      </section>}
      {plan && plan.units.length === 0 ? <EmptyState
        action={<Button onClick={() => void mutate(() => addTodayReviewUnit())} variant="primary">重新检查</Button>}
        description="保存并完成解析的错题会在这里形成适合今天练习的学习主题。题目会根据上一次已确认练习在原题与变式间自动轮换。"
        icon={<Icon name="today" size={22} />}
        secondaryAction={<><Button onClick={() => onNavigate('library')} variant="secondary">前往错题库</Button><Button onClick={() => onNavigate('curriculum')} variant="ghost">查看课程</Button></>}
        title="今天暂时没有学习安排"
      /> : plan && <>
        <section className="today-units" aria-label="今日学习主题">
          {plan.units.map((unit) => <LearningTopicRow key={unit.id} unit={unit} />)}
        </section>
      </>}
      {plan && forecast.length > 0 && <ForecastStrip days={forecast} onRangeChange={changeForecastRange} range={forecastRange} />}
    </AsyncState>
  </main>
}

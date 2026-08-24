import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from '../../components/Icon'
import { AsyncState, Button, EmptyState, IconButton, Menu, MenuItem, PageHeader, SegmentedControl, StatusTag } from '../../components/ui'
import type { AppSection } from '../../components/Sidebar'
import type { ReviewForecastDay } from '../../domain/reviewForecast'
import type { PracticeSet, VariantGenerationMode } from '../../domain/practice'
import type { PracticeAttempt } from '../../domain/practiceAttempt'
import type { ReviewSessionMode } from '../../domain/review'
import {
  addTodayReviewUnit,
  deferTodayReviewUnit,
  getOrCreateTodayPlan,
  getReviewForecast,
  listTodayCorrectionTasks,
  refreshTodayPlan,
  type TodayCorrectionTask,
  replaceTodayReviewUnit,
  type TodayReviewPlan,
  type TodayReviewUnit,
} from '../../platform/reviewDatabase'
import {
  findPracticeSetForSource,
  getPracticeSet,
  getOrCreatePracticeSetFromReviewUnit,
  getOrCreatePracticeSetFromTodayPlan,
} from '../../platform/practiceDatabase'
import { PracticeSetView } from '../practice/PracticeSetView'
import { getLatestPracticeAttempt, getPracticeAttempt } from '../../platform/practiceAttemptDatabase'
import { practiceErrorMessage } from '../practice/productLanguage'
import { LEARNING_STATE_EVENT } from '../../platform/learningStateEvents'
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
  const width = 1000
  const height = 120
  const padLeft = 24
  const padRight = 24
  const padTop = 12
  const padBottom = 24
  const chartW = width - padLeft - padRight
  const chartH = height - padTop - padBottom

  const maxMinutes = Math.max(1, ...days.map((day) => day.estimatedMinutes))
  const stepX = chartW / Math.max(1, days.length)
  const barWidth = Math.max(4, Math.min(28, stepX * .58))

  return (
    <div className="today-forecast__chart-wrapper">
      <svg
        className="today-forecast__chart"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
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
          return <rect
            fill={index === 0 ? 'var(--brand-pressed)' : 'var(--brand)'}
            height={heightValue}
            key={day.date}
            opacity={day.estimatedMinutes ? 1 : .18}
            rx="3"
            width={barWidth}
            x={x}
            y={padTop + chartH - heightValue}
          />
        })}
      </svg>
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

      {/* 时间轴详情卡片列表 */}
      <div className={`today-forecast__days${range > 7 ? ' is-scrollable' : ''}`}>
        {days.map((day, index) => {
          const date = new Date(day.dayStart)
          const weekday = index === 0 ? '今天' : new Intl.DateTimeFormat('zh-CN', { weekday: 'short' }).format(date)
          return (
            <article
              className={`today-forecast__day today-forecast__day--${day.loadLevel}${
                index === 0 ? ' is-today' : ''
              }`}
              key={day.date}
            >
              <div>
                <strong>{weekday}</strong>
                <span>{date.getMonth() + 1}/{date.getDate()}</span>
              </div>
              <div className="today-forecast__metric-pill">
                <strong>{day.estimatedMinutes}</strong>
                <span>分钟</span>
              </div>
              <span className="today-forecast__problem-count">
                {day.estimatedUnitCount} 组 · {day.estimatedProblemCount} 题
              </span>
              <small>{day.overdueProblemCount ? `含 ${day.overdueProblemCount} 道逾期` : '按预计日期安排'}</small>
            </article>
          )
        })}
      </div>
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

function LearningTopicRow({ unit, busy, onPractice, onReplace, onDefer, preferredMode = 'standard' }: {
  unit: TodayReviewUnit
  busy: boolean
  onPractice: (mode?: ReviewSessionMode) => void
  onReplace: () => void
  onDefer: () => void
  preferredMode?: ReviewSessionMode
}) {
  const supporting = supportTags(unit).map((tag) => tag.name)
  return <article className={`today-unit today-unit--${unit.status}`}>
    <div className="today-unit__order" aria-hidden="true">{unit.status === 'completed' ? <Icon name="check" size={16} /> : String(unit.orderIndex + 1).padStart(2, '0')}</div>
    <div className="today-unit__body">
      <div className="today-unit__heading"><h2>{unit.title}</h2></div>
      <div className="today-unit__meta">
        <span>{unit.subject} · {difficultyLabels[unit.difficulty]}</span>
        <span>{supporting.length ? `${supporting.join(' · ')} · ` : ''}{unit.associationCount} 道相关题</span>
      </div>
    </div>
    <div className="today-unit__aside">
      {unit.status !== 'pending' && <StatusTag kind={unit.status}>{unitStatusLabels[unit.status]}</StatusTag>}
      {unit.status === 'pending' && <div className="today-unit__actions">
        <Button disabled={busy} onClick={() => onPractice(preferredMode)} variant="secondary">生成练习</Button>
        <Menu label={`${unit.title}的更多操作`}>
          <MenuItem disabled={busy} onClick={() => onPractice('quick')}>快速复习</MenuItem>
          <MenuItem disabled={busy} onClick={() => onPractice('mock_test')}>模拟测试</MenuItem>
          <MenuItem disabled={busy} onClick={onReplace}>换一个主题</MenuItem>
          <MenuItem disabled={busy} onClick={onDefer}>稍后处理</MenuItem>
        </Menu>
      </div>}
    </div>
  </article>
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
  const [variantMode, setVariantMode] = useState<VariantGenerationMode>('variant_preferred')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refreshForecast = useCallback(async (range: ForecastRange) => {
    try { setForecast(await getReviewForecast(range)) }
    catch (reason) { console.warn('复习预测加载失败：', reason) }
  }, [])

  const load = useCallback(async (isCancelled: () => boolean = () => false) => {
    setLoading(true); setError(null)
    try {
      // The forward forecast is independent of today's plan; overlap it with
      // the practice-set lookup instead of waiting for both sequentially.
      const nextPlan = await getOrCreateTodayPlan()
      const [nextForecast, existingPracticeSet, nextCorrections] = await Promise.all([
        getReviewForecast(forecastRangeRef.current),
        findPracticeSetForSource('today', nextPlan.id, nextPlan.preferences.preferredMode),
        listTodayCorrectionTasks(),
      ])
      if (isCancelled()) return
      setPlan(nextPlan); setForecast(nextForecast); setCorrections(nextCorrections); setVariantMode(nextPlan.preferences.variantMode)
      setTodayPracticeSet(existingPracticeSet)
      setTodayAttempt(existingPracticeSet ? await getLatestPracticeAttempt(existingPracticeSet.id) : null)
    } catch (reason) { if (!isCancelled()) setError(practiceErrorMessage(reason)) }
    finally { if (!isCancelled()) setLoading(false) }
  }, [])
  useEffect(() => {
    let cancelled = false
    void load(() => cancelled)
    return () => { cancelled = true }
  }, [load])
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
  const openTodayPractice = async (sessionMode: ReviewSessionMode = 'standard') => {
    if (!plan) return
    setBusy(true); setError(null)
    try {
      const moduleIds = plan.units.filter((unit) => unit.status === 'pending').map((unit) => unit.id)
      const budget = sessionMode === 'quick' ? Math.max(1, moduleIds.length)
        : sessionMode === 'mock_test' ? Math.max(4, moduleIds.length * 3) : Math.max(3, moduleIds.length * 2)
      const next = todayPracticeSet?.sessionMode === sessionMode
        && (todayPracticeSet.generationMetadata.variantMode ?? 'variant_preferred') === variantMode
        ? todayPracticeSet
        : await getOrCreatePracticeSetFromTodayPlan(plan.id, moduleIds, budget, sessionMode, variantMode)
      const attempt = await getLatestPracticeAttempt(next.id)
      setTodayPracticeSet(next); setTodayAttempt(attempt); setActiveAttempt(attempt); setActivePracticeSet(next)
    } catch (reason) { setError(practiceErrorMessage(reason)) }
    finally { setBusy(false) }
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
        <SegmentedControl
          ariaLabel="题目来源"
          onChange={(value) => setVariantMode(value as VariantGenerationMode)}
          options={[{ value: 'variant_preferred', label: '变式优先' }, { value: 'original_only', label: '仅原题' }]}
          value={variantMode}
        />
        <Button className="today-header__cta" disabled={busy || (!todayPracticeSet && pendingUnits.length === 0)} loading={busy} onClick={() => void openTodayPractice(plan.preferences.preferredMode)} variant="primary">{practiceCta}</Button>
        <Menu label="选择练习模式">
          <MenuItem disabled={busy} onClick={() => void openTodayPractice('quick')}>快速复习</MenuItem>
          <MenuItem disabled={busy} onClick={() => void openTodayPractice('mock_test')}>模拟测试</MenuItem>
        </Menu>
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
        description="保存并完成解析的错题会在这里形成适合今天练习的学习主题。"
        icon={<Icon name="today" size={22} />}
        secondaryAction={<><Button onClick={() => onNavigate('library')} variant="secondary">前往错题库</Button><Button onClick={() => onNavigate('curriculum')} variant="ghost">查看课程</Button></>}
        title="今天暂时没有学习安排"
      /> : plan && <>
        <section className="today-units" aria-label="今日学习主题">
          {plan.units.map((unit) => <LearningTopicRow
            busy={busy}
            key={unit.id}
            onDefer={() => void mutate(async () => { await deferTodayReviewUnit(unit.id) })}
            onReplace={() => void mutate(() => replaceTodayReviewUnit(unit.id))}
            onPractice={(sessionMode = 'standard') => void (async () => {
              setBusy(true); setError(null)
              try {
                const budget = sessionMode === 'quick' ? 1 : sessionMode === 'mock_test' ? 5 : 3
                setActivePracticeSet(await getOrCreatePracticeSetFromReviewUnit(unit.id, budget, sessionMode, variantMode))
              }
              catch (reason) { setError(practiceErrorMessage(reason)) }
              finally { setBusy(false) }
            })()}
            preferredMode={plan.preferences.preferredMode}
            unit={unit}
          />)}
        </section>
      </>}
      {plan && forecast.length > 0 && <ForecastStrip days={forecast} onRangeChange={changeForecastRange} range={forecastRange} />}
    </AsyncState>
  </main>
}

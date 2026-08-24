import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from '../../components/Icon'
import { AsyncState, Button, EmptyState, IconButton, Menu, MenuItem, PageHeader, SegmentedControl, StatusTag } from '../../components/ui'
import type { AppSection } from '../../components/Sidebar'
import type { ReviewForecastDay } from '../../domain/reviewForecast'
import type { PracticeSet } from '../../domain/practice'
import type { PracticeAttempt } from '../../domain/practiceAttempt'
import type { ReviewSessionMode } from '../../domain/review'
import {
  addTodayReviewUnit,
  deferTodayReviewUnit,
  getOrCreateTodayPlan,
  getReviewForecast,
  refreshTodayPlan,
  replaceTodayReviewUnit,
  type TodayReviewPlan,
  type TodayReviewUnit,
} from '../../platform/reviewDatabase'
import {
  findPracticeSetForSource,
  getOrCreatePracticeSetFromReviewUnit,
  getOrCreatePracticeSetFromTodayPlan,
} from '../../platform/practiceDatabase'
import { PracticeSetView } from '../practice/PracticeSetView'
import { getLatestPracticeAttempt } from '../../platform/practiceAttemptDatabase'
import { practiceErrorMessage } from '../practice/productLanguage'
import './Today.css'

const difficultyLabels = { basic: '基础', intermediate: '中档', advanced: '进阶' }
const loadLabels = { empty: '无负载', light: '轻', normal: '中', heavy: '重' }
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
  const maxProblems = Math.max(1, ...days.map((d) => d.estimatedProblemCount))
  const width = 1000
  const height = 120
  const padLeft = 24
  const padRight = 24
  const padTop = 16
  const padBottom = 24
  const chartW = width - padLeft - padRight
  const chartH = height - padTop - padBottom

  const stepX = days.length > 1 ? chartW / (days.length - 1) : chartW

  const points = days.map((day, i) => {
    const x = padLeft + i * stepX
    const yRatio = day.estimatedProblemCount / maxProblems
    const y = padTop + chartH - yRatio * chartH
    return { x, y, day, index: i }
  })

  const pathD = points.reduce((acc, pt, i) => {
    if (i === 0) return `M ${pt.x} ${pt.y}`
    const prev = points[i - 1]
    const cx = (prev.x + pt.x) / 2
    return `${acc} C ${cx} ${prev.y}, ${cx} ${pt.y}, ${pt.x} ${pt.y}`
  }, '')

  const areaD = pathD
    ? `${pathD} L ${points[points.length - 1].x} ${padTop + chartH} L ${points[0].x} ${padTop + chartH} Z`
    : ''

  return (
    <div className="today-forecast__chart-wrapper">
      <svg
        className="today-forecast__chart"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="forecastAreaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--brand)" stopOpacity="0.32" />
            <stop offset="100%" stopColor="var(--brand)" stopOpacity="0.0" />
          </linearGradient>
          <linearGradient id="forecastLineGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--brand-pressed)" />
            <stop offset="50%" stopColor="var(--brand)" />
            <stop offset="100%" stopColor="var(--brand-hover)" />
          </linearGradient>
        </defs>
        {/* 基线 */}
        <line
          x1={padLeft}
          y1={padTop + chartH}
          x2={width - padRight}
          y2={padTop + chartH}
          stroke="var(--ax-border-subtle)"
          strokeWidth="1"
        />
        {/* 区域渐变 */}
        {areaD && <path d={areaD} fill="url(#forecastAreaGrad)" />}
        {/* 平滑曲线 */}
        {pathD && (
          <path
            d={pathD}
            fill="none"
            stroke="url(#forecastLineGrad)"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        )}
        {/* 节点标记 */}
        {points.map((pt) => (
          <g key={pt.day.date} className="today-forecast__node">
            <circle
              cx={pt.x}
              cy={pt.y}
              r={pt.day.estimatedProblemCount > 0 ? (pt.index === 0 ? 4.5 : 3.5) : 2}
              fill={pt.index === 0 ? 'var(--brand-pressed)' : 'var(--ax-color-surface)'}
              stroke="var(--brand)"
              strokeWidth={pt.index === 0 ? 2 : 1.5}
            />
          </g>
        ))}
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
    <section className="today-forecast" aria-label="未来复习计划与艾宾浩斯记忆负载">
      <div className="today-forecast__heading">
        <div>
          <h2>未来复习计划</h2>
          <small className="today-forecast__subheading">艾宾浩斯遗忘衰减负荷曲线预测</small>
        </div>
        <div className="today-forecast__controls">
          <SegmentedControl
            ariaLabel="预测时间范围"
            onChange={(value) => onRangeChange(Number(value) as ForecastRange)}
            options={forecastRangeOptions}
            value={String(range)}
          />
          <IconButton appearance="plain" label="基于艾宾浩斯记忆遗忘曲线（Ebbinghaus Curve）动态推导未来到期错题，随作答反馈不断自适应调整。">
            <Icon name="info" size={14} />
          </IconButton>
        </div>
      </div>

      {/* 艾宾浩斯平滑折线负荷图 */}
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
                <strong>{day.estimatedUnitCount}</strong>
                <span>组主题</span>
              </div>
              <span className="today-forecast__problem-count">
                {day.estimatedProblemCount ? `约 ${day.estimatedProblemCount} 题` : '无到期题'}
              </span>
              <small>{loadLabels[day.loadLevel]}</small>
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
  const [forecastRange, setForecastRange] = useState<ForecastRange>(7)
  const forecastRangeRef = useRef<ForecastRange>(7)
  forecastRangeRef.current = forecastRange
  const [activePracticeSet, setActivePracticeSet] = useState<PracticeSet | null>(null)
  const [todayPracticeSet, setTodayPracticeSet] = useState<PracticeSet | null>(null)
  const [todayAttempt, setTodayAttempt] = useState<PracticeAttempt | null>(null)
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
      const [nextForecast, existingPracticeSet] = await Promise.all([
        getReviewForecast(forecastRangeRef.current),
        findPracticeSetForSource('today', nextPlan.id, nextPlan.preferences.preferredMode),
      ])
      if (isCancelled()) return
      setPlan(nextPlan); setForecast(nextForecast)
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
        ? todayPracticeSet
        : await getOrCreatePracticeSetFromTodayPlan(plan.id, moduleIds, budget, sessionMode)
      setTodayPracticeSet(next); setTodayAttempt(await getLatestPracticeAttempt(next.id)); setActivePracticeSet(next)
    } catch (reason) { setError(practiceErrorMessage(reason)) }
    finally { setBusy(false) }
  }

  if (activePracticeSet) return <PracticeSetView
    onBack={() => { setActivePracticeSet(null); void load() }}
    onOpenPracticeSet={setActivePracticeSet}
    initialAttempt={todayAttempt?.practiceSetId === activePracticeSet.id ? todayAttempt : undefined}
    initialMode={todayAttempt?.practiceSetId === activePracticeSet.id && todayAttempt.status === 'completed' ? 'results' : undefined}
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
  return <main className="workspace today-workspace">
    <PageHeader
      actions={plan && plan.units.length > 0 ? <div className="today-header__actions">
        <Button className="today-header__cta" disabled={busy || (!todayPracticeSet && pendingUnits.length === 0)} loading={busy} onClick={() => void openTodayPractice(plan.preferences.preferredMode)} variant="primary">{practiceCta}</Button>
        <Menu label="选择练习模式">
          <MenuItem disabled={busy} onClick={() => void openTodayPractice('quick')}>快速复习</MenuItem>
          <MenuItem disabled={busy} onClick={() => void openTodayPractice('mock_test')}>模拟测试</MenuItem>
        </Menu>
      </div> : undefined}
      className="today-header"
      eyebrow={todayDate}
      summary={plan ? `${completed} / ${actionableUnits.length} · 共预计 ${minutes(plan.estimatedDurationSeconds)} 分钟` : undefined}
      title="今日"
    />
    <AsyncState error={error} loading={loading} loadingLabel="正在准备今天的学习内容…" onRetry={load}>
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
                setActivePracticeSet(await getOrCreatePracticeSetFromReviewUnit(unit.id, budget, sessionMode))
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

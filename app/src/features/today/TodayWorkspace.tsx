import { useCallback, useEffect, useState } from 'react'
import { Icon } from '../../components/Icon'
import { AsyncState, Button, EmptyState, IconButton, Menu, MenuItem, StatusTag } from '../../components/ui'
import type { AppSection } from '../../components/Sidebar'
import type { ReviewForecastDay } from '../../domain/reviewForecast'
import type { PracticeSet } from '../../domain/practice'
import type { PracticeAttempt } from '../../domain/practiceAttempt'
import {
  addTodayReviewUnit,
  deferTodayReviewUnit,
  getOrCreateTodayPlan,
  getSevenDayReviewForecast,
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

function ForecastStrip({ days }: { days: ReviewForecastDay[] }) {
  const maxUnits = Math.max(1, ...days.map((day) => day.estimatedUnitCount))
  return <section className="today-forecast" aria-label="未来 7 天学习安排">
    <div className="today-forecast__heading">
      <h2>未来 7 天</h2>
      <IconButton appearance="plain" label="按当前学习状态估算，实际安排会随练习结果变化。"><span aria-hidden="true">ⓘ</span></IconButton>
    </div>
    <div className="today-forecast__days">
      {days.map((day, index) => {
        const date = new Date(day.dayStart)
        const weekday = index === 0 ? '今天' : new Intl.DateTimeFormat('zh-CN', { weekday: 'short' }).format(date)
        return <article className={`today-forecast__day today-forecast__day--${day.loadLevel}${index === 0 ? ' is-today' : ''}`} key={day.date}>
          <div><strong>{weekday}</strong><span>{date.getMonth() + 1}/{date.getDate()}</span></div>
          <div className="today-forecast__track" aria-hidden="true"><i style={{ height: `${Math.max(day.estimatedUnitCount ? 18 : 3, day.estimatedUnitCount / maxUnits * 100)}%` }} /></div>
          <strong>{day.estimatedUnitCount} 个主题</strong>
          <span>{day.estimatedProblemCount ? `约 ${day.estimatedProblemCount} 道题` : '暂无安排'}</span>
          <small>{loadLabels[day.loadLevel]}</small>
        </article>
      })}
    </div>
  </section>
}

function supportTags(unit: TodayReviewUnit) {
  const titleNames = new Set(unit.title.split(' · '))
  return [...unit.tags, ...unit.errorCategories]
    .filter((tag) => !titleNames.has(tag.name))
    .filter((tag, index, all) => all.findIndex((item) => `${item.type}:${item.id || item.name}` === `${tag.type}:${tag.id || tag.name}`) === index)
    .slice(0, 3)
}

function LearningTopicRow({ unit, busy, onPractice, onReplace, onDefer }: {
  unit: TodayReviewUnit
  busy: boolean
  onPractice: () => void
  onReplace: () => void
  onDefer: () => void
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
        <Button disabled={busy} onClick={onPractice} variant="secondary">生成练习</Button>
        <Menu label={`${unit.title}的更多操作`}>
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
  const [activePracticeSet, setActivePracticeSet] = useState<PracticeSet | null>(null)
  const [todayPracticeSet, setTodayPracticeSet] = useState<PracticeSet | null>(null)
  const [todayAttempt, setTodayAttempt] = useState<PracticeAttempt | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [nextPlan, nextForecast] = await Promise.all([getOrCreateTodayPlan(), getSevenDayReviewForecast()])
      setPlan(nextPlan); setForecast(nextForecast)
      const existingPracticeSet = await findPracticeSetForSource('today', nextPlan.id)
      setTodayPracticeSet(existingPracticeSet)
      setTodayAttempt(existingPracticeSet ? await getLatestPracticeAttempt(existingPracticeSet.id) : null)
    } catch (reason) { setError(practiceErrorMessage(reason)) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  const mutate = async (operation: () => Promise<TodayReviewPlan | void>) => {
    setBusy(true); setError(null)
    try {
      const next = await operation()
      setPlan(next ?? await refreshTodayPlan())
      setForecast(await getSevenDayReviewForecast())
    } catch (reason) { setError(practiceErrorMessage(reason)) }
    finally { setBusy(false) }
  }
  const openTodayPractice = async () => {
    if (!plan) return
    setBusy(true); setError(null)
    try {
      const moduleIds = plan.units.filter((unit) => unit.status === 'pending').map((unit) => unit.id)
      const next = todayPracticeSet ?? await getOrCreatePracticeSetFromTodayPlan(plan.id, moduleIds, Math.max(3, moduleIds.length * 2))
      setTodayPracticeSet(next); setTodayAttempt(await getLatestPracticeAttempt(next.id)); setActivePracticeSet(next)
    } catch (reason) { setError(practiceErrorMessage(reason)) }
    finally { setBusy(false) }
  }

  if (activePracticeSet) return <PracticeSetView
    onBack={() => { setActivePracticeSet(null); void load() }}
    onOpenPracticeSet={setActivePracticeSet}
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
    <header className="workspace-header today-header">
      <div className="today-header__copy"><p className="today-header__date">{todayDate}</p><h1>今日</h1>{plan && <p className="subtitle">{completed} / {actionableUnits.length} · 共预计 {minutes(plan.estimatedDurationSeconds)} 分钟</p>}</div>
      {plan && plan.units.length > 0 && <Button className="today-header__cta" disabled={busy || (!todayPracticeSet && pendingUnits.length === 0)} loading={busy} onClick={() => void openTodayPractice()} variant="primary">{practiceCta}</Button>}
    </header>
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
            onPractice={() => void (async () => {
              setBusy(true); setError(null)
              try { setActivePracticeSet(await getOrCreatePracticeSetFromReviewUnit(unit.id)) }
              catch (reason) { setError(practiceErrorMessage(reason)) }
              finally { setBusy(false) }
            })()}
            unit={unit}
          />)}
        </section>
      </>}
      {plan && forecast.length > 0 && <ForecastStrip days={forecast} />}
    </AsyncState>
  </main>
}

import { useCallback, useEffect, useState } from 'react'
import { Icon } from '../../components/Icon'
import { AsyncState, Badge, Button, EmptyState, Menu, MenuItem, Progress, StatusTag } from '../../components/ui'
import type { AppSection } from '../../components/Sidebar'
import type { ReviewForecastDay } from '../../domain/reviewForecast'
import type { PracticeSet } from '../../domain/practice'
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
import './Today.css'

const difficultyLabels = { basic: '基础', intermediate: '中档', advanced: '进阶' }
const loadLabels = { empty: '无负载', light: '轻', normal: '中', heavy: '重' }
const unitStatusLabels = { pending: '待完成', completed: '已完成', deferred: '已稍后处理' }

function minutes(seconds: number) {
  return Math.max(1, Math.round(seconds / 60))
}

function ForecastStrip({ days }: { days: ReviewForecastDay[] }) {
  const maxUnits = Math.max(1, ...days.map((day) => day.estimatedUnitCount))
  return <section className="today-forecast" aria-label="未来 7 天学习安排">
    <div className="today-forecast__heading">
      <div><p className="eyebrow">接下来</p><h2>未来 7 天</h2></div>
      <p>根据当前学习情况估算，完成今天的练习后会自动调整。</p>
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
  return <article className={`today-unit today-unit--${unit.status}`}>
    <div className="today-unit__order" aria-hidden="true">{unit.status === 'completed' ? <Icon name="check" size={16} /> : unit.orderIndex + 1}</div>
    <div className="today-unit__body">
      <div className="today-unit__heading"><div><span>{unit.subject}</span><h2>{unit.title}</h2></div></div>
      <div className="today-unit__tags">
        <Badge>{unit.associationCount} 道相关题</Badge>
        <Badge>{difficultyLabels[unit.difficulty]}</Badge>
        {supportTags(unit).map((tag) => <Badge key={`${tag.type}:${tag.id || tag.name}`}>{tag.name}</Badge>)}
      </div>
      <p>{unit.status === 'completed' ? '已根据本次练习结果安排后续学习。' : unit.selectionReason}</p>
    </div>
    <div className="today-unit__aside">
      <StatusTag kind={unit.status}>{unitStatusLabels[unit.status]}</StatusTag>
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
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [nextPlan, nextForecast] = await Promise.all([getOrCreateTodayPlan(), getSevenDayReviewForecast()])
      setPlan(nextPlan); setForecast(nextForecast)
      setTodayPracticeSet(await findPracticeSetForSource('today', nextPlan.id))
    } catch (reason) { setError(String(reason)) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  const mutate = async (operation: () => Promise<TodayReviewPlan | void>) => {
    setBusy(true); setError(null)
    try {
      const next = await operation()
      setPlan(next ?? await refreshTodayPlan())
      setForecast(await getSevenDayReviewForecast())
    } catch (reason) { setError(String(reason)) }
    finally { setBusy(false) }
  }
  const openTodayPractice = async () => {
    if (!plan) return
    setBusy(true); setError(null)
    try {
      const moduleIds = plan.units.filter((unit) => unit.status === 'pending').map((unit) => unit.id)
      const next = todayPracticeSet ?? await getOrCreatePracticeSetFromTodayPlan(plan.id, moduleIds, Math.max(3, moduleIds.length * 2))
      setTodayPracticeSet(next); setActivePracticeSet(next)
    } catch (reason) { setError(String(reason)) }
    finally { setBusy(false) }
  }

  if (activePracticeSet) return <PracticeSetView
    onBack={() => { setActivePracticeSet(null); void load() }}
    onOpenPracticeSet={setActivePracticeSet}
    practiceSet={activePracticeSet}
  />

  const actionableUnits = plan?.units.filter((unit) => unit.status !== 'deferred') ?? []
  const completed = actionableUnits.filter((unit) => unit.status === 'completed').length
  const progress = actionableUnits.length ? completed / actionableUnits.length * 100 : 0
  const pendingUnits = plan?.units.filter((unit) => unit.status === 'pending') ?? []
  return <main className="workspace today-workspace">
    <header className="workspace-header today-header">
      <div><p className="eyebrow">今天</p><h1>今日学习</h1><p className="subtitle">完成一组练习，学习安排会根据结果自动更新。</p></div>
      {actionableUnits.length > 0 && <div className="today-header__summary"><strong>{completed} / {actionableUnits.length}</strong><span>已完成</span></div>}
    </header>
    <AsyncState error={error} loading={loading} loadingLabel="正在准备今天的学习内容…" onRetry={load}>
      {plan && plan.units.length === 0 ? <EmptyState
        action={<Button onClick={() => void mutate(() => addTodayReviewUnit())} variant="primary">重新检查</Button>}
        description="保存并完成解析的错题会在这里形成适合今天练习的学习主题。"
        icon={<Icon name="today" size={22} />}
        secondaryAction={<><Button onClick={() => onNavigate('library')} variant="secondary">前往错题库</Button><Button onClick={() => onNavigate('curriculum')} variant="ghost">查看课程</Button></>}
        title="今天暂时没有学习安排"
      /> : plan && <>
        <section className="today-overview">
          <div><strong>{actionableUnits.length} 个学习主题</strong><span>预计 {minutes(plan.estimatedDurationSeconds)} 分钟</span></div>
          <div className="today-overview__action">
            <Button disabled={busy || (!todayPracticeSet && pendingUnits.length === 0)} loading={busy} onClick={() => void openTodayPractice()} variant="primary">
              {todayPracticeSet ? '查看今日练习' : '生成今日练习'}
            </Button>
            <span>{todayPracticeSet ? '练习已保存，可以继续完成。' : `将围绕 ${pendingUnits.length} 个待完成主题生成一组练习。`}</span>
          </div>
          <Progress detail={`${completed} 个已完成`} label="完成进度" value={progress} />
        </section>
        <section className="today-units" aria-label="今日学习主题">
          {plan.units.map((unit) => <LearningTopicRow
            busy={busy}
            key={unit.id}
            onDefer={() => void mutate(async () => { await deferTodayReviewUnit(unit.id) })}
            onReplace={() => void mutate(() => replaceTodayReviewUnit(unit.id))}
            onPractice={() => void (async () => {
              setBusy(true); setError(null)
              try { setActivePracticeSet(await getOrCreatePracticeSetFromReviewUnit(unit.id)) }
              catch (reason) { setError(String(reason)) }
              finally { setBusy(false) }
            })()}
            unit={unit}
          />)}
        </section>
      </>}
      {plan && forecast.length > 0 && <ForecastStrip days={forecast} />}
    </AsyncState>
    <footer className="today-horizon-mark">Powered by Horizon</footer>
  </main>
}

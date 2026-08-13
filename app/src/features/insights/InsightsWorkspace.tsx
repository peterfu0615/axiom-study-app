import { useCallback, useEffect, useMemo, useState } from 'react'
import { AsyncState, Badge, Button, EmptyState, StatusBadge } from '../../components/ui'
import { Icon } from '../../components/Icon'
import type { InsightRangeDays, ReviewInsights } from '../../domain/reviewInsights'
import { getReviewInsights } from '../../platform/insightsDatabase'
import './Insights.css'

const ratingLabels = { again: '忘记', hard: '困难', good: '掌握', easy: '轻松' }
const typeLabels = { knowledge: '知识', method: '方法', model: '模型', error: '错因' }

function percent(value: number | null) {
  return value === null ? '—' : `${Math.round(value * 100)}%`
}

function Trend({ insights }: { insights: ReviewInsights }) {
  const max = Math.max(1, ...insights.trend.map((day) => day.completedUnits))
  const visibleLabels = insights.rangeDays === 7 ? 1 : 5
  return <section className="insights-section">
    <header><div><p className="eyebrow">复习趋势</p><h2>每日完成</h2></div><span>已完成练习</span></header>
    <div className={`insights-trend insights-trend--${insights.rangeDays}`}>
      {insights.trend.map((day, index) => <div className="insights-trend__day" key={day.date} title={`${day.date} · ${day.completedUnits} 个单元`}>
        <div className="insights-trend__bar"><i style={{ height: `${Math.max(day.completedUnits ? 14 : 2, day.completedUnits / max * 100)}%` }} /></div>
        <strong>{day.completedUnits || ''}</strong>
        <span>{index % visibleLabels === 0 || index === insights.trend.length - 1 ? day.date.slice(5).replace('-', '/') : ''}</span>
      </div>)}
    </div>
  </section>
}

function Mastery({ insights }: { insights: ReviewInsights }) {
  const groups = [
    { key: 'stable' as const, label: '掌握较稳定', tone: 'success' as const },
    { key: 'consolidating' as const, label: '正在巩固', tone: 'brand' as const },
    { key: 'attention' as const, label: '需要关注', tone: 'warning' as const },
  ]
  return <section className="insights-section">
    <header><div><p className="eyebrow">当前状态</p><h2>掌握情况</h2></div><span>知识、方法与题型模型</span></header>
    <div className="insights-mastery">
      {groups.map((group) => <article key={group.key}>
        <div><StatusBadge tone={group.tone}>{group.label}</StatusBadge><strong>{insights.mastery[group.key].length}</strong></div>
        <div className="insights-tag-list">
          {insights.mastery[group.key].slice(0, 6).map((skill) => <Badge key={`${skill.subject}:${skill.tagId}`}>{skill.name}</Badge>)}
          {!insights.mastery[group.key].length && <span>暂无</span>}
        </div>
      </article>)}
    </div>
  </section>
}

export function InsightsWorkspace() {
  const [range, setRange] = useState<InsightRangeDays>(7)
  const [insights, setInsights] = useState<ReviewInsights | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try { setInsights(await getReviewInsights(range)) }
    catch (reason) { setError(String(reason)) }
    finally { setLoading(false) }
  }, [range])
  useEffect(() => { void load() }, [load])
  const totalRatings = useMemo(() => insights ? Object.values(insights.ratings).reduce((sum, count) => sum + count, 0) : 0, [insights])
  const masteryCount = useMemo(() => insights ? Object.values(insights.mastery).reduce((sum, items) => sum + items.length, 0) : 0, [insights])
  const changeDays = useMemo(() => insights?.trend.filter((day) => day.masteryDelta !== null) ?? [], [insights])

  return <main className="workspace insights-workspace">
    <header className="workspace-header insights-header">
      <div><h1>洞察</h1><p className="subtitle">复习趋势与掌握变化</p></div>
      <div className="insights-range" role="group" aria-label="洞察时间范围">
        <Button onClick={() => setRange(7)} variant={range === 7 ? 'primary' : 'secondary'}>最近 7 天</Button>
        <Button onClick={() => setRange(30)} variant={range === 30 ? 'primary' : 'secondary'}>最近 30 天</Button>
      </div>
    </header>
    <AsyncState error={error} loading={loading} loadingLabel="正在整理学习记录…" onRetry={load}>
      {insights && insights.overview.completedUnits === 0 && !insights.themes.length && masteryCount === 0 ? <EmptyState
        description="完成 Today 复习后，这里会逐步形成趋势、掌握状态和重复错误。已有 SkillState 仍会在掌握情况中显示。"
        icon={<Icon name="insights" size={22} />} title={`最近 ${range} 天还没有复习记录`}
      /> : insights && <>
        <section className="insights-overview" aria-label="学习概览">
          <div><span>已完成练习</span><strong>{insights.overview.completedUnits}</strong></div>
          <div><span>复习题目</span><strong>{insights.overview.completedProblems}</strong></div>
          <div><span>完成率</span><strong>{percent(insights.overview.completionRate)}</strong></div>
          <div><span>已暂缓</span><strong>{insights.overview.deferredUnits}</strong></div>
        </section>
        <Trend insights={insights} />
        <section className="insights-split">
          <article className="insights-section insights-section--compact">
            <header><div><p className="eyebrow">复习反馈</p><h2>完成感受</h2></div><span>{totalRatings} 次</span></header>
            <div className="insights-ratings">{Object.entries(insights.ratings).map(([rating, count]) => <div key={rating}><span>{ratingLabels[rating as keyof typeof ratingLabels]}</span><i><b style={{ width: `${totalRatings ? count / totalRatings * 100 : 0}%` }} /></i><strong>{count}</strong></div>)}</div>
          </article>
          <article className="insights-section insights-section--compact">
            <header><div><h2>掌握变化</h2></div></header>
            {changeDays.length ? <div className="insights-changes">{changeDays.slice(-5).map((day) => <div key={day.date}><span>{day.date.slice(5).replace('-', '/')}</span><strong className={(day.masteryDelta ?? 0) >= 0 ? 'is-positive' : 'is-negative'}>{(day.masteryDelta ?? 0) >= 0 ? '+' : ''}{Math.round((day.masteryDelta ?? 0) * 100)}%</strong></div>)}</div>
              : <p className="insights-change-copy">当前范围内还没有足够的状态变化记录。</p>}
          </article>
        </section>
        <Mastery insights={insights} />
        <section className="insights-split">
          <article className="insights-section insights-section--compact">
            <header><div><p className="eyebrow">高频主题</p><h2>最近反复复习</h2></div></header>
            <div className="insights-ranked">{insights.themes.length ? insights.themes.map((item) => <div key={`${item.type}:${item.name}`}><span>{typeLabels[item.type]}</span><strong>{item.name}</strong><b>{item.count} 次</b></div>) : <p>暂无主题记录</p>}</div>
          </article>
          <article className="insights-section insights-section--compact">
            <header><div><p className="eyebrow">重复错误</p><h2>最近错误模式</h2></div></header>
            <div className="insights-ranked">{insights.recurringErrors.length ? insights.recurringErrors.map((item) => <div key={item.name}><span>错因</span><strong>{item.name}</strong><b>{item.count} 次{item.difficultCount ? ` · ${item.difficultCount} 次较难` : ''}</b></div>) : <p>暂无错误类型记录</p>}</div>
          </article>
        </section>
      </>}
    </AsyncState>
  </main>
}

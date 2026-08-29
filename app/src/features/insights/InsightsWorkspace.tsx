import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AsyncState, Badge, Button, EmptyState, ListboxSelect, PageHeader, StatusBadge } from '../../components/ui'
import { Icon } from '../../components/Icon'
import type { InsightRangeDays, ReviewInsights } from '../../domain/reviewInsights'
import type { InsightEvidenceSplit } from '../../domain/reviewInsights'
import { userFacingError } from '../../domain/userFacingError'
import { getReviewInsights } from '../../platform/insightsDatabase'
import { LEARNING_STATE_EVENT } from '../../platform/learningStateEvents'
import './Insights.css'

const ratingLabels = { again: '忘记', hard: '困难', good: '掌握', easy: '轻松' }
const typeLabels = { knowledge: '知识', method: '方法', model: '模型', error: '错因' }
const difficultyLabels = { basic: '基础', intermediate: '中档', advanced: '进阶' }

function percent(value: number | null) {
  return value === null ? '—' : `${Math.round(value * 100)}%`
}

function Trend({ insights }: { insights: ReviewInsights }) {
  const max = Math.max(1, ...insights.trend.map((day) => day.completedUnits))
  const visibleLabels = insights.rangeDays === 7 ? 1 : 5
  return <section className="insights-section">
    <header><div><p className="eyebrow">复习趋势</p><h2>每日完成</h2></div></header>
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
    { key: 'insufficient' as const, label: '证据不足', tone: 'neutral' as const },
  ]
  return <section className="insights-section">
    <header><div><p className="eyebrow">当前状态</p><h2>掌握情况</h2></div><span>知识、方法与题型模型</span></header>
    <div className="insights-mastery">
      {groups.map((group) => <article key={group.key}>
        <div><StatusBadge tone={group.tone}>{group.label}</StatusBadge><strong>{insights.mastery[group.key].length}</strong></div>
        <div className="insights-tag-list">
          {insights.mastery[group.key].slice(0, 6).map((skill) => <Badge key={`${skill.subject}:${skill.tagId}`}>{insights.subject ? skill.name : `${skill.subject} · ${skill.name}`}</Badge>)}
          {!insights.mastery[group.key].length && <span>暂无</span>}
        </div>
      </article>)}
    </div>
  </section>
}

function evidenceCopy(value: InsightEvidenceSplit, eligible: boolean) {
  if (!value.attempts) return '暂无作答'
  if (!eligible || value.successRate === null) return `${value.attempts} 次 · 待更多证据`
  return `${value.attempts} 次 · 成功 ${percent(value.successRate)}`
}

function SkillDetails({ insights }: { insights: ReviewInsights }) {
  return <section className="insights-section">
    <header>
      <div><p className="eyebrow">能力证据</p><h2>稳定性与迁移明细</h2></div>
      <span>至少 3 次有效证据才给出结论</span>
    </header>
    {insights.skillDetails.length ? <div className="insights-skill-table" role="table" aria-label="能力证据明细">
      <div className="insights-skill-table__header" role="row">
        <span role="columnheader">能力</span><span role="columnheader">再次答错率</span>
        <span role="columnheader">稳定性</span><span role="columnheader">迁移分数</span>
        <span role="columnheader">稳定难度上限</span><span role="columnheader">原题证据</span>
        <span role="columnheader">变式证据</span>
      </div>
      {insights.skillDetails.slice(0, 18).map((detail) => <div className="insights-skill-table__row" role="row" key={`${detail.subject}:${detail.tagId}`}>
        <span role="cell"><b>{detail.name}</b><small>{insights.subject ? typeLabels[detail.type] : `${detail.subject} · ${typeLabels[detail.type]}`} · {detail.state.evidenceCount} 条证据</small></span>
        <strong role="cell">{detail.conclusionEligible ? percent(detail.reerrorRate) : '证据不足'}</strong>
        <strong role="cell">{detail.conclusionEligible ? `${detail.state.stability.toFixed(1)} 天` : '—'}</strong>
        <strong role="cell">{detail.conclusionEligible ? percent(detail.state.transferScore) : '—'}</strong>
        <strong role="cell">{detail.conclusionEligible && detail.state.maxStableDifficulty ? difficultyLabels[detail.state.maxStableDifficulty] : '—'}</strong>
        <span role="cell">{evidenceCopy(detail.original, detail.conclusionEligible)}</span>
        <span role="cell" className={detail.variant.attempts ? 'has-variant-evidence' : ''}>{evidenceCopy(detail.variant, detail.conclusionEligible)}</span>
      </div>)}
    </div> : <p className="insights-change-copy">完成带标签的原题或变式练习后，这里会显示逐项能力证据。</p>}
  </section>
}

function MethodModelDiagnostics({ insights }: { insights: ReviewInsights }) {
  const eligible = insights.skillDetails.filter((detail) => detail.conclusionEligible)
  const methodTransfer = eligible.filter((detail) => detail.type === 'method'
    && detail.state.masteryEstimate >= .55 && detail.state.transferScore < .45)
  const methodErrors = eligible.filter((detail) => detail.type === 'method'
    && (detail.reerrorRate ?? 0) >= .35)
  const unstableModels = eligible.filter((detail) => detail.type === 'model'
    && ((detail.reerrorRate ?? 0) >= .35 || detail.state.retrievability < .55))
  const advancedModels = eligible.filter((detail) => detail.type === 'model'
    && detail.state.maxStableDifficulty === 'advanced')
  const groups = [
    { label: '知道但迁移不足的方法', items: methodTransfer, metric: (item: typeof methodTransfer[number]) => `迁移 ${percent(item.state.transferScore)}` },
    { label: '再次出错较多的方法', items: methodErrors, metric: (item: typeof methodErrors[number]) => `再错 ${percent(item.reerrorRate)}` },
    { label: '中高难度仍不稳定的模型', items: unstableModels, metric: (item: typeof unstableModels[number]) => `稳定性 ${item.state.stability.toFixed(1)} 天` },
    { label: '已稳定到进阶难度的模型', items: advancedModels, metric: (item: typeof advancedModels[number]) => `掌握 ${percent(item.state.masteryEstimate)}` },
  ]
  return <section className="insights-section">
    <header><div><p className="eyebrow">诊断视角</p><h2>方法与题型模型</h2></div></header>
    <div className="insights-diagnostics">
      {groups.map((group) => <article key={group.label}>
        <h3>{group.label}</h3>
        {group.items.length ? <ul>{group.items.slice(0, 5).map((item) => <li key={`${item.subject}:${item.tagId}`}>
          <span>{insights.subject ? item.name : `${item.subject} · ${item.name}`}</span><strong>{group.metric(item)}</strong>
        </li>)}</ul> : <p>暂无满足条件的能力证据</p>}
      </article>)}
    </div>
  </section>
}

export function InsightsWorkspace() {
  const [range, setRange] = useState<InsightRangeDays>(7)
  const [subject, setSubject] = useState<string | null>(null)
  const [insights, setInsights] = useState<ReviewInsights | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Only the first paint shows the blocking spinner; range/subject switches
  // refresh in place so the charts do not flash away and back.
  const hasLoadedRef = useRef(false)
  const loadSeqRef = useRef(0)
  const load = useCallback(async () => {
    const seq = ++loadSeqRef.current
    if (!hasLoadedRef.current) setLoading(true)
    setError(null)
    try {
      const result = await getReviewInsights(range, Date.now(), subject)
      if (loadSeqRef.current === seq) {
        setInsights(result)
        hasLoadedRef.current = true
      }
    }
    catch (reason) {
      console.warn('读取学习洞察失败', reason)
      if (loadSeqRef.current === seq) {
        setError(userFacingError(
          reason,
          '未能读取学习洞察。现有复习记录没有改变，请重试。',
        ))
      }
    }
    finally {
      if (loadSeqRef.current === seq) setLoading(false)
    }
  }, [range, subject])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    const refresh = () => void load()
    window.addEventListener(LEARNING_STATE_EVENT, refresh)
    window.addEventListener('focus', refresh)
    const timer = window.setInterval(refresh, 60_000)
    return () => {
      window.removeEventListener(LEARNING_STATE_EVENT, refresh)
      window.removeEventListener('focus', refresh)
      window.clearInterval(timer)
    }
  }, [load])
  const totalRatings = useMemo(() => insights ? Object.values(insights.ratings).reduce((sum, count) => sum + count, 0) : 0, [insights])
  const masteryCount = useMemo(() => insights ? Object.values(insights.mastery).reduce((sum, items) => sum + items.length, 0) : 0, [insights])
  const changeDays = useMemo(() => insights?.trend.filter((day) => day.masteryDelta !== null) ?? [], [insights])

  return <main className="workspace insights-workspace">
    <PageHeader
      actions={<div className="insights-range" role="group" aria-label="洞察时间范围">
        <ListboxSelect
          ariaLabel="洞察科目"
          onValueChange={(value) => setSubject(value === 'all' ? null : value)}
          options={[{ value: 'all', label: '全部科目' }, ...(insights?.subjects ?? []).map((value) => ({ value, label: value }))]}
          value={subject ?? 'all'}
        />
        <Button onClick={() => setRange(7)} variant={range === 7 ? 'primary' : 'secondary'}>最近 7 天</Button>
        <Button onClick={() => setRange(30)} variant={range === 30 ? 'primary' : 'secondary'}>最近 30 天</Button>
      </div>}
      eyebrow="学习趋势"
      summary="复习趋势与掌握变化"
      title="洞察"
    />
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
          <div><span>未来 7 天到期</span><strong>{insights.overview.futureDueSkills}</strong></div>
          <div><span>当前已逾期</span><strong>{insights.overview.overdueSkills}</strong></div>
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
        <SkillDetails insights={insights} />
        <MethodModelDiagnostics insights={insights} />
        <section className="insights-split">
          <article className="insights-section insights-section--compact">
            <header><div><p className="eyebrow">高频主题</p><h2>最近反复复习</h2></div></header>
            <div className="insights-ranked">{insights.themes.length ? insights.themes.map((item) => <div key={`${item.type}:${item.name}`}><span>{typeLabels[item.type]}</span><strong>{item.name}</strong><b>{item.count} 次</b></div>) : <p>暂无主题记录</p>}</div>
          </article>
          <article className="insights-section insights-section--compact">
            <header><div><p className="eyebrow">重复错误</p><h2>最近错误模式</h2></div></header>
            <div className="insights-ranked">{insights.recurringErrors.length ? insights.recurringErrors.map((item) => <div key={item.name}><span>错因</span><strong>{item.name}</strong><b>{item.count} 次{item.difficultCount ? ` · ${item.difficultCount} 次较难` : ''}</b></div>) : <p>至少需要 3 次有效证据后才显示重复错误结论</p>}</div>
          </article>
        </section>
      </>}
    </AsyncState>
  </main>
}

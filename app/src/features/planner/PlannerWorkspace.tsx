import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../../components/Icon'
import type { AppSection } from '../../components/Sidebar'
import { Button, Dialog, EmptyState, InlineNotice, ListboxSelect, PageHeader, StatusBadge } from '../../components/ui'
import { plannerDate, type PlannerAvailabilityDay, type PlannerTaskType } from '../../domain/planner'
import {
  cancelPlannerTask,
  completePlannerTask,
  createPlannerTask,
  getPlannerWorkspaceData,
  savePlannerAvailability,
  savePlannerPreferences,
  type PlannerTaskInput,
  type PlannerWorkspaceData,
} from '../../platform/plannerDatabase'
import { LEARNING_STATE_EVENT } from '../../platform/learningStateEvents'
import './Planner.css'

const taskLabels: Record<PlannerTaskType, string> = {
  review: '复习', correction: '订正', homework: '作业', exam_prep: '备考',
}
const reasonLabels = {
  deadline_passed: '截止日期已过', capacity_exhausted: '容量不足', unavailable_range: '日期不可用',
}
const today = () => plannerDate(new Date())
const defaultDraft = (): PlannerTaskInput => ({
  title: '', taskType: 'homework', subject: '', dueDate: today(), estimatedMinutes: 30,
  priority: 3, splittable: true, earliestDate: today(), chapterIds: [], knowledgeTagIds: [], exam: null,
})

function dayLabel(date: string, index: number) {
  const value = new Date(`${date}T12:00:00`)
  return {
    weekday: index === 0 ? '今天' : new Intl.DateTimeFormat('zh-CN', { weekday: 'short' }).format(value),
    date: `${value.getMonth() + 1}/${value.getDate()}`,
  }
}

export function PlannerWorkspace({ onNavigate }: { onNavigate: (section: AppSection) => void }) {
  const [data, setData] = useState<PlannerWorkspaceData | null>(null)
  const dataRef = useRef<PlannerWorkspaceData | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [taskDialog, setTaskDialog] = useState(false)
  const [settingsDialog, setSettingsDialog] = useState(false)
  const [capacity, setCapacity] = useState<PlannerAvailabilityDay | null>(null)
  const [completion, setCompletion] = useState<{ id: string; title: string; minutes: number } | null>(null)
  const [draft, setDraft] = useState(defaultDraft)
  const [cancelArmed, setCancelArmed] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!dataRef.current) setLoading(true)
    setError(null)
    try {
      const next = await getPlannerWorkspaceData()
      dataRef.current = next
      setData(next)
    } catch (reason) { setError(`无法生成统一计划：${String(reason)}`) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    void load()
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

  const taskById = useMemo(() => new Map(data?.tasks.map((task) => [task.id, task]) ?? []), [data])
  const subjects = useMemo(() => [...new Set(data?.scopes.map((scope) => scope.subject) ?? [])]
    .sort((a, b) => a.localeCompare(b, 'zh-CN')), [data])
  const scopes = useMemo(() => data?.scopes.filter((scope) => !draft.subject || scope.subject === draft.subject) ?? [], [data, draft.subject])
  const scheduled = data?.schedule.days.reduce((sum, day) => sum + day.scheduledMinutes, 0) ?? 0
  const reviewMinutes = data?.schedule.days.reduce((sum, day) => sum + day.reviewMinutes, 0) ?? 0

  const mutate = async (operation: () => Promise<void>) => {
    setBusy(true); setError(null)
    try { await operation(); await load() }
    catch (reason) { setError(`保存计划失败：${String(reason)}`) }
    finally { setBusy(false) }
  }

  const submit = () => void mutate(async () => {
    if (!draft.title.trim() || !draft.subject.trim()) throw new Error('请填写任务名称和科目')
    if (draft.earliestDate > draft.dueDate) throw new Error('最早开始不能晚于截止日期')
    await createPlannerTask({
      ...draft,
      exam: draft.taskType === 'exam_prep'
        ? { title: draft.exam?.title?.trim() || draft.title.trim(), examDate: draft.exam?.examDate || draft.dueDate }
        : null,
    })
    setDraft(defaultDraft()); setTaskDialog(false)
  })

  return <main className="workspace planner-workspace">
    <PageHeader
      actions={<div className="planner-header__actions">
        <Button disabled={busy} onClick={() => setSettingsDialog(true)} variant="secondary">容量设置</Button>
        <Button disabled={busy} onClick={() => setTaskDialog(true)} variant="primary"><Icon name="plus" size={16} />添加任务</Button>
      </div>}
      eyebrow="统一记忆、订正、作业与考试"
      summary={data ? `未来 ${data.preferences.horizonDays} 天 · ${scheduled} 分钟 · 复习 ${reviewMinutes} 分钟` : undefined}
      title="计划"
    />
    <InlineNotice feedback={error ? { tone: 'danger', message: error } : null} onClose={() => setError(null)} />
    {loading ? <div className="planner-loading">正在按记忆风险、截止压力与每日容量排程…</div> : data && <>
      {data.schedule.unscheduled.length > 0 && <InlineNotice feedback={{
        tone: 'warning', message: `${data.schedule.unscheduled.length} 项进入积压；计划不会突破每日硬容量或越过截止日期。`,
      }} />}
      <section className="planner-board" aria-label="未来学习计划">
        {data.schedule.days.map((day, index) => {
          const label = dayLabel(day.date, index)
          return <article className={`planner-day${day.unavailable ? ' is-unavailable' : ''}${day.overloaded ? ' is-overloaded' : ''}`} key={day.date}>
            <header><div><strong>{label.weekday}</strong><span>{label.date}</span></div>
              <button onClick={() => setCapacity(day)} type="button">{day.unavailable ? '不可用' : `${day.scheduledMinutes}/${day.capacityMinutes} 分钟`}</button>
            </header>
            <div className="planner-day__load"><i style={{ width: `${Math.min(100, day.scheduledMinutes / Math.max(1, day.capacityMinutes) * 100)}%` }} /></div>
            <div className="planner-day__segments">
              {day.segments.map((segment) => {
                const task = taskById.get(segment.taskId)
                if (!task) return null
                return <div className={`planner-segment planner-segment--${task.taskType}`} key={segment.id}>
                  <span>{taskLabels[task.taskType]} · {segment.minutes} 分钟</span>
                  <strong>{task.title}</strong>
                  <small>{task.subject || '跨主题'} · {task.dueDate === day.date ? '今日到期' : `${task.dueDate.slice(5).replace('-', '/')} 到期`}</small>
                  {task.sourceType === 'user' || task.sourceType === 'exam' ? <div>
                    <button onClick={() => setCompletion({ id: task.id, title: task.title, minutes: task.estimatedMinutes })} type="button">完成</button>
                    <button className={cancelArmed === task.id ? 'is-armed' : ''} onClick={() => {
                      if (cancelArmed !== task.id) { setCancelArmed(task.id); return }
                      setCancelArmed(null); void mutate(() => cancelPlannerTask(task.id))
                    }} type="button">{cancelArmed === task.id ? '确认取消？' : '取消'}</button>
                  </div> : <div><button onClick={() => onNavigate('today')} type="button">{task.taskType === 'review' ? '去复习' : '去订正'}</button></div>}
                </div>
              })}
              {!day.segments.length && <span className="planner-day__empty">{day.unavailable ? day.note || '当天不安排学习' : '保留时间'}</span>}
            </div>
          </article>
        })}
      </section>
      <section className="planner-backlog">
        <header><div><p className="eyebrow">任务池与显式积压</p><h2>待完成任务</h2></div><span>{data.tasks.length} 项</span></header>
        {data.tasks.length ? <div className="planner-task-list">{data.tasks.map((task) => {
          const backlog = data.schedule.unscheduled.find((item) => item.taskId === task.id)
          return <article key={task.id}>
            <StatusBadge tone={task.taskType === 'review' ? 'brand' : task.taskType === 'correction' ? 'warning' : 'neutral'}>{taskLabels[task.taskType]}</StatusBadge>
            <div><strong>{task.title}</strong><span>{task.subject || '跨主题'} · {task.estimatedMinutes} 分钟 · {task.dueDate} 截止</span></div>
            <small>{backlog ? `${reasonLabels[backlog.reason]} · 缺 ${backlog.remainingMinutes} 分钟` : '已完整安排'}</small>
          </article>
        })}</div> : <EmptyState description="到期复习和未完成订正会自动进入，作业与考试可手动添加。" icon={<Icon name="planner" size={22} />} title="没有待安排任务" />}
      </section>
    </>}

    <Dialog onClose={() => setTaskDialog(false)} open={taskDialog} title="添加学习任务"><div className="planner-form">
      <label>任务名称<input autoFocus maxLength={160} onChange={(event) => setDraft({ ...draft, title: event.target.value })} value={draft.title} /></label>
      <label>类型<ListboxSelect ariaLabel="任务类型" onValueChange={(value) => setDraft({ ...draft, taskType: value as PlannerTaskInput['taskType'] })} options={[{ value: 'homework', label: '作业' }, { value: 'exam_prep', label: '考试准备' }]} value={draft.taskType} /></label>
      <label>科目<input list="planner-subjects" onChange={(event) => setDraft({ ...draft, subject: event.target.value, chapterIds: [], knowledgeTagIds: [] })} value={draft.subject} /><datalist id="planner-subjects">{subjects.map((subject) => <option key={subject} value={subject} />)}</datalist></label>
      <label>预计时长（分钟）<input max="1440" min="1" onChange={(event) => setDraft({ ...draft, estimatedMinutes: Number(event.target.value) })} type="number" value={draft.estimatedMinutes} /></label>
      <label>最早开始<input onChange={(event) => setDraft({ ...draft, earliestDate: event.target.value })} type="date" value={draft.earliestDate} /></label>
      <label>截止日期<input onChange={(event) => setDraft({ ...draft, dueDate: event.target.value })} type="date" value={draft.dueDate} /></label>
      <label>优先级<ListboxSelect ariaLabel="优先级" onValueChange={(value) => setDraft({ ...draft, priority: Number(value) })} options={[1, 2, 3, 4, 5].map((value) => ({ value: String(value), label: String(value) }))} value={String(draft.priority)} /></label>
      <label className="planner-form__check"><input checked={draft.splittable} onChange={(event) => setDraft({ ...draft, splittable: event.target.checked })} type="checkbox" />允许按不超过 30 分钟拆分</label>
      {scopes.length > 0 && <details className="planner-scope-picker"><summary>关联章节与知识点（可选）</summary><div>{scopes.map((scope) => {
        const field = scope.kind === 'chapter' ? 'chapterIds' : 'knowledgeTagIds'
        const checked = draft[field].includes(scope.id)
        return <label key={`${scope.kind}:${scope.id}`}><input checked={checked} onChange={() => setDraft({ ...draft, [field]: checked ? draft[field].filter((id) => id !== scope.id) : [...draft[field], scope.id] })} type="checkbox" />{scope.name}</label>
      })}</div></details>}
      <div className="planner-form__actions"><Button onClick={() => setTaskDialog(false)} variant="ghost">取消</Button><Button loading={busy} onClick={submit} variant="primary">保存并重排</Button></div>
    </div></Dialog>

    <Dialog onClose={() => setCapacity(null)} open={Boolean(capacity)} title="当天可用时间">{capacity && <div className="planner-form">
      <label>日期<input disabled type="date" value={capacity.date} /></label>
      <label>可用分钟<input disabled={capacity.unavailable} max="720" min="0" onChange={(event) => setCapacity({ ...capacity, capacityMinutes: Number(event.target.value) })} type="number" value={capacity.capacityMinutes} /></label>
      <label className="planner-form__check"><input checked={capacity.unavailable} onChange={(event) => setCapacity({ ...capacity, unavailable: event.target.checked, capacityMinutes: event.target.checked ? 0 : data?.preferences.defaultDailyCapacityMinutes ?? 90 })} type="checkbox" />当天不可用</label>
      <label>备注<input onChange={(event) => setCapacity({ ...capacity, note: event.target.value })} value={capacity.note ?? ''} /></label>
      <div className="planner-form__actions"><Button onClick={() => setCapacity(null)} variant="ghost">取消</Button><Button onClick={() => void mutate(async () => { await savePlannerAvailability(capacity); setCapacity(null) })} variant="primary">保存并重排</Button></div>
    </div>}</Dialog>

    <Dialog onClose={() => setSettingsDialog(false)} open={settingsDialog} title="Planner 容量设置">{data && <div className="planner-form">
      <label>每日硬容量（分钟）<input max="720" min="15" onChange={(event) => setData({ ...data, preferences: { ...data.preferences, defaultDailyCapacityMinutes: Number(event.target.value) } })} type="number" value={data.preferences.defaultDailyCapacityMinutes} /></label>
      <label>复习预留（分钟）<input max="180" min="5" onChange={(event) => setData({ ...data, preferences: { ...data.preferences, reviewReserveMinutes: Number(event.target.value) } })} type="number" value={data.preferences.reviewReserveMinutes} /></label>
      <label>同科连续上限（分钟）<input max="180" min="10" onChange={(event) => setData({ ...data, preferences: { ...data.preferences, maxSubjectBlockMinutes: Number(event.target.value) } })} type="number" value={data.preferences.maxSubjectBlockMinutes} /></label>
      <label>排程范围（天）<input max="42" min="7" onChange={(event) => setData({ ...data, preferences: { ...data.preferences, horizonDays: Number(event.target.value) } })} type="number" value={data.preferences.horizonDays} /></label>
      <div className="planner-form__actions"><Button onClick={() => setSettingsDialog(false)} variant="ghost">取消</Button><Button onClick={() => void mutate(async () => { await savePlannerPreferences(data.preferences); setSettingsDialog(false) })} variant="primary">保存并重排</Button></div>
    </div>}</Dialog>

    <Dialog onClose={() => setCompletion(null)} open={Boolean(completion)} title="记录实际用时">{completion && <div className="planner-form">
      <p className="planner-form__summary">{completion.title}</p><label>实际用时（分钟）<input max="1440" min="0" onChange={(event) => setCompletion({ ...completion, minutes: Number(event.target.value) })} type="number" value={completion.minutes} /></label>
      <div className="planner-form__actions"><Button onClick={() => setCompletion(null)} variant="ghost">取消</Button><Button onClick={() => void mutate(async () => { await completePlannerTask(completion.id, completion.minutes); setCompletion(null) })} variant="primary">确认完成</Button></div>
    </div>}</Dialog>
  </main>
}

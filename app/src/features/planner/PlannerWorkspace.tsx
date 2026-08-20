import { useCallback, useMemo, useState, useEffect } from 'react'
import { Button, Dialog, EmptyState, InlineNotice, PageHeader, StatusBadge } from '../../components/ui'
import { Icon } from '../../components/Icon'
import type { AppSection } from '../../components/Sidebar'
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
import './Planner.css'

const taskLabels: Record<PlannerTaskType, string> = {
  review: '复习', correction: '订正', homework: '作业', exam_prep: '备考',
}
const reasonLabels = {
  deadline_passed: '截止日期已过', capacity_exhausted: '截止日前容量不足', unavailable_range: '可用日期不足',
}

function localToday() { return plannerDate(new Date()) }

const defaultDraft = (): PlannerTaskInput => ({
  title: '', taskType: 'homework', subject: '', dueDate: localToday(), estimatedMinutes: 30,
  priority: 3, splittable: true, earliestDate: localToday(), chapterIds: [], knowledgeTagIds: [], exam: null,
})

function formatDay(date: string, index: number) {
  const value = new Date(`${date}T12:00:00`)
  return {
    weekday: index === 0 ? '今天' : new Intl.DateTimeFormat('zh-CN', { weekday: 'short' }).format(value),
    date: `${value.getMonth() + 1}/${value.getDate()}`,
  }
}

export function PlannerWorkspace({ onNavigate }: { onNavigate: (section: AppSection) => void }) {
  const [data, setData] = useState<PlannerWorkspaceData | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [taskDialog, setTaskDialog] = useState(false)
  const [capacityDialog, setCapacityDialog] = useState<PlannerAvailabilityDay | null>(null)
  const [settingsDialog, setSettingsDialog] = useState(false)
  const [completion, setCompletion] = useState<{ id: string; title: string; actualMinutes: number } | null>(null)
  const [draft, setDraft] = useState(defaultDraft)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try { setData(await getPlannerWorkspaceData()) }
    catch (reason) { setError(`无法生成学习计划：${String(reason)}`) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  const taskById = useMemo(() => new Map(data?.tasks.map((task) => [task.id, task]) ?? []), [data])
  const subjects = useMemo(() => [...new Set(data?.scopes.map((scope) => scope.subject) ?? [])].sort((a, b) => a.localeCompare(b, 'zh-CN')), [data])
  const scopedOptions = useMemo(() => data?.scopes.filter((scope) => !draft.subject || scope.subject === draft.subject) ?? [], [data, draft.subject])
  const scheduledMinutes = data?.schedule.days.reduce((sum, day) => sum + day.scheduledMinutes, 0) ?? 0
  const reviewMinutes = data?.schedule.days.flatMap((day) => day.segments)
    .filter((segment) => taskById.get(segment.taskId)?.taskType === 'review')
    .reduce((sum, segment) => sum + segment.minutes, 0) ?? 0

  const mutate = async (operation: () => Promise<void>) => {
    setBusy(true); setError(null)
    try { await operation(); await load() }
    catch (reason) { setError(`保存计划失败：${String(reason)}`) }
    finally { setBusy(false) }
  }

  const submitTask = () => void mutate(async () => {
    if (!draft.title.trim() || !draft.subject.trim()) throw new Error('请填写任务名称和科目')
    if (draft.earliestDate > draft.dueDate) throw new Error('最早开始日期不能晚于截止日期')
    const exam = draft.taskType === 'exam_prep'
      ? { title: draft.exam?.title?.trim() || draft.title.trim(), examDate: draft.exam?.examDate || draft.dueDate }
      : null
    await createPlannerTask({ ...draft, exam })
    setDraft(defaultDraft()); setTaskDialog(false)
  })

  return <main className="workspace planner-workspace">
    <PageHeader
      actions={<div className="planner-header__actions">
        <Button disabled={busy} onClick={() => setSettingsDialog(true)} variant="secondary">容量设置</Button>
        <Button disabled={busy} onClick={() => setTaskDialog(true)} variant="primary"><Icon name="plus" size={16} />添加任务</Button>
      </div>}
      eyebrow="学习负担与截止日期"
      summary={data ? `未来 ${data.preferences.horizonDays} 天 · 已安排 ${scheduledMinutes} 分钟，其中复习 ${reviewMinutes} 分钟` : undefined}
      title="计划"
    />
    <InlineNotice feedback={error ? { tone: 'danger', message: error } : null} onClose={() => setError(null)} />
    {loading ? <div className="planner-loading">正在结合复习负担、截止日期与可用时间排程…</div> : data && <>
      {data.schedule.unscheduled.length > 0 && <InlineNotice feedback={{
        tone: 'warning',
        message: `${data.schedule.unscheduled.length} 项任务无法在截止日前完整安排。请增加容量、提前开始或缩短任务。`,
      }} />}
      <section className="planner-board" aria-label="学习计划日历">
        {data.schedule.days.map((day, index) => {
          const label = formatDay(day.date, index)
          return <article className={`planner-day${day.unavailable ? ' is-unavailable' : ''}${day.overloaded ? ' is-overloaded' : ''}`} key={day.date}>
            <header>
              <div><strong>{label.weekday}</strong><span>{label.date}</span></div>
              <button aria-label={`设置 ${day.date} 可用时间`} onClick={() => setCapacityDialog(day)} type="button">
                {day.unavailable ? '不可用' : `${day.scheduledMinutes}/${day.capacityMinutes} 分钟`}
              </button>
            </header>
            <div className="planner-day__load" aria-label={`已使用 ${day.scheduledMinutes} 分钟`}>
              <i style={{ width: `${Math.min(100, day.scheduledMinutes / Math.max(1, day.capacityMinutes) * 100)}%` }} />
            </div>
            <div className="planner-day__segments">
              {day.segments.map((segment) => {
                const task = taskById.get(segment.taskId)
                if (!task) return null
                return <div className={`planner-segment planner-segment--${task.taskType}`} key={segment.id}>
                  <span>{taskLabels[task.taskType]} · {segment.minutes} 分钟</span>
                  <strong>{task.title}</strong>
                  <small>{task.subject || 'Horizon'}{task.dueDate === day.date ? ' · 今日截止' : ` · ${task.dueDate.slice(5).replace('-', '/')} 截止`}</small>
                  {task.sourceType === 'user' || task.sourceType === 'exam' ? <div>
                    <button disabled={busy} onClick={() => setCompletion({ id: task.id, title: task.title, actualMinutes: task.estimatedMinutes })} type="button">完成</button>
                    <button disabled={busy} onClick={() => void mutate(() => cancelPlannerTask(task.id))} type="button">取消</button>
                  </div> : <div><button onClick={() => onNavigate('today')} type="button">{task.taskType === 'correction' ? '去订正' : '去复习'}</button></div>}
                </div>
              })}
              {!day.segments.length && <span className="planner-day__empty">{day.unavailable ? day.note || '当天不安排学习' : '保留时间'}</span>}
            </div>
          </article>
        })}
      </section>
      <section className="planner-backlog">
        <header><div><p className="eyebrow">任务池</p><h2>待完成任务</h2></div><span>{data.tasks.length} 项</span></header>
        {data.tasks.length ? <div className="planner-task-list">{data.tasks.map((task) => {
          const unscheduled = data.schedule.unscheduled.find((item) => item.taskId === task.id)
          return <article key={task.id}>
            <StatusBadge tone={task.taskType === 'review' ? 'brand' : task.taskType === 'correction' ? 'warning' : 'neutral'}>{taskLabels[task.taskType]}</StatusBadge>
            <div><strong>{task.title}</strong><span>{task.subject || '跨科复习'} · {task.estimatedMinutes} 分钟 · {task.dueDate} 截止</span></div>
            {unscheduled ? <small>{reasonLabels[unscheduled.reason]} · 尚缺 {unscheduled.remainingMinutes} 分钟</small> : <small>已完整安排</small>}
          </article>
        })}</div> : <EmptyState title="没有待安排任务" description="复习负担、未完成订正和新建作业会自动进入这里。" icon={<Icon name="planner" size={22} />} />}
      </section>
    </>}

    <Dialog onClose={() => setTaskDialog(false)} open={taskDialog} title="添加学习任务">
      <div className="planner-form">
        <label>任务名称<input autoFocus maxLength={160} onChange={(event) => setDraft({ ...draft, title: event.target.value })} value={draft.title} /></label>
        <label>类型<select onChange={(event) => setDraft({ ...draft, taskType: event.target.value as PlannerTaskInput['taskType'] })} value={draft.taskType}><option value="homework">作业</option><option value="exam_prep">考试准备</option></select></label>
        <label>科目<input list="planner-subjects" onChange={(event) => setDraft({ ...draft, subject: event.target.value, chapterIds: [], knowledgeTagIds: [] })} value={draft.subject} /><datalist id="planner-subjects">{subjects.map((subject) => <option key={subject} value={subject} />)}</datalist></label>
        <label>预计时长（分钟）<input max="1440" min="1" onChange={(event) => setDraft({ ...draft, estimatedMinutes: Number(event.target.value) })} type="number" value={draft.estimatedMinutes} /></label>
        <label>最早开始<input onChange={(event) => setDraft({ ...draft, earliestDate: event.target.value })} type="date" value={draft.earliestDate} /></label>
        <label>截止日期<input onChange={(event) => setDraft({ ...draft, dueDate: event.target.value })} type="date" value={draft.dueDate} /></label>
        {draft.taskType === 'exam_prep' && <label>考试日期<input onChange={(event) => setDraft({ ...draft, exam: { title: draft.exam?.title || draft.title, examDate: event.target.value } })} type="date" value={draft.exam?.examDate || draft.dueDate} /></label>}
        <label>优先级<select onChange={(event) => setDraft({ ...draft, priority: Number(event.target.value) })} value={draft.priority}><option value="1">低</option><option value="2">较低</option><option value="3">普通</option><option value="4">较高</option><option value="5">最高</option></select></label>
        <label className="planner-form__check"><input checked={draft.splittable} onChange={(event) => setDraft({ ...draft, splittable: event.target.checked })} type="checkbox" />允许拆分到多天</label>
        {scopedOptions.length > 0 && <details className="planner-scope-picker"><summary>关联章节与知识点（可选）</summary><div>{scopedOptions.map((scope) => {
          const field = scope.kind === 'chapter' ? 'chapterIds' : 'knowledgeTagIds'
          const selected = draft[field].includes(scope.id)
          return <label key={`${scope.kind}:${scope.id}`}><input checked={selected} onChange={() => setDraft({ ...draft, [field]: selected ? draft[field].filter((id) => id !== scope.id) : [...draft[field], scope.id] })} type="checkbox" />{scope.name}</label>
        })}</div></details>}
        <div className="planner-form__actions"><Button onClick={() => setTaskDialog(false)} variant="ghost">取消</Button><Button disabled={busy} loading={busy} onClick={submitTask} variant="primary">保存并排程</Button></div>
      </div>
    </Dialog>

    <Dialog onClose={() => setCapacityDialog(null)} open={Boolean(capacityDialog)} title="当天可用时间">
      {capacityDialog && <div className="planner-form">
        <label>日期<input disabled type="date" value={capacityDialog.date} /></label>
        <label>可用分钟<input disabled={capacityDialog.unavailable} max="720" min="0" onChange={(event) => setCapacityDialog({ ...capacityDialog, capacityMinutes: Number(event.target.value) })} type="number" value={capacityDialog.capacityMinutes} /></label>
        <label className="planner-form__check"><input checked={capacityDialog.unavailable} onChange={(event) => setCapacityDialog({ ...capacityDialog, unavailable: event.target.checked, capacityMinutes: event.target.checked ? 0 : data?.preferences.defaultDailyCapacityMinutes ?? 90 })} type="checkbox" />当天不可用</label>
        <label>备注<input maxLength={120} onChange={(event) => setCapacityDialog({ ...capacityDialog, note: event.target.value })} value={capacityDialog.note ?? ''} /></label>
        <div className="planner-form__actions"><Button onClick={() => setCapacityDialog(null)} variant="ghost">取消</Button><Button onClick={() => void mutate(async () => { await savePlannerAvailability(capacityDialog); setCapacityDialog(null) })} variant="primary">保存并重排</Button></div>
      </div>}
    </Dialog>

    <Dialog onClose={() => setSettingsDialog(false)} open={settingsDialog} title="Planner 容量设置">
      {data && <div className="planner-form">
        <label>每日默认容量（分钟）<input max="720" min="15" onChange={(event) => setData({ ...data, preferences: { ...data.preferences, defaultDailyCapacityMinutes: Number(event.target.value) } })} type="number" value={data.preferences.defaultDailyCapacityMinutes} /></label>
        <label>复习保留量（分钟）<input max="180" min="5" onChange={(event) => setData({ ...data, preferences: { ...data.preferences, reviewReserveMinutes: Number(event.target.value) } })} type="number" value={data.preferences.reviewReserveMinutes} /></label>
        <label>同科连续上限（分钟）<input max="180" min="10" onChange={(event) => setData({ ...data, preferences: { ...data.preferences, maxSubjectBlockMinutes: Number(event.target.value) } })} type="number" value={data.preferences.maxSubjectBlockMinutes} /></label>
        <label>排程范围（天）<input max="42" min="7" onChange={(event) => setData({ ...data, preferences: { ...data.preferences, horizonDays: Number(event.target.value) } })} type="number" value={data.preferences.horizonDays} /></label>
        <div className="planner-form__actions"><Button onClick={() => setSettingsDialog(false)} variant="ghost">取消</Button><Button onClick={() => void mutate(async () => { await savePlannerPreferences(data.preferences); setSettingsDialog(false) })} variant="primary">保存并重排</Button></div>
      </div>}
    </Dialog>
    <Dialog onClose={() => setCompletion(null)} open={Boolean(completion)} title="记录实际用时">
      {completion && <div className="planner-form">
        <p className="planner-form__summary">{completion.title}</p>
        <label>实际用时（分钟）<input autoFocus max="1440" min="0" onChange={(event) => setCompletion({ ...completion, actualMinutes: Number(event.target.value) })} type="number" value={completion.actualMinutes} /></label>
        <div className="planner-form__actions"><Button onClick={() => setCompletion(null)} variant="ghost">取消</Button><Button onClick={() => void mutate(async () => { await completePlannerTask(completion.id, completion.actualMinutes); setCompletion(null) })} variant="primary">确认完成</Button></div>
      </div>}
    </Dialog>
  </main>
}

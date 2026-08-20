import { invoke } from '@tauri-apps/api/core'
import {
  PLANNER_SCHEDULER_VERSION,
  buildPlannerSchedule,
  plannerDate,
  type PlannerAvailabilityDay,
  type PlannerExam,
  type PlannerPreferences,
  type PlannerSchedule,
  type PlannerTask,
  type PlannerTaskType,
} from '../domain/planner'
import { getSevenDayReviewForecast } from './reviewDatabase'
import { withTransactionLock } from './transactionLock'

interface ExecuteResult { rowsAffected: number; lastInsertId: number }
const execute = (sql: string, params: unknown[] = []) => invoke<ExecuteResult>('db_execute', { sql, params })
const select = <T>(sql: string, params: unknown[] = []) => invoke<T>('db_select', { sql, params })
const uuid = () => crypto.randomUUID()

const parseJSON = <T>(value: unknown, fallback: T): T => {
  if (typeof value !== 'string' || !value.trim()) return fallback
  try { return JSON.parse(value) as T } catch { return fallback }
}

interface PreferenceRow {
  default_daily_capacity_minutes: number
  review_reserve_minutes: number
  max_subject_block_minutes: number
  horizon_days: number
}

interface TaskRow {
  id: string; title: string; task_type: PlannerTaskType; subject: string; due_date: string
  estimated_minutes: number; actual_minutes: number | null; priority: number; splittable: number
  earliest_date: string; chapter_ids_json: string; knowledge_tag_ids_json: string
  status: PlannerTask['status']; source_type: PlannerTask['sourceType']; source_ref: string | null
  exam_id: string | null; completed_minutes: number | null
}

interface ExamRow {
  id: string; title: string; subject: string; exam_date: string
  chapter_ids_json: string; knowledge_tag_ids_json: string; status: PlannerExam['status']
}

interface AvailabilityRow {
  plan_date: string; capacity_minutes: number; unavailable: number; note: string | null
}

export interface PlannerScopeOption {
  id: string
  subject: string
  name: string
  kind: 'chapter' | 'knowledge'
}

export interface PlannerWorkspaceData {
  preferences: PlannerPreferences
  tasks: PlannerTask[]
  exams: PlannerExam[]
  schedule: PlannerSchedule
  scopes: PlannerScopeOption[]
}

export interface PlannerTaskInput {
  title: string
  taskType: Exclude<PlannerTaskType, 'review' | 'correction'>
  subject: string
  dueDate: string
  estimatedMinutes: number
  priority: number
  splittable: boolean
  earliestDate: string
  chapterIds: string[]
  knowledgeTagIds: string[]
  exam?: { title: string; examDate: string } | null
}

function preferenceFromRow(row: PreferenceRow): PlannerPreferences {
  return {
    defaultDailyCapacityMinutes: Number(row.default_daily_capacity_minutes),
    reviewReserveMinutes: Number(row.review_reserve_minutes),
    maxSubjectBlockMinutes: Number(row.max_subject_block_minutes),
    horizonDays: Number(row.horizon_days),
  }
}

function taskFromRow(row: TaskRow): PlannerTask {
  return {
    id: row.id,
    title: row.title,
    taskType: row.task_type,
    subject: row.subject,
    dueDate: row.due_date,
    estimatedMinutes: Number(row.estimated_minutes),
    actualMinutes: row.actual_minutes == null ? null : Number(row.actual_minutes),
    priority: Number(row.priority),
    splittable: Boolean(row.splittable),
    earliestDate: row.earliest_date,
    chapterIds: parseJSON(row.chapter_ids_json, []),
    knowledgeTagIds: parseJSON(row.knowledge_tag_ids_json, []),
    status: row.status,
    sourceType: row.source_type,
    sourceRef: row.source_ref,
    examId: row.exam_id,
    completedMinutes: Number(row.completed_minutes ?? 0),
  }
}

function examFromRow(row: ExamRow): PlannerExam {
  return {
    id: row.id,
    title: row.title,
    subject: row.subject,
    examDate: row.exam_date,
    chapterIds: parseJSON(row.chapter_ids_json, []),
    knowledgeTagIds: parseJSON(row.knowledge_tag_ids_json, []),
    status: row.status,
  }
}

async function syncSystemTasks(today: string) {
  const forecast = await getSevenDayReviewForecast()
  const now = Date.now()
  for (const day of forecast) {
    if (day.estimatedUnitCount <= 0) continue
    const minutes = Math.max(5, day.estimatedUnitCount * 7, day.estimatedProblemCount * 3)
    await execute(`INSERT INTO planner_tasks(
      id,title,task_type,subject,due_date,estimated_minutes,priority,splittable,
      earliest_date,chapter_ids_json,knowledge_tag_ids_json,status,source_type,source_ref,
      created_at,updated_at
    ) VALUES($1,'Horizon 到期复习','review','',$2,$3,5,1,$4,'[]','[]','pending','review',$2,$5,$5)
    ON CONFLICT(source_type,source_ref) WHERE source_ref IS NOT NULL DO UPDATE SET
      estimated_minutes=excluded.estimated_minutes,
      earliest_date=excluded.earliest_date,
      updated_at=excluded.updated_at,
      status=CASE WHEN planner_tasks.status='completed' THEN planner_tasks.status ELSE 'pending' END`, [
      uuid(), day.date, minutes, today, now,
    ])
  }

  const corrections = await select<Array<{ id: string; subject: string; order_index: number }>>(`
    SELECT response.id, item.subject, item.order_index
    FROM practice_responses response
    JOIN practice_items item ON item.id=response.practice_item_id
    WHERE response.status IN ('graded','needs_review','corrected')
      AND COALESCE(json_extract(response.grading_result_json,'$.correctness'),'needs_review') != 'correct'
      AND NOT EXISTS(SELECT 1 FROM practice_evidences evidence WHERE evidence.practice_response_id=response.id)
    ORDER BY response.updated_at
  `)
  for (const correction of corrections) {
    await execute(`INSERT INTO planner_tasks(
      id,title,task_type,subject,due_date,estimated_minutes,priority,splittable,
      earliest_date,chapter_ids_json,knowledge_tag_ids_json,status,source_type,source_ref,
      created_at,updated_at
    ) VALUES($1,$2,'correction',$3,$4,15,5,0,$4,'[]','[]','pending','correction',$5,$6,$6)
    ON CONFLICT(source_type,source_ref) WHERE source_ref IS NOT NULL DO UPDATE SET
      title=excluded.title,subject=excluded.subject,updated_at=excluded.updated_at`, [
      uuid(), `订正第 ${Number(correction.order_index) + 1} 题`, correction.subject, today,
      correction.id, now,
    ])
  }
  await execute(`UPDATE planner_tasks SET status='completed',completed_at=$1,updated_at=$1
    WHERE source_type='correction' AND status IN ('pending','in_progress')
      AND EXISTS(SELECT 1 FROM practice_evidences evidence WHERE evidence.practice_response_id=planner_tasks.source_ref)`, [now])
}

async function loadInputs(startDate: string) {
  const [preferenceRows, taskRows, examRows, availabilityRows, speedRows, scopes] = await Promise.all([
    select<PreferenceRow[]>('SELECT * FROM planner_preferences WHERE id=\'default\''),
    select<TaskRow[]>(`SELECT task.*,
      COALESCE((SELECT SUM(segment.planned_minutes) FROM planner_task_segments segment
        WHERE segment.task_id=task.id AND segment.status='completed'),0) AS completed_minutes
      FROM planner_tasks task WHERE task.status IN ('pending','in_progress') ORDER BY task.due_date,task.priority DESC,task.created_at`),
    select<ExamRow[]>("SELECT * FROM planner_exams WHERE status='upcoming' ORDER BY exam_date,id"),
    select<AvailabilityRow[]>('SELECT * FROM planner_availability WHERE plan_date >= $1 ORDER BY plan_date', [startDate]),
    select<Array<{ subject: string; ratio: number }>>(`SELECT subject,
      CAST(SUM(actual_minutes) AS REAL) / NULLIF(SUM(estimated_minutes),0) AS ratio
      FROM planner_tasks WHERE status='completed' AND actual_minutes IS NOT NULL AND subject!=''
      GROUP BY subject HAVING COUNT(*) >= 2`),
    select<PlannerScopeOption[]>(`SELECT id,subject,canonical_name AS name,
      CASE WHEN node_type IN ('book','chapter','section') THEN 'chapter' ELSE 'knowledge' END AS kind
      FROM knowledge_nodes WHERE archived_at IS NULL AND merged_into_id IS NULL
        AND node_type IN ('chapter','section','knowledge')
      UNION ALL
      SELECT id,subject,canonical_name AS name,'knowledge' AS kind
      FROM tag_definitions WHERE tag_type='knowledge' AND lifecycle_status='active'
      ORDER BY subject,kind,name`),
  ])
  const preferences = preferenceFromRow(preferenceRows[0])
  const tasks = taskRows.map(taskFromRow)
  const exams = examRows.map(examFromRow)
  const availability: PlannerAvailabilityDay[] = availabilityRows.map((row) => ({
    date: row.plan_date,
    capacityMinutes: Number(row.capacity_minutes),
    unavailable: Boolean(row.unavailable),
    note: row.note,
  }))
  const subjectSpeedRatios = Object.fromEntries(speedRows.map((row) => [row.subject, Number(row.ratio)]))
  return { preferences, tasks, exams, availability, subjectSpeedRatios, scopes }
}

async function persistSchedule(startDate: string, schedule: PlannerSchedule, inputHash: string, horizonDays: number) {
  const now = Date.now()
  const runId = uuid()
  await withTransactionLock(async () => {
    await execute('BEGIN IMMEDIATE')
    try {
      await execute("UPDATE planner_task_segments SET status='skipped',updated_at=$1 WHERE status='scheduled' AND planned_date < $2", [now, startDate])
      await execute("DELETE FROM planner_task_segments WHERE status='scheduled' AND planned_date >= $1", [startDate])
      await execute(`INSERT INTO planner_schedule_runs(id,start_date,horizon_days,scheduler_version,input_hash,summary_json,created_at)
        VALUES($1,$2,$3,$4,$5,$6,$7)`, [runId, startDate, horizonDays, PLANNER_SCHEDULER_VERSION, inputHash, JSON.stringify({ unscheduled: schedule.unscheduled }), now])
      for (const day of schedule.days) {
        for (const segment of day.segments) {
          await execute(`INSERT INTO planner_task_segments(
            id,task_id,schedule_run_id,planned_date,planned_minutes,order_index,status,created_at,updated_at
          ) VALUES($1,$2,$3,$4,$5,$6,'scheduled',$7,$7)`, [uuid(), segment.taskId, runId, day.date, segment.minutes, segment.orderIndex, now])
        }
      }
      await execute('COMMIT')
    } catch (error) {
      await execute('ROLLBACK').catch(() => undefined)
      throw error
    }
  })
}

async function scheduleHash(value: unknown) {
  const encoded = new TextEncoder().encode(JSON.stringify(value))
  const digest = await crypto.subtle.digest('SHA-256', encoded)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function getPlannerWorkspaceData(timestamp = Date.now()): Promise<PlannerWorkspaceData> {
  const startDate = plannerDate(timestamp)
  await syncSystemTasks(startDate)
  const inputs = await loadInputs(startDate)
  const schedule = buildPlannerSchedule({ startDate, ...inputs })
  const inputHash = await scheduleHash({
    startDate, preferences: inputs.preferences, availability: inputs.availability,
    tasks: inputs.tasks, exams: inputs.exams, subjectSpeedRatios: inputs.subjectSpeedRatios,
  })
  await persistSchedule(startDate, schedule, inputHash, inputs.preferences.horizonDays)
  return { preferences: inputs.preferences, tasks: inputs.tasks, exams: inputs.exams, schedule, scopes: inputs.scopes }
}

export async function createPlannerTask(input: PlannerTaskInput) {
  const now = Date.now()
  return withTransactionLock(async () => {
    await execute('BEGIN IMMEDIATE')
    try {
      let examId: string | null = null
      if (input.taskType === 'exam_prep' && input.exam) {
        examId = uuid()
        await execute(`INSERT INTO planner_exams(id,title,subject,exam_date,chapter_ids_json,knowledge_tag_ids_json,status,created_at,updated_at)
          VALUES($1,$2,$3,$4,$5,$6,'upcoming',$7,$7)`, [examId, input.exam.title.trim(), input.subject.trim(), input.exam.examDate, JSON.stringify(input.chapterIds), JSON.stringify(input.knowledgeTagIds), now])
      }
      await execute(`INSERT INTO planner_tasks(
        id,title,task_type,subject,due_date,estimated_minutes,priority,splittable,
        earliest_date,chapter_ids_json,knowledge_tag_ids_json,status,source_type,source_ref,exam_id,created_at,updated_at
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending',$12,NULL,$13,$14,$14)`, [
        uuid(), input.title.trim(), input.taskType, input.subject.trim(), input.dueDate,
        input.estimatedMinutes, input.priority, Number(input.splittable), input.earliestDate,
        JSON.stringify(input.chapterIds), JSON.stringify(input.knowledgeTagIds),
        examId ? 'exam' : 'user', examId, now,
      ])
      await execute('COMMIT')
    } catch (error) {
      await execute('ROLLBACK').catch(() => undefined)
      throw error
    }
  })
}

export async function completePlannerTask(taskId: string, actualMinutes: number) {
  const now = Date.now()
  await execute(`UPDATE planner_tasks SET status='completed',actual_minutes=$1,completed_at=$2,updated_at=$2
    WHERE id=$3 AND status IN ('pending','in_progress')`, [actualMinutes, now, taskId])
  await execute(`UPDATE planner_task_segments SET status='completed',actual_minutes=planned_minutes,updated_at=$1
    WHERE task_id=$2 AND status='scheduled'`, [now, taskId])
}

export async function cancelPlannerTask(taskId: string) {
  await execute("UPDATE planner_tasks SET status='cancelled',updated_at=$1 WHERE id=$2 AND source_type IN ('user','exam')", [Date.now(), taskId])
}

export async function savePlannerAvailability(day: PlannerAvailabilityDay) {
  const now = Date.now()
  await execute(`INSERT INTO planner_availability(plan_date,capacity_minutes,unavailable,note,created_at,updated_at)
    VALUES($1,$2,$3,$4,$5,$5) ON CONFLICT(plan_date) DO UPDATE SET
      capacity_minutes=excluded.capacity_minutes,unavailable=excluded.unavailable,note=excluded.note,updated_at=excluded.updated_at`, [
    day.date, day.capacityMinutes, Number(day.unavailable), day.note, now,
  ])
}

export async function savePlannerPreferences(preferences: PlannerPreferences) {
  await execute(`UPDATE planner_preferences SET default_daily_capacity_minutes=$1,
    review_reserve_minutes=$2,max_subject_block_minutes=$3,horizon_days=$4,updated_at=$5 WHERE id='default'`, [
    preferences.defaultDailyCapacityMinutes, preferences.reviewReserveMinutes,
    preferences.maxSubjectBlockMinutes, preferences.horizonDays, Date.now(),
  ])
}

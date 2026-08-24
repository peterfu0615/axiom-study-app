export const PLANNER_SCHEDULER_VERSION = 'unified-planner-v2'

export type PlannerTaskType = 'review' | 'correction' | 'homework' | 'exam_prep'
export type PlannerTaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled'
export type PlannerBacklogReason = 'deadline_passed' | 'capacity_exhausted' | 'unavailable_range'

export interface PlannerPreferences {
  defaultDailyCapacityMinutes: number
  reviewReserveMinutes: number
  maxSubjectBlockMinutes: number
  horizonDays: number
}

export interface PlannerAvailabilityDay {
  date: string
  capacityMinutes: number
  unavailable: boolean
  note: string | null
}

export interface PlannerExam {
  id: string
  title: string
  subject: string
  examDate: string
  chapterIds: string[]
  knowledgeTagIds: string[]
  status: 'upcoming' | 'completed' | 'cancelled'
}

export interface PlannerTask {
  id: string
  title: string
  taskType: PlannerTaskType
  subject: string
  dueDate: string
  dueAt: number | null
  estimatedMinutes: number
  actualMinutes: number | null
  priority: number
  splittable: boolean
  earliestDate: string
  chapterIds: string[]
  knowledgeTagIds: string[]
  status: PlannerTaskStatus
  sourceType: 'user' | 'review' | 'correction' | 'exam'
  sourceRef: string | null
  examId: string | null
  completedMinutes: number
  memoryRisk: number
}

export interface PlannerSegment {
  id: string
  taskId: string
  date: string
  minutes: number
  orderIndex: number
  status: 'scheduled' | 'completed' | 'skipped'
}

export interface PlannerScheduleDay extends PlannerAvailabilityDay {
  scheduledMinutes: number
  reviewMinutes: number
  remainingMinutes: number
  overloaded: boolean
  segments: PlannerSegment[]
}

export interface PlannerUnscheduledTask {
  taskId: string
  remainingMinutes: number
  reason: PlannerBacklogReason
}

export interface PlannerSchedule {
  days: PlannerScheduleDay[]
  unscheduled: PlannerUnscheduledTask[]
}

export interface BuildPlannerScheduleInput {
  startDate: string
  preferences: PlannerPreferences
  availability: PlannerAvailabilityDay[]
  tasks: PlannerTask[]
  exams: PlannerExam[]
}

const DAY_MS = 86_400_000

export function plannerDate(value: Date | number) {
  const date = typeof value === 'number' ? new Date(value) : value
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function addPlannerDays(date: string, days: number) {
  const [year, month, day] = date.split('-').map(Number)
  return plannerDate(new Date(year, month - 1, day + days))
}

function dateDistance(left: string, right: string) {
  const [ly, lm, ld] = left.split('-').map(Number)
  const [ry, rm, rd] = right.split('-').map(Number)
  return Math.round((Date.UTC(ry, rm - 1, rd) - Date.UTC(ly, lm - 1, ld)) / DAY_MS)
}

function examOverlap(task: PlannerTask, exams: PlannerExam[]) {
  const exam = task.examId ? exams.find((item) => item.id === task.examId) : undefined
  if (!exam || exam.status !== 'upcoming') return 0
  const taskTags = new Set([...task.chapterIds, ...task.knowledgeTagIds])
  return [...exam.chapterIds, ...exam.knowledgeTagIds].some((id) => taskTags.has(id)) ? 1 : 0
}

function deadlinePressure(task: PlannerTask, startDate: string) {
  const days = dateDistance(startDate, task.dueDate)
  if (days < 0) return 1_000 + Math.abs(days) * 10
  return Math.max(0, 120 - days * 12)
}

function capacityTightness(task: PlannerTask, input: BuildPlannerScheduleInput) {
  const overrides = new Map(input.availability.map((day) => [day.date, day]))
  const first = task.earliestDate > input.startDate ? task.earliestDate : input.startDate
  const days = Math.max(0, dateDistance(first, task.dueDate)) + 1
  let capacity = 0
  for (let offset = 0; offset < days; offset += 1) {
    const date = addPlannerDays(first, offset)
    const override = overrides.get(date)
    capacity += override?.unavailable ? 0 : override?.capacityMinutes ?? input.preferences.defaultDailyCapacityMinutes
  }
  const remaining = Math.max(0, task.estimatedMinutes - task.completedMinutes)
  const pressure = capacity <= 0 ? 200 : Math.min(200, remaining / capacity * 100)
  const reviewReserve = task.taskType === 'review'
    ? Math.min(100, input.preferences.reviewReserveMinutes / Math.max(1, remaining) * 100)
    : 0
  return pressure + reviewReserve
}

function taskScore(task: PlannerTask, input: BuildPlannerScheduleInput) {
  const reviewProtection = task.taskType === 'review' ? 220 : task.taskType === 'correction' ? 140 : 0
  return reviewProtection + deadlinePressure(task, input.startDate) + task.memoryRisk * 300
    + capacityTightness(task, input) + task.priority * 20 + examOverlap(task, input.exams) * 90
}

function orderDaySegments(day: PlannerScheduleDay, tasks: Map<string, PlannerTask>, maxBlock: number) {
  const remaining = [...day.segments]
  const result: PlannerSegment[] = []
  let subject = ''
  let block = 0
  while (remaining.length) {
    let index = 0
    if (subject && block >= maxBlock) {
      const alternative = remaining.findIndex((segment) => tasks.get(segment.taskId)?.subject !== subject)
      if (alternative >= 0) index = alternative
    }
    const next = remaining.splice(index, 1)[0]
    const nextSubject = tasks.get(next.taskId)?.subject ?? ''
    if (nextSubject && nextSubject === subject) block += next.minutes
    else { subject = nextSubject; block = next.minutes }
    result.push({ ...next, orderIndex: result.length })
  }
  return result
}

/** Deterministic unified scheduler. All task types share one hard daily capacity. */
export function getUnifiedLearningPlan(input: BuildPlannerScheduleInput): PlannerSchedule {
  const overrides = new Map(input.availability.map((day) => [day.date, day]))
  const days: PlannerScheduleDay[] = Array.from({ length: input.preferences.horizonDays }, (_, index) => {
    const date = addPlannerDays(input.startDate, index)
    const override = overrides.get(date)
    const capacityMinutes = override?.unavailable ? 0
      : Math.max(0, override?.capacityMinutes ?? input.preferences.defaultDailyCapacityMinutes)
    return {
      date, capacityMinutes, unavailable: override?.unavailable ?? false, note: override?.note ?? null,
      scheduledMinutes: 0, reviewMinutes: 0, remainingMinutes: capacityMinutes,
      overloaded: false, segments: [],
    }
  })
  const tasks = new Map(input.tasks.map((task) => [task.id, task]))
  const eligible = input.tasks
    .filter((task) => ['pending', 'in_progress'].includes(task.status))
    .map((task) => ({ task, remaining: Math.max(0, task.estimatedMinutes - task.completedMinutes) }))
    .filter((item) => item.remaining > 0)
    .sort((left, right) => Number(right.task.dueDate < input.startDate) - Number(left.task.dueDate < input.startDate)
      || capacityTightness(right.task, input) - capacityTightness(left.task, input)
      || taskScore(right.task, input) - taskScore(left.task, input)
      || (left.task.dueAt ?? Number.MAX_SAFE_INTEGER) - (right.task.dueAt ?? Number.MAX_SAFE_INTEGER)
      || left.task.dueDate.localeCompare(right.task.dueDate)
      || left.task.id.localeCompare(right.task.id))
  const unscheduled: PlannerUnscheduledTask[] = []
  let sequence = 0

  const place = (task: PlannerTask, day: PlannerScheduleDay, minutes: number) => {
    day.segments.push({
      id: `segment:${task.id}:${day.date}:${sequence++}`, taskId: task.id, date: day.date,
      minutes, orderIndex: day.segments.length, status: 'scheduled',
    })
    day.scheduledMinutes += minutes
    day.remainingMinutes -= minutes
    if (task.taskType === 'review') day.reviewMinutes += minutes
  }

  for (const item of eligible) {
    const { task } = item
    let remaining = item.remaining
    const range = days.filter((day) => day.date >= task.earliestDate && day.date <= task.dueDate)
    if (!range.length) {
      unscheduled.push({
        taskId: task.id, remainingMinutes: remaining,
        reason: task.dueDate < input.startDate ? 'deadline_passed' : 'unavailable_range',
      })
      continue
    }
    if (!task.splittable) {
      const target = [...range].filter((day) => day.remainingMinutes >= remaining)
        .sort((left, right) => left.date.localeCompare(right.date))[0]
      if (target) { place(task, target, remaining); remaining = 0 }
    } else {
      while (remaining > 0) {
        const available = range.filter((day) => day.remainingMinutes > 0)
        const protectedReviewDays = task.taskType === 'review'
          ? available.filter((day) => day.reviewMinutes < input.preferences.reviewReserveMinutes)
          : []
        const target = task.taskType === 'review'
          ? [...(protectedReviewDays.length ? protectedReviewDays : available)]
            .sort((left, right) => right.date.localeCompare(left.date))[0]
          : [...available].sort((left, right) =>
            left.scheduledMinutes / Math.max(1, left.capacityMinutes)
            - right.scheduledMinutes / Math.max(1, right.capacityMinutes)
            || left.date.localeCompare(right.date))[0]
        if (!target) break
        const reserveGap = task.taskType === 'review' && protectedReviewDays.length
          ? input.preferences.reviewReserveMinutes - target.reviewMinutes
          : 30
        const minutes = Math.min(30, remaining, target.remainingMinutes, Math.max(1, reserveGap))
        place(task, target, minutes)
        remaining -= minutes
      }
    }
    if (remaining > 0) {
      unscheduled.push({
        taskId: task.id, remainingMinutes: remaining,
        reason: range.some((day) => !day.unavailable && day.capacityMinutes > 0)
          ? 'capacity_exhausted' : 'unavailable_range',
      })
    }
  }
  days.forEach((day) => {
    day.segments = orderDaySegments(day, tasks, input.preferences.maxSubjectBlockMinutes)
    day.overloaded = unscheduled.some((item) => tasks.get(item.taskId)?.dueDate === day.date)
  })
  return { days, unscheduled }
}

export const buildPlannerSchedule = getUnifiedLearningPlan

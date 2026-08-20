export const PLANNER_SCHEDULER_VERSION = 'planner-v1'

export type PlannerTaskType = 'review' | 'correction' | 'homework' | 'exam_prep'
export type PlannerTaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled'

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
  remainingMinutes: number
  overloaded: boolean
  segments: PlannerSegment[]
}

export interface PlannerUnscheduledTask {
  taskId: string
  remainingMinutes: number
  reason: 'deadline_passed' | 'capacity_exhausted' | 'unavailable_range'
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
  subjectSpeedRatios: Record<string, number>
}

const DAY_MS = 86_400_000

export function plannerDate(value: Date | number) {
  const date = typeof value === 'number' ? new Date(value) : value
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function addPlannerDays(date: string, days: number) {
  const [year, month, day] = date.split('-').map(Number)
  return plannerDate(new Date(year, month - 1, day + days))
}

function dateDistance(left: string, right: string) {
  return Math.round((Date.parse(`${right}T00:00:00`) - Date.parse(`${left}T00:00:00`)) / DAY_MS)
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

function effectiveRemaining(task: PlannerTask, subjectSpeedRatios: Record<string, number>) {
  const base = Math.max(0, task.estimatedMinutes - task.completedMinutes)
  const speedRatio = clamp(subjectSpeedRatios[task.subject] ?? 1, .6, 1.8)
  return Math.ceil(base * speedRatio)
}

function examUrgency(task: PlannerTask, exams: PlannerExam[], startDate: string) {
  const exam = task.examId ? exams.find((item) => item.id === task.examId && item.status === 'upcoming') : undefined
  if (!exam) return 0
  const days = dateDistance(startDate, exam.examDate)
  if (days <= 2) return 30
  if (days <= 7) return 20
  if (days <= 14) return 10
  return 0
}

function taskUrgency(task: PlannerTask, exams: PlannerExam[], startDate: string) {
  const dueDays = dateDistance(startDate, task.dueDate)
  const deadline = dueDays < 0 ? 100 : Math.max(0, 36 - dueDays * 3)
  const reviewProtection = task.taskType === 'review' ? 200 : task.taskType === 'correction' ? 35 : 0
  return reviewProtection + task.priority * 12 + deadline + examUrgency(task, exams, startDate)
}

function reorderForSubjectSwitching(
  segments: Array<{ task: PlannerTask; segment: PlannerSegment }>,
  maxBlockMinutes: number,
) {
  const remaining = [...segments]
  const ordered: typeof segments = []
  let previousSubject = ''
  let consecutiveMinutes = 0
  while (remaining.length) {
    let index = 0
    if (previousSubject && consecutiveMinutes >= maxBlockMinutes) {
      const alternative = remaining.findIndex(({ task }) => task.subject && task.subject !== previousSubject)
      if (alternative >= 0) index = alternative
    }
    const next = remaining.splice(index, 1)[0]
    if (next.task.subject && next.task.subject === previousSubject) consecutiveMinutes += next.segment.minutes
    else {
      previousSubject = next.task.subject
      consecutiveMinutes = next.segment.minutes
    }
    ordered.push(next)
  }
  return ordered.map(({ segment }, orderIndex) => ({ ...segment, orderIndex }))
}

/**
 * Deterministic capacity scheduler. Review load is allocated before ordinary
 * work, no segment is placed after its deadline, and every day stays within
 * its declared capacity. Unplaceable work remains explicit instead of being
 * silently pushed beyond the horizon.
 */
export function buildPlannerSchedule(input: BuildPlannerScheduleInput): PlannerSchedule {
  const availability = new Map(input.availability.map((day) => [day.date, day]))
  const days: PlannerScheduleDay[] = Array.from({ length: input.preferences.horizonDays }, (_, index) => {
    const date = addPlannerDays(input.startDate, index)
    const override = availability.get(date)
    const capacityMinutes = override?.unavailable ? 0 : override?.capacityMinutes ?? input.preferences.defaultDailyCapacityMinutes
    return {
      date,
      capacityMinutes,
      unavailable: override?.unavailable ?? false,
      note: override?.note ?? null,
      scheduledMinutes: 0,
      remainingMinutes: capacityMinutes,
      overloaded: false,
      segments: [],
    }
  })
  const tasksById = new Map(input.tasks.map((task) => [task.id, task]))
  const eligible = input.tasks
    .filter((task) => task.status === 'pending' || task.status === 'in_progress')
    .map((task) => ({ task, remaining: effectiveRemaining(task, input.subjectSpeedRatios) }))
    .filter(({ remaining }) => remaining > 0)
    .sort((left, right) =>
      taskUrgency(right.task, input.exams, input.startDate) - taskUrgency(left.task, input.exams, input.startDate)
      || left.task.dueDate.localeCompare(right.task.dueDate)
      || left.task.id.localeCompare(right.task.id))
  const unscheduled: PlannerUnscheduledTask[] = []
  let segmentSequence = 0

  const addSegment = (task: PlannerTask, day: PlannerScheduleDay, minutes: number) => {
    day.segments.push({
      id: `segment:${task.id}:${day.date}:${segmentSequence++}`,
      taskId: task.id,
      date: day.date,
      minutes,
      orderIndex: day.segments.length,
      status: 'scheduled',
    })
    day.scheduledMinutes += minutes
    day.remainingMinutes -= minutes
  }

  for (const candidate of eligible) {
    const { task } = candidate
    let remaining = candidate.remaining
    const range = days.filter((day) => day.date >= task.earliestDate && day.date <= task.dueDate)
    if (!range.length) {
      unscheduled.push({ taskId: task.id, remainingMinutes: remaining, reason: task.dueDate < input.startDate ? 'deadline_passed' : 'unavailable_range' })
      continue
    }

    if (!task.splittable) {
      const target = [...range]
        .filter((day) => day.remainingMinutes >= remaining)
        .sort((left, right) => left.scheduledMinutes / Math.max(1, left.capacityMinutes) - right.scheduledMinutes / Math.max(1, right.capacityMinutes)
          || left.date.localeCompare(right.date))[0]
      if (target) {
        addSegment(task, target, remaining)
        remaining = 0
      }
    } else {
      const chunkLimit = task.taskType === 'review'
        ? input.preferences.reviewReserveMinutes
        : Math.min(30, input.preferences.maxSubjectBlockMinutes)
      while (remaining > 0) {
        const target = [...range]
          .filter((day) => day.remainingMinutes > 0)
          .sort((left, right) => left.scheduledMinutes / Math.max(1, left.capacityMinutes) - right.scheduledMinutes / Math.max(1, right.capacityMinutes)
            || left.date.localeCompare(right.date))[0]
        if (!target) break
        const minutes = Math.min(remaining, target.remainingMinutes, chunkLimit)
        addSegment(task, target, minutes)
        remaining -= minutes
      }
    }
    if (remaining > 0) {
      const anyAvailable = range.some((day) => !day.unavailable && day.capacityMinutes > 0)
      unscheduled.push({ taskId: task.id, remainingMinutes: remaining, reason: anyAvailable ? 'capacity_exhausted' : 'unavailable_range' })
    }
  }

  for (const day of days) {
    day.segments = reorderForSubjectSwitching(
      day.segments.map((segment) => ({ task: tasksById.get(segment.taskId)!, segment })),
      input.preferences.maxSubjectBlockMinutes,
    )
    day.overloaded = unscheduled.some((item) => tasksById.get(item.taskId)?.dueDate === day.date)
  }
  return { days, unscheduled }
}

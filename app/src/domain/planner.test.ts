import { describe, expect, it } from 'vitest'
import { getUnifiedLearningPlan, type PlannerTask } from './planner'

const preferences = {
  defaultDailyCapacityMinutes: 60, reviewReserveMinutes: 25,
  maxSubjectBlockMinutes: 30, horizonDays: 3,
}
const task = (overrides: Partial<PlannerTask>): PlannerTask => ({
  id: 'task', title: '作业', taskType: 'homework', subject: '数学', dueDate: '2026-08-23',
  dueAt: null, estimatedMinutes: 30, actualMinutes: null, priority: 3, splittable: true,
  earliestDate: '2026-08-21', chapterIds: [], knowledgeTagIds: [], status: 'pending',
  sourceType: 'user', sourceRef: null, examId: null, completedMinutes: 0, memoryRisk: 0,
  ...overrides,
})

describe('unified planner v2', () => {
  it('protects due review and never exceeds the daily hard capacity', () => {
    const schedule = getUnifiedLearningPlan({
      startDate: '2026-08-21', preferences, availability: [], exams: [],
      tasks: [
        task({ id: 'homework', estimatedMinutes: 150 }),
        task({ id: 'review', taskType: 'review', sourceType: 'review', dueDate: '2026-08-21', estimatedMinutes: 25, priority: 5, memoryRisk: .3 }),
      ],
    })
    expect(schedule.days[0].segments[0].taskId).toBe('review')
    expect(schedule.days.every((day) => day.scheduledMinutes <= day.capacityMinutes)).toBe(true)
    expect(schedule.days[0].reviewMinutes).toBe(25)
  })

  it('splits work into at most 30 minutes and keeps every segment before its deadline', () => {
    const schedule = getUnifiedLearningPlan({
      startDate: '2026-08-21', preferences, availability: [], exams: [],
      tasks: [task({ estimatedMinutes: 110, dueDate: '2026-08-22' })],
    })
    const segments = schedule.days.flatMap((day) => day.segments)
    expect(segments.every((segment) => segment.minutes <= 30)).toBe(true)
    expect(segments.every((segment) => segment.date <= '2026-08-22')).toBe(true)
  })

  it('makes unavailable and over-capacity work explicit in backlog', () => {
    const schedule = getUnifiedLearningPlan({
      startDate: '2026-08-21', preferences, exams: [],
      availability: [{ date: '2026-08-21', capacityMinutes: 0, unavailable: true, note: null }],
      tasks: [task({ dueDate: '2026-08-21', estimatedMinutes: 40 })],
    })
    expect(schedule.days[0].segments).toHaveLength(0)
    expect(schedule.unscheduled).toEqual([{ taskId: 'task', remainingMinutes: 40, reason: 'unavailable_range' }])
  })

  it('switches subject after the configured continuous block when alternatives exist', () => {
    const schedule = getUnifiedLearningPlan({
      startDate: '2026-08-21', preferences: { ...preferences, horizonDays: 1 }, availability: [], exams: [],
      tasks: [
        task({ id: 'math-a', estimatedMinutes: 30 }), task({ id: 'math-b', estimatedMinutes: 15 }),
        task({ id: 'english', subject: '英语', estimatedMinutes: 15 }),
      ],
    })
    const subjects = schedule.days[0].segments.map((segment) => segment.taskId)
    expect(subjects).toEqual(['math-a', 'english', 'math-b'])
  })

  it('raises exam work whose tags overlap the exam scope and remains deterministic', () => {
    const input = {
      startDate: '2026-08-21', preferences: { ...preferences, defaultDailyCapacityMinutes: 30, horizonDays: 1 }, availability: [],
      exams: [{ id: 'exam', title: '月考', subject: '数学', examDate: '2026-08-22', chapterIds: [], knowledgeTagIds: ['functions'], status: 'upcoming' as const }],
      tasks: [
        task({ id: 'ordinary', priority: 5 }),
        task({ id: 'exam-task', taskType: 'exam_prep', examId: 'exam', knowledgeTagIds: ['functions'] }),
      ],
    }
    const first = getUnifiedLearningPlan(input)
    expect(first.days[0].segments[0].taskId).toBe('exam-task')
    expect(getUnifiedLearningPlan(input)).toEqual(first)
  })

  it('reports deadline-passed work without moving it into the future', () => {
    const schedule = getUnifiedLearningPlan({
      startDate: '2026-08-21', preferences, availability: [], exams: [],
      tasks: [task({ dueDate: '2026-08-20', earliestDate: '2026-08-19' })],
    })
    expect(schedule.unscheduled[0]).toMatchObject({ reason: 'deadline_passed', remainingMinutes: 30 })
  })
})

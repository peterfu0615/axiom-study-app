import { describe, expect, it } from 'vitest'
import { buildPlannerSchedule, type PlannerTask } from './planner'

const preferences = {
  defaultDailyCapacityMinutes: 60,
  reviewReserveMinutes: 25,
  maxSubjectBlockMinutes: 30,
  horizonDays: 3,
}

function task(overrides: Partial<PlannerTask>): PlannerTask {
  return {
    id: 'task', title: '作业', taskType: 'homework', subject: '数学',
    dueDate: '2026-08-23', estimatedMinutes: 30, actualMinutes: null,
    priority: 3, splittable: true, earliestDate: '2026-08-21',
    chapterIds: [], knowledgeTagIds: [], status: 'pending', sourceType: 'user',
    sourceRef: null, examId: null, completedMinutes: 0, ...overrides,
  }
}

describe('planner scheduler', () => {
  it('protects review work and never exceeds daily capacity or a deadline', () => {
    const schedule = buildPlannerSchedule({
      startDate: '2026-08-21', preferences, availability: [], exams: [], subjectSpeedRatios: {},
      tasks: [
        task({ id: 'homework', estimatedMinutes: 150, dueDate: '2026-08-23' }),
        task({ id: 'review', title: '到期复习', taskType: 'review', sourceType: 'review', sourceRef: '2026-08-21', dueDate: '2026-08-21', estimatedMinutes: 25, priority: 5 }),
      ],
    })
    expect(schedule.days[0].segments[0].taskId).toBe('review')
    expect(schedule.days.every((day) => day.scheduledMinutes <= day.capacityMinutes)).toBe(true)
    expect(schedule.days.flatMap((day) => day.segments).every((segment) => segment.date <= (segment.taskId === 'review' ? '2026-08-21' : '2026-08-23'))).toBe(true)
  })

  it('leaves impossible work explicit instead of scheduling after its deadline', () => {
    const schedule = buildPlannerSchedule({
      startDate: '2026-08-21', preferences, availability: [{ date: '2026-08-21', capacityMinutes: 0, unavailable: true, note: null }], exams: [], subjectSpeedRatios: {},
      tasks: [task({ dueDate: '2026-08-21', estimatedMinutes: 40 })],
    })
    expect(schedule.days.flatMap((day) => day.segments)).toHaveLength(0)
    expect(schedule.unscheduled).toEqual([{ taskId: 'task', remainingMinutes: 40, reason: 'unavailable_range' }])
  })

  it('uses actual subject speed and splits long work across the lightest days', () => {
    const schedule = buildPlannerSchedule({
      startDate: '2026-08-21', preferences, availability: [], exams: [], subjectSpeedRatios: { 数学: 1.5 },
      tasks: [task({ estimatedMinutes: 80 })],
    })
    expect(schedule.days.reduce((sum, day) => sum + day.scheduledMinutes, 0)).toBe(120)
    expect(schedule.days.filter((day) => day.scheduledMinutes > 0)).toHaveLength(3)
  })

  it('raises exam-scoped work ahead of ordinary work as the exam approaches', () => {
    const schedule = buildPlannerSchedule({
      startDate: '2026-08-21', preferences: { ...preferences, defaultDailyCapacityMinutes: 30 }, availability: [], subjectSpeedRatios: {},
      exams: [{ id: 'exam', title: '月考', subject: '数学', examDate: '2026-08-22', chapterIds: [], knowledgeTagIds: [], status: 'upcoming' }],
      tasks: [task({ id: 'ordinary', priority: 5 }), task({ id: 'exam-task', taskType: 'exam_prep', examId: 'exam', priority: 3 })],
    })
    expect(schedule.days[0].segments[0].taskId).toBe('exam-task')
  })

  it('keeps future review on its due day and only pulls it earlier when that day is full', () => {
    const schedule = buildPlannerSchedule({
      startDate: '2026-08-21', preferences, availability: [], exams: [], subjectSpeedRatios: {},
      tasks: [task({ id: 'review', taskType: 'review', sourceType: 'review', sourceRef: '2026-08-23', dueDate: '2026-08-23', estimatedMinutes: 25, priority: 5 })],
    })
    expect(schedule.days.flatMap((day) => day.segments).map((segment) => segment.date)).toEqual(['2026-08-23'])
  })
})

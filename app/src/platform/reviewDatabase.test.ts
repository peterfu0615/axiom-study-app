import { describe, expect, it, vi } from 'vitest'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({ invoke }))

import { getSevenDayReviewForecast, listTodayCorrectionTasks, resolveReviewQuestionMedia } from './reviewDatabase'

describe('review question media snapshots', () => {
  it('uses immutable snapshot image references when present', () => {
    expect(resolveReviewQuestionMedia(
      { questionImagePath: '/snapshot/question.jpg', diagramImagePaths: ['/snapshot/manual-diagram.jpg'] },
      { questionImagePath: '/current/question.jpg', diagramImagePath: '/current/auto.jpg' },
    )).toEqual({ questionImagePath: '/snapshot/question.jpg', diagramImagePaths: ['/snapshot/manual-diagram.jpg'] })
  })

  it('keeps legacy Today plans compatible through current problem media', () => {
    expect(resolveReviewQuestionMedia(
      {},
      { questionImagePath: '/current/question.jpg', diagramImagePath: '/current/manual-diagram.jpg' },
    )).toEqual({ questionImagePath: '/current/question.jpg', diagramImagePaths: ['/current/manual-diagram.jpg'] })
  })

  it('falls back safely when files or references are absent', () => {
    expect(resolveReviewQuestionMedia({}, { questionImagePath: null, diagramImagePath: null }))
      .toEqual({ questionImagePath: null, diagramImagePaths: [] })
  })
})

describe('forecast persistence boundary', () => {
  it('performs only reads and creates no future plans or skill writes', async () => {
    invoke.mockResolvedValue([])
    const result = await getSevenDayReviewForecast(new Date(2026, 7, 10, 9).getTime())
    expect(result).toHaveLength(7)
    expect(invoke).toHaveBeenCalledTimes(7)
    expect(invoke.mock.calls.every(([command]) => command === 'db_select')).toBe(true)
    const sql = invoke.mock.calls.map(([, payload]) => String(payload.sql)).join('\n')
    expect(sql).toContain('problem_mistake_evidences')
    expect(sql).toContain('skill_bundle_states')
  })
})

describe('Today correction tasks', () => {
  it('derives unfinished corrections without creating planner tasks', async () => {
    invoke.mockReset()
    invoke.mockResolvedValue([{
      attempt_id: 'attempt-1', practice_set_id: 'set-1', subject: '数学',
      pending_count: 2, created_at: 100,
    }])
    await expect(listTodayCorrectionTasks()).resolves.toEqual([{
      id: 'attempt-1', practiceSetId: 'set-1', practiceAttemptId: 'attempt-1',
      subject: '数学', pendingProblemCount: 2, estimatedMinutes: 30, createdAt: 100,
    }])
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke.mock.calls[0][0]).toBe('db_select')
    expect(invoke.mock.calls[0][1].sql).toContain('NOT EXISTS(SELECT 1 FROM practice_evidences')
  })
})

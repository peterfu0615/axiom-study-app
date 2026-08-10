import { describe, expect, it, vi } from 'vitest'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({ invoke }))

import { getSevenDayReviewForecast, resolveReviewQuestionMedia } from './reviewDatabase'

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
    expect(invoke).toHaveBeenCalledTimes(4)
    expect(invoke.mock.calls.every(([command]) => command === 'db_select')).toBe(true)
  })
})

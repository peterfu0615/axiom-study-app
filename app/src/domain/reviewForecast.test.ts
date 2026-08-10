import { describe, expect, it } from 'vitest'
import type { ReviewCandidate, ReviewTag } from './review'
import { applyReviewRating } from './review'
import { buildSevenDayReviewForecast } from './reviewForecast'

const now = new Date(2026, 7, 10, 9).getTime()
const day = 86_400_000
const tag = (type: ReviewTag['type'], name: string): ReviewTag => ({ id: `${type}-${name}`, name, type, role: 'primary' })
const candidate = (id: string, dueAt?: number | null, tags: ReviewTag[] = [tag('knowledge', '函数')]): ReviewCandidate => ({
  problemId: id, subject: '数学', title: id, stemMarkdown: id, structuredContentJson: '{}', solutionJson: '{}',
  createdAt: now - 10 * day, difficulty: 'intermediate', tags,
  skillStates: dueAt === undefined ? {} : { [tags[0]?.id ?? id]: {
    masteryEstimate: .55, stability: 2, retrievability: .7, evidenceCount: 1,
    successCount: 1, failureCount: 0, transferScore: 0, maxStableDifficulty: 'intermediate',
    lastPracticedAt: now - day, nextReviewAt: dueAt ?? null, uncertainty: .6,
  } }, lastReviewedAt: null, reviewCount: 0, lastRating: null,
})

describe('seven-day review forecast', () => {
  it('returns seven deterministic empty local days', () => {
    const result = buildSevenDayReviewForecast([], now)
    expect(result).toHaveLength(7)
    expect(result.every((item) => item.loadLevel === 'empty')).toBe(true)
    expect(buildSevenDayReviewForecast([], now)).toEqual(result)
  })

  it('places tomorrow due, overdue and different-day work in the correct buckets', () => {
    const result = buildSevenDayReviewForecast([
      candidate('overdue', now - day), candidate('tomorrow', now + day), candidate('later', now + 3 * day),
    ], now)
    expect(result[0]).toMatchObject({ estimatedProblemCount: 1, overdueProblemCount: 1 })
    expect(result[1].estimatedProblemCount).toBe(1)
    expect(result[3].estimatedProblemCount).toBe(1)
  })

  it('clusters same-skill candidates and supports partial or absent tags and mixed difficulty', () => {
    const shared = [tag('knowledge', '函数'), tag('method', '数形结合')]
    const first = candidate('a', now, shared)
    const second = { ...candidate('b', now, shared), difficulty: 'advanced' as const }
    const legacy = candidate('legacy', undefined, [])
    const result = buildSevenDayReviewForecast([first, second, legacy], now)[0]
    expect(result.estimatedProblemCount).toBe(3)
    expect(result.estimatedUnitCount).toBe(2)
    expect(result.dominantThemes).toContain('函数 · 数形结合')
  })

  it('marks a large same-day set as heavy after planner clustering', () => {
    const items = Array.from({ length: 5 }, (_, index) => candidate(`p${index}`, now, [
      tag('knowledge', `知识${index}`), tag('method', `方法${index}`),
    ]))
    expect(buildSevenDayReviewForecast(items, now)[0].loadLevel).toBe('heavy')
  })

  it('moves load after a completed review changes next schedule without mutating input', () => {
    const before = candidate('p', now)
    const snapshot = JSON.stringify(before)
    expect(buildSevenDayReviewForecast([before], now)[0].estimatedProblemCount).toBe(1)
    const reviewed = { ...before, skillStates: { ...before.skillStates } }
    reviewed.skillStates[Object.keys(reviewed.skillStates)[0]] = applyReviewRating(
      Object.values(before.skillStates)[0], 'hard', 'intermediate', now,
    )
    const forecast = buildSevenDayReviewForecast([reviewed], now)
    expect(forecast[0].estimatedProblemCount).toBe(0)
    expect(forecast.some((item, index) => index > 0 && item.estimatedProblemCount === 1)).toBe(true)
    expect(JSON.stringify(before)).toBe(snapshot)
  })

  it('uses immutable review feedback to schedule legacy candidates without tag state', () => {
    const legacy = { ...candidate('legacy', undefined, []), lastReviewedAt: now, reviewCount: 1, lastRating: 'good' as const }
    const forecast = buildSevenDayReviewForecast([legacy], now)
    expect(forecast[0].estimatedProblemCount).toBe(0)
    expect(forecast.some((item, index) => index > 0 && item.estimatedProblemCount === 1)).toBe(true)
  })

  it('keeps a 1,000-problem forecast deterministic without changing planner limits', () => {
    const items = Array.from({ length: 1_000 }, (_, index) => candidate(`large-${index}`, now, [
      tag('knowledge', `知识${index}`), tag('method', `方法${index}`),
    ]))
    const first = buildSevenDayReviewForecast(items, now)
    expect(first[0]).toMatchObject({ estimatedUnitCount: 1_000, estimatedProblemCount: 1_000, loadLevel: 'heavy' })
    expect(buildSevenDayReviewForecast(items, now)).toEqual(first)
  })
})

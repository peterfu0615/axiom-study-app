import { describe, expect, it } from 'vitest'
import type { ReviewCandidate, ReviewTag } from './review'
import { applyReviewRating } from './review'
import { buildReviewForecast } from './reviewForecast'

const now = new Date(2026, 7, 10, 9).getTime()
const day = 86_400_000
const tag = (type: ReviewTag['type'], name: string): ReviewTag => ({ id: `${type}-${name}`, name, type, role: 'primary' })
const candidate = (id: string, dueAt?: number | null, tags: ReviewTag[] = [tag('knowledge', '函数')]): ReviewCandidate => ({
  problemId: id, subject: '数学', title: id, stemMarkdown: id, structuredContentJson: '{}', solutionJson: '{}',
  createdAt: now - 10 * day, difficulty: 'intermediate', tags,
  skillStates: dueAt === undefined ? {} : { [tags[0]?.id ?? id]: {
    masteryEstimate: .55, stability: dueAt == null ? 2 : 1 / -Math.log(.85), retrievability: .7, evidenceCount: 1,
    successCount: 1, failureCount: 0, transferScore: 0, maxStableDifficulty: 'intermediate',
    lastPracticedAt: dueAt == null ? now - day : dueAt - day,
    nextReviewAt: dueAt ?? null, uncertainty: .6,
  } }, lastReviewedAt: null, reviewCount: 0, lastRating: null,
})

function withBundle(current: ReviewCandidate, dueAt: number) {
  return {
    ...current,
    bundleState: {
      ...Object.values(current.skillStates)[0],
      lastPracticedAt: dueAt - day,
      nextReviewAt: dueAt,
    },
  }
}

describe('seven-day review forecast', () => {
  it('returns seven deterministic empty local days', () => {
    const result = buildReviewForecast([], now)
    expect(result).toHaveLength(7)
    expect(result.every((item) => item.loadLevel === 'empty')).toBe(true)
    expect(buildReviewForecast([], now)).toEqual(result)
    // 可变区间：14 天 / 30 天时间轴复用同一纯函数
    expect(buildReviewForecast([], now, 14)).toHaveLength(14)
    expect(buildReviewForecast([], now, 30)).toHaveLength(30)
  })

  it('places first occurrences correctly and continues later Good-rated reviews', () => {
    const result = buildReviewForecast([
      candidate('overdue', now - day), candidate('tomorrow', now + day), candidate('later', now + 3 * day),
    ], now)
    expect(result[0]).toMatchObject({ estimatedProblemCount: 1, overdueProblemCount: 1 })
    expect(result[1].estimatedProblemCount).toBe(1)
    expect(result[3].estimatedProblemCount).toBeGreaterThanOrEqual(1)
    expect(result.reduce((sum, item) => sum + item.estimatedProblemCount, 0)).toBeGreaterThan(3)
  })

  it('clusters same-skill candidates and supports partial or absent tags and mixed difficulty', () => {
    const shared = [tag('knowledge', '函数'), tag('method', '数形结合')]
    const first = candidate('a', now, shared)
    const second = { ...candidate('b', now, shared), difficulty: 'advanced' as const }
    const legacy = candidate('legacy', undefined, [])
    const result = buildReviewForecast([first, second, legacy], now)[0]
    expect(result.estimatedProblemCount).toBe(3)
    expect(result.estimatedUnitCount).toBe(2)
    expect(result.dominantThemes).toContain('函数 · 数形结合')
  })

  it('marks a large same-day set as heavy after planner clustering', () => {
    const items = Array.from({ length: 5 }, (_, index) => candidate(`p${index}`, now, [
      tag('knowledge', `知识${index}`), tag('method', `方法${index}`),
    ]))
    expect(buildReviewForecast(items, now)[0].loadLevel).toBe('heavy')
  })

  it('moves load after a completed review changes next schedule without mutating input', () => {
    const before = candidate('p', now)
    const snapshot = JSON.stringify(before)
    expect(buildReviewForecast([before], now)[0].estimatedProblemCount).toBe(1)
    const reviewed = { ...before, skillStates: { ...before.skillStates } }
    reviewed.skillStates[Object.keys(reviewed.skillStates)[0]] = applyReviewRating(
      Object.values(before.skillStates)[0], 'hard', 'intermediate', now,
    )
    const forecast = buildReviewForecast([reviewed], now)
    expect(forecast[0].estimatedProblemCount).toBe(0)
    expect(forecast.some((item, index) => index > 0 && item.estimatedProblemCount === 1)).toBe(true)
    expect(JSON.stringify(before)).toBe(snapshot)
  })

  it('projects repeated Good reviews without mutating current skill state', () => {
    const current = candidate('repeat', now + day)
    const snapshot = JSON.stringify(current)
    const forecast = buildReviewForecast([current], now, 30)
    expect(forecast.reduce((sum, item) => sum + item.estimatedProblemCount, 0)).toBeGreaterThan(2)
    expect(forecast.filter((item) => item.estimatedProblemCount > 0).length).toBeGreaterThan(1)
    expect(JSON.stringify(current)).toBe(snapshot)
  })

  it('advances an overdue bundle state and never repeats one problem on the same day', () => {
    const current = withBundle(candidate('stale-bundle', now + day), now - 30 * day)
    const snapshot = JSON.stringify(current)
    const forecast = buildReviewForecast([current], now, 30)
    expect(forecast[0].estimatedProblemCount).toBe(1)
    expect(forecast.every((item) => item.estimatedProblemCount <= 1)).toBe(true)
    expect(forecast.reduce((sum, item) => sum + item.estimatedProblemCount, 0)).toBeLessThanOrEqual(30)
    expect(JSON.stringify(current)).toBe(snapshot)
  })

  it('keeps a five-problem daily forecast within the available problem count', () => {
    const items = Array.from({ length: 5 }, (_, index) => withBundle(
      candidate(`small-${index}`, now - day, [tag('knowledge', `知识${index}`)]),
      now - day,
    ))
    const today = buildReviewForecast(items, now, 30)[0]
    expect(today.estimatedProblemCount).toBe(5)
    expect(today.estimatedMinutes).toBeLessThanOrEqual(75)
  })

  it('increases projected frequency from relaxed to intensive pace', () => {
    const current = candidate('pace', now + day)
    const count = (target: number) => buildReviewForecast([current], now, 30, target)
      .reduce((sum, item) => sum + item.estimatedProblemCount, 0)
    expect(count(.85)).toBeGreaterThanOrEqual(count(.8))
    expect(count(.9)).toBeGreaterThanOrEqual(count(.85))
  })

  it('uses immutable review feedback to schedule legacy candidates without tag state', () => {
    const legacy = { ...candidate('legacy', undefined, []), lastReviewedAt: now, reviewCount: 1, lastRating: 'good' as const }
    const forecast = buildReviewForecast([legacy], now)
    expect(forecast[0].estimatedProblemCount).toBe(0)
    expect(forecast.some((item, index) => index > 0 && item.estimatedProblemCount === 1)).toBe(true)
  })

  it('keeps a 1,000-problem forecast deterministic without changing planner limits', () => {
    const items = Array.from({ length: 1_000 }, (_, index) => candidate(`large-${index}`, now, [
      tag('knowledge', `知识${index}`), tag('method', `方法${index}`),
    ]))
    const first = buildReviewForecast(items, now)
    expect(first[0]).toMatchObject({ estimatedUnitCount: 1_000, estimatedProblemCount: 1_000, loadLevel: 'heavy' })
    expect(buildReviewForecast(items, now)).toEqual(first)
  })
})

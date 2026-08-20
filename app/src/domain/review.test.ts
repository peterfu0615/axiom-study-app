import { describe, expect, it } from 'vitest'
import {
  applyReviewRating,
  applyWeightedReviewRating,
  buildTodayReviewUnits,
  canTransitionReviewSession,
  defaultReviewSessionSettings,
  initialReviewSkillState,
  localReviewDate,
  reviewSimilarity,
  type ReviewCandidate,
  type ReviewTag,
} from './review'

const now = new Date('2026-08-10T09:00:00+08:00').getTime()
const tag = (type: ReviewTag['type'], name: string, role: ReviewTag['role'] = 'primary'): ReviewTag => ({
  id: `${type}-${name}`, name, type, role,
})
const candidate = (id: string, overrides: Partial<ReviewCandidate> = {}): ReviewCandidate => ({
  problemId: id,
  subject: '数学',
  title: `题目 ${id}`,
  stemMarkdown: `求解 ${id}`,
  structuredContentJson: '{}',
  solutionJson: '{}',
  createdAt: now - 5 * 86_400_000,
  difficulty: 'intermediate',
  tags: [tag('knowledge', '一元二次方程')],
  skillStates: {},
  lastReviewedAt: null,
  reviewCount: 0,
  lastRating: null,
  ...overrides,
})

describe('Horizon Today planner', () => {
  it('creates a deterministic unit for one tag and one problem', () => {
    const units = buildTodayReviewUnits([candidate('a')], { now })
    expect(units).toHaveLength(1)
    expect(units[0].title).toBe('一元二次方程')
    expect(buildTodayReviewUnits([candidate('a')], { now })).toEqual(units)
  })

  it('uses multiple dimensions in a review theme', () => {
    const units = buildTodayReviewUnits([candidate('a', {
      tags: [tag('knowledge', '一元二次方程'), tag('method', '换元法'), tag('model', '参数讨论'), tag('error', '条件遗漏')],
    })], { now })
    expect(units[0].title).toBe('一元二次方程 · 换元法')
    expect(units[0].models[0].name).toBe('参数讨论')
    expect(units[0].errorCategories[0].name).toBe('条件遗漏')
  })

  it('clusters highly overlapping mistakes into one dense unit', () => {
    const shared = [tag('knowledge', '一元二次方程'), tag('method', '换元法'), tag('error', '条件遗漏')]
    const units = buildTodayReviewUnits([
      candidate('a', { tags: [...shared, tag('model', '根的判别式')] }),
      candidate('b', { tags: [...shared, tag('model', '参数讨论')] }),
    ], { now })
    expect(units).toHaveLength(1)
    expect(units[0].allProblemIds).toEqual(['a', 'b'])
  })

  it('keeps unrelated problems in separate units', () => {
    const units = buildTodayReviewUnits([
      candidate('a', { tags: [tag('knowledge', '一元二次方程'), tag('method', '换元法')] }),
      candidate('b', { tags: [tag('knowledge', '全等三角形'), tag('method', '倍长中线')] }),
    ], { now })
    expect(units).toHaveLength(2)
    expect(reviewSimilarity(units[0].representativeProblems[0], units[1].representativeProblems[0])).toBe(.03)
  })

  it('does not over-cluster the same knowledge with different methods or errors', () => {
    const units = buildTodayReviewUnits([
      candidate('a', { tags: [tag('knowledge', '一元二次方程'), tag('method', '换元法'), tag('error', '条件遗漏')] }),
      candidate('b', { tags: [tag('knowledge', '一元二次方程'), tag('method', '公式法'), tag('error', '计算失误')] }),
    ], { now })
    expect(units).toHaveLength(2)
  })

  it('does not merge the same method across different knowledge', () => {
    const units = buildTodayReviewUnits([
      candidate('a', { tags: [tag('knowledge', '一元二次方程'), tag('method', '换元法')] }),
      candidate('b', { tags: [tag('knowledge', '分式方程'), tag('method', '换元法')] }),
    ], { now })
    expect(units).toHaveLength(2)
  })

  it('keeps mixed difficulty in one overlapping unit and selects its dominant context', () => {
    const tags = [tag('knowledge', '函数'), tag('method', '数形结合')]
    const units = buildTodayReviewUnits([
      candidate('a', { tags, difficulty: 'basic' }),
      candidate('b', { tags, difficulty: 'advanced' }),
      candidate('c', { tags, difficulty: 'advanced' }),
    ], { now })
    expect(units).toHaveLength(1)
    expect(units[0].difficulty).toBe('advanced')
  })

  it('safely plans partially tagged and completely untagged legacy problems', () => {
    const units = buildTodayReviewUnits([
      candidate('partial', { tags: [tag('method', '分类讨论')], difficulty: null }),
      candidate('untagged', { tags: [], difficulty: null }),
    ], { now })
    expect(units).toHaveLength(2)
    expect(units.some((unit) => unit.title === '分类讨论')).toBe(true)
    expect(units.some((unit) => unit.title === '题目 untagged')).toBe(true)
  })

  it('deprioritizes a just-reviewed item and promotes a long-neglected item', () => {
    const recent = candidate('recent', { lastReviewedAt: now - 60_000, reviewCount: 2, lastRating: 'good' })
    const old = candidate('old', { createdAt: now - 180 * 86_400_000, lastReviewedAt: now - 100 * 86_400_000, reviewCount: 2, lastRating: 'hard' })
    const units = buildTodayReviewUnits([recent, old], { now })
    expect(units[0].representativeProblems[0].problemId).toBe('old')
  })

  it('applies overlap penalty while retaining clearly higher-value content', () => {
    const repeated = [tag('knowledge', '函数'), tag('method', '数形结合')]
    const units = buildTodayReviewUnits([
      candidate('overdue-a', { tags: repeated, lastRating: 'again', createdAt: now - 100 * 86_400_000 }),
      candidate('overdue-b', { tags: [tag('knowledge', '函数'), tag('method', '待定系数法')], lastRating: 'again', createdAt: now - 100 * 86_400_000 }),
      candidate('other', { tags: [tag('knowledge', '全等三角形'), tag('method', '倍长中线')] }),
    ], { now, maxModules: 2 })
    expect(units).toHaveLength(2)
    expect(new Set(units.map((unit) => unit.canonicalKey)).size).toBe(2)
  })
})

describe('Horizon review scheduler', () => {
  it('updates mastery, evidence, next review and difficulty for all ratings', () => {
    const again = applyReviewRating(null, 'again', 'intermediate', now)
    const hard = applyReviewRating(null, 'hard', 'intermediate', now)
    const good = applyReviewRating(null, 'good', 'intermediate', now)
    const easy = applyReviewRating(null, 'easy', 'advanced', now)
    expect(again.masteryEstimate).toBeLessThan(hard.masteryEstimate)
    expect(hard.nextReviewAt).toBeLessThan(good.nextReviewAt!)
    expect(good.nextReviewAt).toBeLessThan(easy.nextReviewAt!)
    expect(easy.maxStableDifficulty).toBe('advanced')
    expect([again, hard, good, easy].every((state) => state.evidenceCount === 1)).toBe(true)
  })

  it('records failures and reduces uncertainty without destroying prior state', () => {
    const initial = { ...initialReviewSkillState(), evidenceCount: 3, successCount: 2, masteryEstimate: .8 }
    const next = applyReviewRating(initial, 'again', 'basic', now)
    expect(next.evidenceCount).toBe(4)
    expect(next.successCount).toBe(2)
    expect(next.failureCount).toBe(1)
    expect(next.uncertainty).toBeLessThan(initial.uncertainty)
  })

  it('ignores insufficient tag evidence and preserves a demonstrated method after a calculation error', () => {
    const initial = initialReviewSkillState()
    expect(applyWeightedReviewRating(initial, 'again', 'intermediate', now, 0)).toEqual(initial)
    const method = applyWeightedReviewRating(initial, 'good', 'intermediate', now, .9, true)
    expect(method.masteryEstimate).toBeGreaterThan(initial.masteryEstimate)
    expect(method.failureCount).toBe(0)
    expect(method.transferScore).toBeGreaterThan(0)
  })

  it('uses the local calendar date across day boundaries', () => {
    expect(localReviewDate(new Date('2026-08-10T23:59:59+08:00').getTime())).toBe('2026-08-10')
    expect(localReviewDate(new Date('2026-08-11T00:00:01+08:00').getTime())).toBe('2026-08-11')
  })

  it('enforces the durable practice session lifecycle and recovery edges', () => {
    expect(canTransitionReviewSession('draft', 'generated')).toBe(true)
    expect(canTransitionReviewSession('generated', 'exported')).toBe(true)
    expect(canTransitionReviewSession('exported', 'submitted')).toBe(true)
    expect(canTransitionReviewSession('submitted', 'processing')).toBe(true)
    expect(canTransitionReviewSession('processing', 'needs_review')).toBe(true)
    expect(canTransitionReviewSession('needs_review', 'graded')).toBe(true)
    expect(canTransitionReviewSession('graded', 'applied')).toBe(true)
    expect(canTransitionReviewSession('applied', 'completed')).toBe(true)
    expect(canTransitionReviewSession('completed', 'processing')).toBe(false)
    expect(canTransitionReviewSession('generation_failed', 'exported')).toBe(true)
  })

  it('uses distinct, explicit PDF behavior for quick, standard and mock modes', () => {
    expect(defaultReviewSessionSettings('quick', 2)).toMatchObject({
      maxDurationSeconds: 360, includeAnswerSheet: false, showSourceLabels: true,
    })
    expect(defaultReviewSessionSettings('standard', 2)).toMatchObject({
      maxDurationSeconds: 840, includeAnswerSheet: false, showSourceLabels: true,
    })
    expect(defaultReviewSessionSettings('mock_test', 2)).toMatchObject({
      maxDurationSeconds: 1200, includeAnswerSheet: true, showSourceLabels: false,
    })
  })

  it('caps the generated Today plan by both module count and time budget', () => {
    const candidates = [
      candidate('budget-a', { tags: [tag('knowledge', '函数'), tag('method', '待定系数法')] }),
      candidate('budget-b', { tags: [tag('knowledge', '全等'), tag('method', '倍长中线')] }),
      candidate('budget-c', { tags: [tag('knowledge', '圆'), tag('method', '辅助线')] }),
    ]
    expect(buildTodayReviewUnits(candidates, { now, maxModules: 1, maxDurationSeconds: 3_600 })).toHaveLength(1)
    expect(buildTodayReviewUnits(candidates, { now, maxModules: 3, maxDurationSeconds: 500 })).toHaveLength(1)
  })
})

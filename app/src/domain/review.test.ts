import { describe, expect, it } from 'vitest'
import {
  applyReviewRating,
  applyWeightedReviewRating,
  addLocalReviewDays,
  buildTodayReviewUnits,
  candidateDueAt,
  candidateRetention,
  canTransitionReviewSession,
  defaultReviewSessionSettings,
  effectiveSkillRetention,
  estimateReviewProblemSeconds,
  initialReviewSkillState,
  localReviewDate,
  reviewDueAt,
  reviewRetrievability,
  reviewSimilarity,
  reviewTagEvidenceWeight,
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
    ], { now })
    // 不再限制主题数量：所有到期主题都会进入今日计划，且键互不相同
    expect(new Set(units.map((unit) => unit.canonicalKey)).size).toBe(units.length)
    expect(units.length).toBeGreaterThanOrEqual(2)
  })
})

describe('Horizon review scheduler', () => {
  it('uses a monotonic exponential curve and crosses the configured target', () => {
    const state = { ...initialReviewSkillState(), stability: 8, lastPracticedAt: now, nextReviewAt: null }
    const dueAt = reviewDueAt(state, .85)!
    expect(reviewRetrievability(state, now)).toBe(1)
    expect(reviewRetrievability(state, now + 2 * 86_400_000)).toBeLessThan(1)
    expect(reviewRetrievability(state, now + 4 * 86_400_000))
      .toBeLessThan(reviewRetrievability(state, now + 2 * 86_400_000))
    expect(reviewRetrievability(state, dueAt)).toBeCloseTo(.85, 5)
    expect(reviewDueAt(state, .9)).toBeLessThan(dueAt)
    expect(initialReviewSkillState(.5).stability).toBe(initialReviewSkillState(.85).stability)
  })

  it('combines bundle retention as weakest 60% and weighted average 40%', () => {
    const strong = { ...initialReviewSkillState(), stability: 20, lastPracticedAt: now }
    const weak = { ...initialReviewSkillState(), stability: 2, lastPracticedAt: now }
    const at = now + 86_400_000
    const combined = effectiveSkillRetention([
      { state: strong, weight: 1 }, { state: weak, weight: .75 },
    ], at)
    expect(combined).toBeLessThan(reviewRetrievability(strong, at))
    expect(combined).toBeGreaterThanOrEqual(reviewRetrievability(weak, at))
    expect(reviewTagEvidenceWeight(tag('knowledge', '函数'))).toBe(1)
    expect(reviewTagEvidenceWeight(tag('method', '数形结合'))).toBe(.85)
    expect(reviewTagEvidenceWeight(tag('model', '函数模型'))).toBe(.75)
  })

  it('uses the same bundle curve for due time and live retention', () => {
    const knowledge = tag('knowledge', '函数')
    const method = tag('method', '数形结合')
    const base = { ...initialReviewSkillState(), lastPracticedAt: now }
    const item = candidate('bundle', {
      tags: [knowledge, method],
      skillStates: {
        [knowledge.id!]: { ...base, stability: 8 },
        [method.id!]: { ...base, stability: 3 },
      },
    })
    const due = candidateDueAt(item, now, .85)
    expect(candidateRetention(item, due)).toBeCloseTo(.85, 5)
  })

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
    expect(localReviewDate(new Date(2026, 7, 10, 23, 59, 59).getTime())).toBe('2026-08-10')
    expect(localReviewDate(new Date(2026, 7, 11, 0, 0, 1).getTime())).toBe('2026-08-11')
  })

  it('advances local review dates across a daylight-saving boundary', () => {
    const runtime = globalThis as typeof globalThis & { process: { env: Record<string, string | undefined> } }
    const original = runtime.process.env.TZ
    runtime.process.env.TZ = 'America/New_York'
    try {
      const before = new Date(2026, 2, 8, 0).getTime()
      const after = addLocalReviewDays(before, 1)
      expect(localReviewDate(after)).toBe('2026-03-09')
      expect(new Date(after).getHours()).toBe(0)
      expect(after - before).toBe(23 * 60 * 60 * 1000)
    } finally { runtime.process.env.TZ = original }
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

  it('estimates review time from difficulty, method/model tags and geometry', () => {
    expect(estimateReviewProblemSeconds({ difficulty: 'basic', tags: [], diagramImagePaths: [] })).toBe(4 * 60)
    expect(estimateReviewProblemSeconds({
      difficulty: 'intermediate', tags: [tag('method', '换元'), tag('model', '函数模型')], diagramImagePaths: [],
    })).toBe(9 * 60)
    expect(estimateReviewProblemSeconds({
      difficulty: 'advanced', tags: [tag('method', 'a'), tag('method', 'b'), tag('model', 'c'), tag('model', 'd')],
      diagramImagePaths: ['/diagram.svg'],
    })).toBe(15 * 60)
  })

  it('schedules every due theme without an artificial module cap', () => {
    const candidates = [
      candidate('budget-a', { tags: [tag('knowledge', '函数'), tag('method', '待定系数法')] }),
      candidate('budget-b', { tags: [tag('knowledge', '全等'), tag('method', '倍长中线')] }),
      candidate('budget-c', { tags: [tag('knowledge', '圆'), tag('method', '辅助线')] }),
    ]
    expect(buildTodayReviewUnits(candidates, {
      now, maxModules: 3, maxDailyMinutes: 30,
    })).toHaveLength(3)
  })

  it('shows only due content and honors a zero Planner review allocation', () => {
    const state = applyReviewRating(null, 'easy', 'intermediate', now)
    const future = candidate('future', { skillStates: { 'knowledge-一元二次方程': state } })
    expect(buildTodayReviewUnits([future], { now, maxModules: 12, maxDailyMinutes: 90 })).toHaveLength(0)
    expect(buildTodayReviewUnits([candidate('due')], { now, maxDailyMinutes: 0 })).toHaveLength(0)
  })

  it('moves an uncaptured mistake monotonically as the 50/70/85 threshold changes', () => {
    const fresh = candidate('threshold', { createdAt: now, mistakeCapturedAt: now })
    const saving = candidateDueAt(fresh, now, .5)
    const balanced = candidateDueAt(fresh, now, .7)
    const intensive = candidateDueAt(fresh, now, .85)
    expect(intensive).toBeLessThan(balanced)
    expect(balanced).toBeLessThan(saving)
    expect(balanced - now).not.toBe(86_400_000)
  })

  it('uses either the primary knowledge or bundle curve but not a secondary tag as the due gate', () => {
    const primary = tag('knowledge', '函数', 'primary')
    const secondary = tag('method', '数形结合', 'secondary')
    const recent = { ...initialReviewSkillState(), stability: 30, lastPracticedAt: now }
    const overdue = { ...initialReviewSkillState(), stability: 1, lastPracticedAt: now - 3 * 86_400_000 }
    const base = candidate('gates', {
      tags: [primary, secondary],
      skillStates: { [primary.id!]: recent, [secondary.id!]: overdue },
      bundleState: recent,
    })
    expect(candidateDueAt(base, now, .7)).toBeGreaterThan(now)
    expect(candidateDueAt({ ...base, bundleState: overdue }, now, .7)).toBeLessThan(now)
  })
})

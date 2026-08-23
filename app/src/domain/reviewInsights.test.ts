import { describe, expect, it } from 'vitest'
import { initialReviewSkillState, type ReviewTag } from './review'
import { buildReviewInsights, type InsightRangeDays, type ReviewInsightRecord } from './reviewInsights'

const now = new Date(2026, 8, 2, 10).getTime()
const tag = (type: ReviewTag['type'], name: string): ReviewTag => ({ id: `${type}-${name}`, name, type, role: 'primary' })
const record = (id: string, date: string, rating: ReviewInsightRecord['rating'] = 'good', overrides: Partial<ReviewInsightRecord> = {}): ReviewInsightRecord => ({
  moduleId: id, subject: '数学', sessionDate: date, status: 'completed', completedAt: now,
  sourceProblemId: id, rating, sourceMode: 'original', difficulty: 'intermediate',
  tags: [tag('knowledge', '函数'), tag('method', '数形结合'), tag('model', '图像交点')],
  errorCategories: [tag('error', '漏条件')], ...overrides,
})
const build = (records: ReviewInsightRecord[], rangeDays: InsightRangeDays = 7) => buildReviewInsights({ records, rangeDays, now, changes: [], skills: [] })

describe('review insights', () => {
  it('renders a complete zero-data range', () => {
    const result = build([])
    expect(result.trend).toHaveLength(7)
    expect(result.overview.completionRate).toBeNull()
  })

  it('aggregates one day, all four ratings, deferred and completion', () => {
    const items = [record('a', '2026-09-02', 'again'), record('b', '2026-09-02', 'hard'), record('c', '2026-09-02', 'good'), record('d', '2026-09-02', 'easy'), record('e', '2026-09-02', null, { status: 'deferred' })]
    const result = build(items)
    expect(result.overview).toMatchObject({ completedUnits: 4, completedProblems: 4, deferredUnits: 1, completionRate: .8 })
    expect(result.ratings).toEqual({ again: 1, hard: 1, good: 1, easy: 1 })
  })

  it('supports 7 and 30 local days across a month boundary', () => {
    const items = [record('aug', '2026-08-31'), record('sep', '2026-09-02')]
    expect(build(items, 7).overview.completedUnits).toBe(2)
    expect(build(items, 30).trend).toHaveLength(30)
  })

  it('aggregates snapshot knowledge, method, model and errors with long names', () => {
    const long = '这是一个很长但仍应完整保留并在界面换行的解题方法标签'
    const result = build([record('a', '2026-09-02', 'again', { tags: [tag('knowledge', '函数'), tag('method', long), tag('model', '参数模型')] }), record('b', '2026-09-02', 'good'), record('c', '2026-09-02', 'good')])
    expect(result.themes.map((item) => item.type)).toEqual(expect.arrayContaining(['knowledge', 'method', 'model']))
    expect(result.themes.some((item) => item.name === long)).toBe(true)
    expect(result.recurringErrors[0]).toMatchObject({ name: '漏条件', count: 3, difficultCount: 1 })
  })

  it('uses historical snapshots even when a problem is soft deleted or current tags change', () => {
    const historical = record('deleted-problem', '2026-09-01', 'good', { tags: [tag('knowledge', '历史名称')] })
    expect(build([historical]).themes[0].name).toBe('历史名称')
  })

  it('groups current mastery without inventing historical trends', () => {
    const base = initialReviewSkillState()
    const result = buildReviewInsights({ records: [], rangeDays: 7, now, changes: [], skills: [
      { subject: '数学', tagId: 'stable', name: '稳定', type: 'knowledge', state: { ...base, evidenceCount: 3, masteryEstimate: .8, retrievability: .8, uncertainty: .4 } },
      { subject: '数学', tagId: 'working', name: '巩固', type: 'method', state: { ...base, evidenceCount: 3, masteryEstimate: .6, retrievability: .6 } },
      { subject: '数学', tagId: 'attention', name: '关注', type: 'model', state: { ...base, evidenceCount: 3, masteryEstimate: .3 } },
      { subject: '数学', tagId: 'new', name: '新证据', type: 'knowledge', state: { ...base, evidenceCount: 1, masteryEstimate: .1 } },
    ] })
    expect(result.mastery.stable).toHaveLength(1)
    expect(result.mastery.consolidating).toHaveLength(1)
    expect(result.mastery.attention).toHaveLength(1)
    expect(result.mastery.insufficient).toHaveLength(1)
    expect(result.trend.every((day) => day.masteryDelta === null)).toBe(true)
  })

  it('shows evidence-backed re-error, stability, transfer and original/variant splits', () => {
    const base = initialReviewSkillState()
    const skill = {
      subject: '数学', tagId: 'knowledge-函数', name: '函数', type: 'knowledge' as const,
      state: {
        ...base,
        evidenceCount: 5,
        successCount: 3,
        failureCount: 2,
        stability: 8,
        transferScore: .64,
        maxStableDifficulty: 'intermediate' as const,
      },
    }
    const result = buildReviewInsights({
      records: [
        record('original-good', '2026-09-02', 'good'),
        record('variant-hard', '2026-09-02', 'hard', { sourceMode: 'variant' }),
        record('variant-good', '2026-09-02', 'good', { sourceMode: 'variant' }),
      ],
      rangeDays: 7, now, changes: [], skills: [skill],
    })
    expect(result.skillDetails[0]).toMatchObject({
      conclusionEligible: true,
      reerrorRate: .4,
      original: { attempts: 1, successRate: 1 },
      variant: { attempts: 2, difficultAttempts: 1, successRate: .5 },
    })
    expect(result.skillDetails[0].state).toMatchObject({
      stability: 8, transferScore: .64, maxStableDifficulty: 'intermediate',
    })
  })

  it('isolates mastery and trends by subject', () => {
    const base = { ...initialReviewSkillState(), evidenceCount: 3 }
    const result = buildReviewInsights({
      records: [record('math', '2026-09-02'), record('physics', '2026-09-02', 'again', { subject: '物理' })],
      rangeDays: 7, now, changes: [], subject: '数学',
      skills: [
        { subject: '数学', tagId: 'math', name: '函数', type: 'knowledge', state: base },
        { subject: '物理', tagId: 'physics', name: '受力', type: 'knowledge', state: base },
      ],
    })
    expect(result.subjects).toEqual(['数学', '物理'])
    expect(result.overview.completedUnits).toBe(1)
    expect(Object.values(result.mastery).flat().map((skill) => skill.subject)).toEqual(['数学'])
  })

  it('isolates future-due skills from overdue skills in overview counts', () => {
    const base = initialReviewSkillState()
    const today = new Date(2026, 8, 2).getTime()
    const result = buildReviewInsights({
      records: [], rangeDays: 7, now: today, changes: [],
      skills: [
        { subject: '数学', tagId: 'overdue', name: '已逾期', type: 'knowledge', state: { ...base, nextReviewAt: today - 86_400_000 } },
        { subject: '数学', tagId: 'future', name: '未来到期', type: 'knowledge', state: { ...base, nextReviewAt: today + 3 * 86_400_000 } },
        { subject: '数学', tagId: 'distant', name: '远期', type: 'knowledge', state: { ...base, nextReviewAt: today + 15 * 86_400_000 } },
      ],
    })
    expect(result.overview.overdueSkills).toBe(1)
    expect(result.overview.futureDueSkills).toBe(1)
  })

  it('aggregates thousands of historical snapshots without per-record queries', () => {
    const records = Array.from({ length: 3_000 }, (_, index) => record(
      `history-${index}`, index % 2 ? '2026-09-01' : '2026-09-02', index % 4 === 0 ? 'again' : 'good',
    ))
    const result = build(records, 30)
    expect(result.overview.completedUnits).toBe(3_000)
    expect(result.themes.find((item) => item.name === '函数')?.count).toBe(3_000)
    expect(result.recurringErrors[0].count).toBe(3_000)
  })
})

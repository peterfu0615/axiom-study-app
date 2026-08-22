import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))

import { getReviewInsights } from './insightsDatabase'

describe('insights evidence query', () => {
  it('keeps original/variant mode and persisted stability dimensions', async () => {
    const now = new Date(2026, 7, 21, 10).getTime()
    mocks.invoke.mockImplementation(async (_command: string, args: { sql: string }) => {
      if (args.sql.includes('FROM review_modules module')) return [{
        module_id: 'module-1', subject: '数学', session_date: '2026-08-21', status: 'completed',
        completed_at: now, source_problem_id: 'problem-1', source_mode: 'variant', difficulty: 'advanced',
        rating: 'good', target_tags_json: JSON.stringify({ tags: [{ id: 'tag-1', name: '函数', type: 'knowledge', role: 'primary' }], errorCategories: [] }),
      }]
      if (args.sql.includes('FROM skill_states state')) return [{
        subject: '数学', tag_id: 'tag-1', canonical_name: '函数', tag_type: 'knowledge',
        mastery_estimate: .8, stability: 12, retrievability: .82, evidence_count: 4,
        success_count: 3, failure_count: 1, transfer_score: .7,
        max_stable_difficulty: 'advanced', last_practiced_at: now, next_review_at: now + 86_400_000,
        uncertainty: .2,
      }]
      if (args.sql.includes('FROM horizon_review_logs log')) return []
      throw new Error(`unexpected query: ${args.sql.slice(0, 80)}`)
    })
    const result = await getReviewInsights(7, now, '数学')
    expect(result.skillDetails[0]).toMatchObject({
      reerrorRate: .25,
      original: { attempts: 0 },
      variant: { attempts: 1, successRate: 1 },
      state: { stability: 12, transferScore: .7, maxStableDifficulty: 'advanced' },
    })
    const recordQuery = mocks.invoke.mock.calls.find(([, args]) => String(args.sql).includes('FROM review_modules module'))?.[1].sql
    // The physical column is source_type; it must be aliased to source_mode.
    expect(recordQuery).toContain('instance.source_type AS source_mode')
    expect(recordQuery).not.toMatch(/instance\.source_mode(?!\s*AS)/u)
    expect(recordQuery).toContain('instance.difficulty')
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({ invoke }))

import { migrateReviewSchedulerState } from './reviewSchedulerMigration'

describe('review scheduler state migration', () => {
  beforeEach(() => invoke.mockReset())

  it('is idempotent when every state is already v3', async () => {
    invoke.mockImplementation(async (command: string, payload?: { sql: string }) => {
      if (!payload) return []
      if (command === 'db_select' && payload.sql.includes('review_preferences')) return [{
        max_daily_minutes: 25, max_modules: 2, preferred_mode: 'standard',
        target_retention: .7, variant_mode: 'variant_preferred',
      }]
      if (command === 'db_select') return []
      throw new Error(`unexpected write: ${payload.sql}`)
    })
    await expect(migrateReviewSchedulerState()).resolves.toBe(0)
    expect(invoke.mock.calls.every(([command]) => command === 'db_select')).toBe(true)
  })

  it('preserves v2 stability while auditing the v3 due-time conversion', async () => {
    const writes: Array<{ sql: string; params: unknown[] }> = []
    invoke.mockImplementation(async (command: string, payload?: { sql: string; params?: unknown[] }) => {
      if (!payload) return []
      if (command === 'db_select' && payload.sql.includes('review_preferences')) return [{
        max_daily_minutes: 25, max_modules: 2, preferred_mode: 'standard',
        target_retention: .7, variant_mode: 'variant_preferred',
      }]
      if (command === 'db_select' && payload.sql.includes('FROM skill_states')) return [{
        subject: '数学', entity_id: 'tag', mastery_estimate: .6, stability: 8,
        retrievability: .8, evidence_count: 2, success_count: 2, failure_count: 0,
        transfer_score: .2, max_stable_difficulty: 'intermediate',
        last_practiced_at: 1_000, next_review_at: 2_000, uncertainty: .4,
        scheduler_version: 'ebbinghaus-v2',
      }]
      if (command === 'db_select') return []
      writes.push({ sql: payload.sql, params: payload.params ?? [] })
      return { rowsAffected: 1, lastInsertId: 0 }
    })
    await expect(migrateReviewSchedulerState(10_000)).resolves.toBe(1)
    const update = writes.find((entry) => entry.sql.includes('UPDATE skill_states'))
    expect(update?.params[0]).toBe(8)
    expect(update?.params[3]).toBe('ebbinghaus-v3')
    expect(writes.some((entry) => entry.sql.includes('review_scheduler_migrations')
      && entry.params.includes('ebbinghaus-v2') && entry.params.includes('ebbinghaus-v3'))).toBe(true)
  })

  it('rolls back the whole conversion when one state update fails', async () => {
    const writes: string[] = []
    invoke.mockImplementation(async (command: string, payload?: { sql: string }) => {
      if (!payload) return []
      if (command === 'db_select' && payload.sql.includes('review_preferences')) return [{
        max_daily_minutes: 25, max_modules: 2, preferred_mode: 'standard',
        target_retention: .7, variant_mode: 'variant_preferred',
      }]
      if (command === 'db_select' && payload.sql.includes('FROM skill_states')) return [{
        subject: '数学', entity_id: 'tag', mastery_estimate: .6, stability: 2,
        retrievability: .7, evidence_count: 2, success_count: 1, failure_count: 1,
        transfer_score: 0, max_stable_difficulty: 'intermediate',
        last_practiced_at: 1_000, next_review_at: 86_401_000, uncertainty: .5,
        scheduler_version: 'horizon-v1',
      }]
      if (command === 'db_select') return []
      writes.push(payload.sql.trim())
      if (payload.sql.includes('UPDATE skill_states')) throw new Error('simulated conversion failure')
      return { rowsAffected: 0, lastInsertId: 0 }
    })
    await expect(migrateReviewSchedulerState(2_000)).rejects.toThrow('simulated conversion failure')
    expect(writes[0]).toBe('BEGIN IMMEDIATE')
    expect(writes.at(-1)).toBe('ROLLBACK')
    expect(writes.some((sql) => sql.includes('review_scheduler_migrations'))).toBe(false)
  })
})

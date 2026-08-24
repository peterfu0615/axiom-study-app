import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({ invoke }))

import { migrateReviewSchedulerState } from './reviewSchedulerMigration'

describe('review scheduler state migration', () => {
  beforeEach(() => invoke.mockReset())

  it('is idempotent when every state is already v2', async () => {
    invoke.mockImplementation(async (command: string, payload?: { sql: string }) => {
      if (!payload) return []
      if (command === 'db_select' && payload.sql.includes('review_preferences')) return [{
        max_daily_minutes: 25, max_modules: 2, preferred_mode: 'standard',
        target_retention: .85, variant_mode: 'variant_preferred',
      }]
      if (command === 'db_select') return []
      throw new Error(`unexpected write: ${payload.sql}`)
    })
    await expect(migrateReviewSchedulerState()).resolves.toBe(0)
    expect(invoke.mock.calls.every(([command]) => command === 'db_select')).toBe(true)
  })

  it('rolls back the whole conversion when one state update fails', async () => {
    const writes: string[] = []
    invoke.mockImplementation(async (command: string, payload?: { sql: string }) => {
      if (!payload) return []
      if (command === 'db_select' && payload.sql.includes('review_preferences')) return [{
        max_daily_minutes: 25, max_modules: 2, preferred_mode: 'standard',
        target_retention: .85, variant_mode: 'variant_preferred',
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

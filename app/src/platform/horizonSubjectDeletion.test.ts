import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({ invoke }))

import { archiveSubject, getSubjectDeletionImpact } from './horizonDatabase'

describe('subject deletion lifecycle', () => {
  beforeEach(() => invoke.mockReset())

  it('reports empty and populated subject impact without changing data', async () => {
    invoke.mockResolvedValueOnce([{ textbook_count: 2, problem_count: 3, skill_state_count: 4, review_attempt_count: 5 }])
    await expect(getSubjectDeletionImpact('数学')).resolves.toEqual({
      textbookCount: 2, problemCount: 3, skillStateCount: 4, reviewAttemptCount: 5,
    })
    expect(invoke).toHaveBeenCalledWith('db_select', expect.objectContaining({ params: ['数学'] }))
  })

  it('archives current relations, removes mutable skill state, and preserves review history', async () => {
    const sql: string[] = []
    invoke.mockImplementation(async (_command, payload?: { sql: string }) => {
      if (!payload) return null
      sql.push(payload.sql)
      return { rowsAffected: payload.sql.includes('UPDATE subjects') ? 1 : 0, lastInsertId: 0 }
    })
    await expect(archiveSubject('math')).resolves.toBe(true)
    const combined = sql.join('\n')
    expect(combined).toContain('UPDATE textbooks')
    expect(combined).toContain('UPDATE knowledge_nodes')
    expect(combined).toContain('UPDATE tag_definitions')
    expect(combined).toContain('UPDATE problems')
    expect(combined).toContain('DELETE FROM skill_states')
    expect(combined).toContain('DELETE FROM skill_bundle_states')
    expect(combined).not.toContain('DELETE FROM review_attempts')
    expect(combined).not.toContain('DELETE FROM horizon_review_logs')
    expect(sql.at(0)).toContain('BEGIN IMMEDIATE')
    expect(sql.at(-1)).toBe('COMMIT')
  })

  it('is idempotent when a subject is missing or already archived', async () => {
    invoke.mockImplementation(async (_command, payload?: { sql: string }) => payload ? ({
      rowsAffected: 0,
      lastInsertId: 0,
    }) : null)
    await expect(archiveSubject('missing')).resolves.toBe(false)
  })
})

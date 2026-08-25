import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({ invoke }))

import { claimPracticePreparation, getActivePracticePreparation } from './practicePreparationDatabase'

const job = {
  id: 'job-1', source_type: 'today', source_ref: 'plan-1', session_mode: 'standard',
  status: 'selecting', total_slots: 2, practice_set_id: null, safe_error_code: null,
  error_message: null, updated_at: 10,
}

describe('persistent practice preparation jobs', () => {
  beforeEach(() => invoke.mockReset())

  it('restores the active job and its per-topic slots', async () => {
    invoke.mockResolvedValueOnce([job]).mockResolvedValueOnce([
      { id: 'slot-1', order_index: 0, source_ref: 'module-1', status: 'selecting', source_problem_id: null, variant_plan_id: null, safe_error_code: null },
      { id: 'slot-2', order_index: 1, source_ref: 'module-2', status: 'selecting', source_problem_id: null, variant_plan_id: null, safe_error_code: null },
    ])
    await expect(getActivePracticePreparation('today', 'plan-1', 'standard')).resolves.toMatchObject({
      id: 'job-1', totalSlots: 2, slots: [{ orderIndex: 0 }, { orderIndex: 1 }],
    })
  })

  it('uses compare-and-swap so duplicate resumptions cannot both generate', async () => {
    invoke.mockResolvedValueOnce({ rowsAffected: 0, lastInsertId: 0 })
    await expect(claimPracticePreparation('job-1', 10)).resolves.toBeNull()
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenCalledWith('db_execute', expect.objectContaining({
      sql: expect.stringContaining('updated_at=$3'), params: [expect.any(Number), 'job-1', 10],
    }))
  })
})

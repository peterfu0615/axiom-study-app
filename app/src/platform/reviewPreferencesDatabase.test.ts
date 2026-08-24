import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({ invoke }))

import { getReviewPreferences, saveReviewPreferences } from './reviewPreferencesDatabase'

describe('review preferences persistence', () => {
  beforeEach(() => invoke.mockReset())

  it('reads the durable Today scheduling inputs', async () => {
    invoke.mockResolvedValue([{ max_daily_minutes: 40, max_modules: 4, preferred_mode: 'quick', target_retention: .9, variant_mode: 'original_only' }])
    await expect(getReviewPreferences()).resolves.toEqual({ maxDailyMinutes: 40, maxModules: 4, preferredMode: 'quick', targetRetention: .9, variantMode: 'original_only' })
  })

  it('normalizes unsafe values before saving', async () => {
    invoke.mockResolvedValue({ rowsAffected: 1, lastInsertId: 0 })
    await expect(saveReviewPreferences({ maxDailyMinutes: 999, maxModules: 0, preferredMode: 'mock_test', targetRetention: 1, variantMode: 'variant_preferred' }))
      .resolves.toEqual({ maxDailyMinutes: 180, maxModules: 1, preferredMode: 'mock_test', targetRetention: .95, variantMode: 'variant_preferred' })
    expect(invoke).toHaveBeenCalledWith('db_execute', expect.objectContaining({ params: [180, 1, 'mock_test', .95, 'variant_preferred', expect.any(Number)] }))
  })
})

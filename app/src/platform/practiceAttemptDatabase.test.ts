import { describe, expect, it } from 'vitest'
import { groupScanLayouts } from './practiceAttemptDatabase'

describe('groupScanLayouts', () => {
  it('binds independent answer crops to their machine-readable page', () => {
    const base = { attempt_id: 'attempt-1', page_id: 'page-1', page_identity: 'identity-1', qr_payload: 'AXIOM|page=0', width_points: 595.28, height_points: 841.89 }
    const layouts = groupScanLayouts([
      { ...base, region_id: 'r-1', practice_item_id: 'item-1', region_index: 0, x: .1, y: .2, width: .8, height: .1 },
      { ...base, region_id: 'r-2', practice_item_id: 'item-2', region_index: 0, x: .1, y: .4, width: .8, height: .1 },
    ])
    expect(layouts).toHaveLength(1)
    expect(layouts[0].regions.map((region) => region.practiceItemId)).toEqual(['item-1', 'item-2'])
  })
})

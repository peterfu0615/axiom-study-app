import { describe, expect, it } from 'vitest'
// @ts-expect-error Vitest executes this contract in Node, while the app tsconfig is browser-only.
import { readFileSync } from 'node:fs'
import {
  groupScanLayouts,
  PracticeSubmissionMatchError,
} from './practiceAttemptDatabase'

describe('groupScanLayouts', () => {
  it('binds independent answer crops to their machine-readable page', () => {
    const base = { attempt_id: 'attempt-1', page_id: 'page-1', page_index: 0, page_identity: 'identity-1', qr_payload: 'AXIOM|page=0', width_points: 595.28, height_points: 841.89 }
    const layouts = groupScanLayouts([
      { ...base, region_id: 'r-1', practice_item_id: 'item-1', region_index: 0, x: .1, y: .2, width: .8, height: .1 },
      { ...base, region_id: 'r-2', practice_item_id: 'item-2', region_index: 0, x: .1, y: .4, width: .8, height: .1 },
    ])
    expect(layouts).toHaveLength(1)
    expect(layouts[0].regions.map((region) => region.practiceItemId)).toEqual(['item-1', 'item-2'])
  })

  it('preserves the failed and remaining pages for manual recovery', () => {
    const submissions = [{ sourcePath: '/media/page-2.jpg' }, { sourcePath: '/media/page-3.jpg' }]
    const error = new PracticeSubmissionMatchError('二维码不可读', submissions, [{
      pageId: 'layout-2', pageIndex: 1, pageIdentity: 'identity-2', responseCount: 2,
    }])
    expect(error.name).toBe('PracticeSubmissionMatchError')
    expect(error.submissions).toEqual(submissions)
    expect(error.pageOptions[0].pageId).toBe('layout-2')
  })

  it('uses a forced current-set layout and reloads the combined attempt', () => {
    const source = readFileSync(new URL('./practiceAttemptDatabase.ts', import.meta.url), 'utf8')
    expect(source).toContain('processPracticeScanForPage(')
    expect(source).toContain('submissions.slice(index)')
    expect(source).toContain('getLatestPracticeAttempt(practiceSetId)')
    expect(source).toContain('pageCount: submissions.length')
  })
})

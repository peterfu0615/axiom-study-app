// @ts-expect-error Vitest executes this contract in Node, while the app tsconfig is browser-only.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const reviewSource = readFileSync(new URL('./ReviewCenter.tsx', import.meta.url), 'utf8')
const tagSource = readFileSync(new URL('./TagOverview.tsx', import.meta.url), 'utf8')
const workspaceSource = readFileSync(new URL('./CurriculumWorkspace.tsx', import.meta.url), 'utf8')
const fixtureSource = readFileSync(new URL('./curriculumPreviewFixture.ts', import.meta.url), 'utf8')

describe('curriculum review center contract', () => {
  it('keeps the review workflow outside TagOverview', () => {
    expect(tagSource).not.toContain('curriculum-review-queue')
    expect(tagSource).not.toContain('bulkReviewTagScope')
    expect(reviewSource).toContain('一键批准')
    expect(reviewSource).toContain('一键驳回')
    expect(reviewSource).toContain('mappingItem')
  })

  it('exposes review as a third course-level view', () => {
    expect(workspaceSource).toMatch(/type CourseView = 'structure' \| 'tags' \| 'review'/u)
    expect(workspaceSource).toContain("label: '审核确认'")
    expect(workspaceSource).toContain('<ReviewCenter')
  })

  it('includes the named review and structure preview states', () => {
    for (const state of [
      'review-empty', 'review-many', 'review-filtered',
      'review-bulk-approve-confirm', 'review-bulk-reject-confirm',
      'review-row-loading', 'review-unmapped',
      'structure-long-tree', 'structure-long-detail', 'structure-820x620',
    ]) {
      expect(fixtureSource).toContain(state)
    }
  })
})

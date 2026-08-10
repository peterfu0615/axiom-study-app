import { describe, expect, it } from 'vitest'
import type { TagDefinitionSummary, TagReviewItem } from '../../platform/horizonDatabase'
import { selectBulkReviewScope } from './bulkReviewScope'

const definition = (overrides: Partial<TagDefinitionSummary>): TagDefinitionSummary => ({
  id: overrides.id ?? 'definition', subject: '数学', tagType: 'method', canonicalName: '方法', aliases: [],
  description: null, parentId: null, knowledgeNodeId: null, textbookId: null,
  source: 'ai_inferred', taxonomyVersion: 1, verificationStatus: 'needs_review',
  lifecycleStatus: 'candidate', methodClass: null, mergedIntoId: null, archivedAt: null,
  createdAt: 0, updatedAt: 0, problemCount: 0, ...overrides,
})

const review = (overrides: Partial<TagReviewItem>): TagReviewItem => ({
  id: overrides.id ?? 'problem-tag', problemId: 'problem', tagId: null, candidateName: '候选',
  evidence: '题干依据', mappingStatus: 'candidate', verificationStatus: 'needs_review',
  isLocked: false, ...overrides,
})

describe('selectBulkReviewScope', () => {
  it('limits definitions and problem tags to the active search/filter scope', () => {
    const scope = selectBulkReviewScope(
      [definition({ id: 'keep', canonicalName: '等价变形' }), definition({ id: 'hide', canonicalName: '分类讨论', lifecycleStatus: 'active', verificationStatus: 'user_verified' })],
      [review({ id: 'mapped', candidateName: '等价变形', mappingStatus: 'mapped', tagId: 'tag-1' }), review({ id: 'other', candidateName: '分类讨论' })],
      '等价',
      'review',
    )
    expect(scope.definitionIds).toEqual(['keep'])
    expect(scope.approveProblemTagIds).toEqual(['mapped'])
    expect(scope.rejectProblemTagIds).toEqual(['mapped'])
    expect(scope.unmappedReviewCount).toBe(0)
  })

  it('never includes unmapped or locked rows in approve IDs', () => {
    const scope = selectBulkReviewScope(
      [definition({ id: 'def' })],
      [review({ id: 'unmapped' }), review({ id: 'locked', isLocked: true, mappingStatus: 'mapped', tagId: 'tag-2' })],
      '',
      'all',
    )
    expect(scope.approveProblemTagIds).toEqual([])
    expect(scope.rejectProblemTagIds).toEqual(['unmapped'])
    expect(scope.unmappedReviewCount).toBe(1)
  })

  it('keeps project filters and rejected rows out of bulk decisions', () => {
    const scope = selectBulkReviewScope(
      [definition({ id: 'definition' })],
      [
        review({ id: 'mapped', mappingStatus: 'mapped', tagId: 'tag-1' }),
        review({ id: 'unmapped', candidateName: '未映射', mappingStatus: 'candidate' }),
        review({ id: 'rejected', mappingStatus: 'mapped', tagId: 'tag-2', verificationStatus: 'rejected' }),
      ],
      '',
      'review',
      'mapping',
    )
    expect(scope.definitionIds).toEqual([])
    expect(scope.approveProblemTagIds).toEqual(['mapped'])
    expect(scope.rejectProblemTagIds).toEqual(['mapped'])
    expect(scope.filteredReviewItems.map((item) => item.id)).toEqual(['mapped', 'rejected'])
  })
})

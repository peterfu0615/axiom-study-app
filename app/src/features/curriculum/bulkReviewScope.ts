import type { TagDefinitionSummary, TagReviewItem } from '../../platform/horizonDatabase'

export type BulkReviewStatusFilter = 'all' | 'review' | 'active' | 'archived'

export function selectBulkReviewScope(
  definitions: TagDefinitionSummary[],
  reviewItems: TagReviewItem[],
  query: string,
  statusFilter: BulkReviewStatusFilter,
) {
  const needle = query.trim().toLocaleLowerCase('zh-CN')
  const definitionIds = definitions
    .filter((tag) => (tag.lifecycleStatus === 'candidate' || tag.verificationStatus === 'needs_review') &&
      !['archived', 'merged', 'rejected'].includes(tag.lifecycleStatus) &&
      !['user_verified', 'rejected'].includes(tag.verificationStatus))
    .map((tag) => tag.id)
  const filteredReviewItems = statusFilter === 'all' || statusFilter === 'review'
    ? reviewItems.filter((item) => !needle ||
      item.candidateName.toLocaleLowerCase('zh-CN').includes(needle) ||
      item.evidence.toLocaleLowerCase('zh-CN').includes(needle))
    : []
  const approveProblemTagIds = filteredReviewItems
    .filter((item) => !item.isLocked && item.verificationStatus !== 'user_verified' &&
      item.mappingStatus === 'mapped' && Boolean(item.tagId))
    .map((item) => item.id)
  const rejectProblemTagIds = filteredReviewItems
    .filter((item) => !item.isLocked && item.verificationStatus !== 'user_verified' && item.mappingStatus !== 'rejected')
    .map((item) => item.id)
  return {
    definitionIds,
    filteredReviewItems,
    approveProblemTagIds,
    rejectProblemTagIds,
    unmappedReviewCount: filteredReviewItems.filter((item) => item.mappingStatus !== 'mapped' || !item.tagId).length,
  }
}

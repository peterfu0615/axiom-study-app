import type { ProblemRegion, ProblemRegionType } from './models'

export function changedRegionTypes(
  before: ProblemRegion[],
  after: ProblemRegion[],
): ProblemRegionType[] {
  const snapshot = (regions: ProblemRegion[], type: ProblemRegionType) =>
    regions
      .filter((region) => region.type === type)
      .map((region) => ({
        id: region.id,
        rect: region.rect,
      }))
      .sort((left, right) => left.id.localeCompare(right.id))
  return (['question', 'answer', 'diagram', 'annotation'] as const).filter(
    (type) =>
      JSON.stringify(snapshot(before, type)) !==
      JSON.stringify(snapshot(after, type)),
  )
}


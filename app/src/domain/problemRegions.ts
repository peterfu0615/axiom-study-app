import type { ProblemRegion, ProblemRegionType } from './models'

export function preferredRegions(
  regions: ProblemRegion[],
  type: ProblemRegionType,
) {
  const matching = regions.filter((region) => region.type === type)
  const manual = matching.filter((region) => region.source === 'manual')
  return manual.length ? manual : matching.filter((region) => region.source === 'auto')
}

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
        source: region.source,
      }))
      .sort((left, right) => left.id.localeCompare(right.id))
  return (['question', 'answer', 'diagram', 'annotation'] as const).filter(
    (type) =>
      JSON.stringify(snapshot(before, type)) !==
      JSON.stringify(snapshot(after, type)),
  )
}

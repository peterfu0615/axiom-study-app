import type { ProblemBlock } from './models'

export function allProblemBlockIds(blocks: ProblemBlock[]) {
  return new Set(blocks.map((block) => block.id))
}

export function toggleProblemBlockId(selectedIds: Set<string>, id: string) {
  const next = new Set(selectedIds)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

export function selectProblemBlocks(
  blocks: ProblemBlock[],
  selectedIds: Set<string>,
) {
  return blocks.filter((block) => selectedIds.has(block.id))
}

export function replaceProblemBlockSelection(
  selectedIds: Set<string>,
  removedIds: Set<string>,
  addedIds: string[],
  inheritSelection: boolean,
) {
  const next = new Set(
    [...selectedIds].filter((id) => !removedIds.has(id)),
  )
  if (inheritSelection) {
    for (const id of addedIds) next.add(id)
  }
  return next
}

export function resolveUserOverride(
  userValue: string | null | undefined,
  baseValue: string | null | undefined,
) {
  return userValue === null || userValue === undefined
    ? (baseValue ?? null)
    : userValue
}

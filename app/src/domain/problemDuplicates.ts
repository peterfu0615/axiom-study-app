import type { SavedProblem } from './models'

export interface ProblemDuplicateSuggestion {
  candidate: SavedProblem
  score: number
  signals: string[]
}

function normalizedText(value: string | null | undefined) {
  return (value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    .replace(/[\s\p{P}\p{S}]+/gu, '')
}

function bigrams(value: string) {
  const grams = new Set<string>()
  for (let index = 0; index < value.length - 1; index += 1) {
    grams.add(value.slice(index, index + 2))
  }
  return grams
}

function dice(left: string, right: string) {
  if (!left || !right) return 0
  if (left === right) return 1
  const leftGrams = bigrams(left)
  const rightGrams = bigrams(right)
  if (!leftGrams.size || !rightGrams.size) return 0
  let overlap = 0
  for (const gram of leftGrams) if (rightGrams.has(gram)) overlap += 1
  return (2 * overlap) / (leftGrams.size + rightGrams.size)
}

function tagJaccard(left: SavedProblem, right: SavedProblem) {
  const keys = (problem: SavedProblem) => new Set(problem.libraryMetadata.tags
    .filter((tag) => tag.type !== 'error')
    .map((tag) => `${tag.type}:${tag.id ?? normalizedText(tag.name)}`))
  const leftKeys = keys(left)
  const rightKeys = keys(right)
  if (!leftKeys.size || !rightKeys.size) return 0
  let intersection = 0
  for (const key of leftKeys) if (rightKeys.has(key)) intersection += 1
  return intersection / (leftKeys.size + rightKeys.size - intersection)
}

export function findProblemDuplicateSuggestions(
  problem: SavedProblem,
  candidates: SavedProblem[],
  decidedCandidateIds: ReadonlySet<string> = new Set(),
): ProblemDuplicateSuggestion[] {
  const subject = normalizedText(problem.subject)
  const stem = normalizedText(problem.stemMarkdown || problem.title)
  if (!subject || stem.length < 8) return []
  return candidates.flatMap((candidate) => {
    if (
      candidate.id === problem.id
      || decidedCandidateIds.has(candidate.id)
      || normalizedText(candidate.subject) !== subject
    ) return []
    const candidateStem = normalizedText(candidate.stemMarkdown || candidate.title)
    if (candidateStem.length < 8) return []
    const textScore = dice(stem, candidateStem)
    const tagsScore = tagJaccard(problem, candidate)
    const sameSource = problem.sourceDocumentId === candidate.sourceDocumentId
    const score = stem === candidateStem
      ? 0.98
      : Math.min(1, textScore * 0.78 + tagsScore * 0.17 + (sameSource ? 0.05 : 0))
    if (score < 0.68) return []
    const signals = [
      ...(stem === candidateStem ? ['结构化题干一致'] : textScore >= 0.72 ? ['题干高度相似'] : []),
      ...(tagsScore >= 0.5 ? ['核心标签重合'] : []),
      ...(sameSource ? ['来自同一采集页'] : []),
    ]
    return [{ candidate, score, signals }]
  }).sort((left, right) => right.score - left.score)
}

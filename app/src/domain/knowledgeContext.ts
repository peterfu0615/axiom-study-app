import type { CanonicalKnowledgeCandidate } from './models'

export const KNOWLEDGE_CONTEXT_CANDIDATE_LIMIT = 30
export const KNOWLEDGE_CONTEXT_CHARACTER_LIMIT = 12_000

function normalize(value: string) {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    .replace(/[\s·•,，、。:：;；()（）[\]【】_\-/]+/gu, '')
}

function bigrams(value: string) {
  const chars = Array.from(value)
  if (chars.length < 2) return chars
  return chars.slice(0, -1).map((char, index) => `${char}${chars[index + 1]}`)
}

function lexicalScore(candidate: CanonicalKnowledgeCandidate, query: string) {
  if (!query) return 0
  const names = [candidate.canonicalName, ...candidate.aliases].map(normalize).filter(Boolean)
  let best = 0
  for (const [index, name] of names.entries()) {
    if (query.includes(name)) best = Math.max(best, (index === 0 ? 100 : 90) + name.length)
    const pairs = bigrams(name)
    if (pairs.length) {
      const overlap = pairs.filter((pair) => query.includes(pair)).length / pairs.length
      best = Math.max(best, overlap * (index === 0 ? 50 : 42))
    }
  }
  const chapter = normalize(candidate.chapter ?? '')
  if (chapter && query.includes(chapter)) best += 12
  return best
}

function serializedLength(candidate: CanonicalKnowledgeCandidate) {
  return JSON.stringify(candidate).length
}

export function rankCanonicalKnowledgeCandidates(
  candidates: CanonicalKnowledgeCandidate[],
  problemText: string,
  limit = KNOWLEDGE_CONTEXT_CANDIDATE_LIMIT,
  characterLimit = KNOWLEDGE_CONTEXT_CHARACTER_LIMIT,
) {
  const query = normalize(problemText)
  const ranked = candidates
    .map((candidate) => ({ candidate, score: lexicalScore(candidate, query) }))
    .sort((left, right) =>
      right.score - left.score ||
      left.candidate.hierarchyPath.localeCompare(right.candidate.hierarchyPath, 'zh-CN') ||
      left.candidate.canonicalName.localeCompare(right.candidate.canonicalName, 'zh-CN'))

  const selected: CanonicalKnowledgeCandidate[] = []
  let characters = 2
  for (const { candidate } of ranked) {
    if (selected.length >= limit) break
    const next = serializedLength(candidate) + (selected.length ? 1 : 0)
    if (characters + next > characterLimit) continue
    selected.push(candidate)
    characters += next
  }
  return { candidates: selected, contextCharacterCount: characters }
}

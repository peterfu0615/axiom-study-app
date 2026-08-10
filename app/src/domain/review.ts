import type { DifficultyLevel, HorizonTagRole, HorizonTagType } from './models'

export const REVIEW_SCHEDULER_VERSION = 'horizon-v1'

export type ReviewRating = 'again' | 'hard' | 'good' | 'easy'
export type ReviewUnitStatus = 'pending' | 'completed' | 'deferred'

export interface ReviewTag {
  id: string | null
  name: string
  type: HorizonTagType
  role: HorizonTagRole
}

export interface ReviewSkillState {
  masteryEstimate: number
  stability: number
  retrievability: number
  evidenceCount: number
  successCount: number
  failureCount: number
  transferScore: number
  maxStableDifficulty: DifficultyLevel | null
  lastPracticedAt: number | null
  nextReviewAt: number | null
  uncertainty: number
}

export interface ReviewCandidate {
  problemId: string
  subject: string
  title: string
  stemMarkdown: string
  structuredContentJson: string
  solutionJson: string
  createdAt: number
  difficulty: DifficultyLevel | null
  tags: ReviewTag[]
  skillStates: Record<string, ReviewSkillState>
  lastReviewedAt: number | null
  reviewCount: number
  lastRating: ReviewRating | null
}

export interface ReviewUnitDraft {
  canonicalKey: string
  subject: string
  title: string
  primaryKnowledge: ReviewTag | null
  methods: ReviewTag[]
  models: ReviewTag[]
  errorCategories: ReviewTag[]
  difficulty: DifficultyLevel
  priorityScore: number
  selectionReason: string
  estimatedDurationSeconds: number
  representativeProblems: ReviewCandidate[]
  allProblemIds: string[]
}

export interface ReviewPlanOptions {
  now: number
  maxModules?: number
}

const DAY_MS = 86_400_000
const difficultyRank: Record<DifficultyLevel, number> = {
  basic: 0,
  intermediate: 1,
  advanced: 2,
}

const clamp = (value: number, minimum = 0, maximum = 1) =>
  Math.min(maximum, Math.max(minimum, value))

function uniqueTags(tags: ReviewTag[]) {
  const seen = new Set<string>()
  return tags.filter((tag) => {
    const key = `${tag.type}:${tag.id || tag.name.trim().toLocaleLowerCase('zh-CN')}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function tagsOf(candidate: ReviewCandidate, type: HorizonTagType) {
  return uniqueTags(candidate.tags.filter((tag) => tag.type === type))
}

function tagKeys(candidate: ReviewCandidate, type: HorizonTagType) {
  return new Set(tagsOf(candidate, type).map((tag) => tag.id || `name:${tag.name}`))
}

function overlap(left: Set<string>, right: Set<string>) {
  if (!left.size || !right.size) return 0
  let common = 0
  left.forEach((key) => { if (right.has(key)) common += 1 })
  return common / Math.max(left.size, right.size)
}

export function reviewSimilarity(left: ReviewCandidate, right: ReviewCandidate) {
  if (left.subject.trim().toLocaleLowerCase('zh-CN') !== right.subject.trim().toLocaleLowerCase('zh-CN')) return 0
  const knowledge = overlap(tagKeys(left, 'knowledge'), tagKeys(right, 'knowledge'))
  const method = overlap(tagKeys(left, 'method'), tagKeys(right, 'method'))
  const model = overlap(tagKeys(left, 'model'), tagKeys(right, 'model'))
  const error = overlap(tagKeys(left, 'error'), tagKeys(right, 'error'))
  const difficulty = left.difficulty && right.difficulty
    ? 1 - Math.abs(difficultyRank[left.difficulty] - difficultyRank[right.difficulty]) / 2
    : 0
  return clamp(knowledge * .44 + method * .31 + model * .17 + error * .05 + difficulty * .03)
}

function canCluster(left: ReviewCandidate, right: ReviewCandidate) {
  const sharedKnowledge = overlap(tagKeys(left, 'knowledge'), tagKeys(right, 'knowledge')) > 0
  const sharedMethod = overlap(tagKeys(left, 'method'), tagKeys(right, 'method')) > 0
  const sharedModel = overlap(tagKeys(left, 'model'), tagKeys(right, 'model')) > 0
  // Knowledge alone is not enough: this preserves different solution paths
  // under the same chapter while still collapsing genuinely repeated skills.
  return sharedKnowledge && (sharedMethod || sharedModel) && reviewSimilarity(left, right) >= .52
}

function averageSkillState(candidate: ReviewCandidate) {
  const states = Object.values(candidate.skillStates)
  if (!states.length) return null
  const sum = <K extends keyof ReviewSkillState>(key: K) =>
    states.reduce((total, state) => total + Number(state[key] ?? 0), 0) / states.length
  return {
    mastery: sum('masteryEstimate'),
    retrievability: sum('retrievability'),
    uncertainty: sum('uncertainty'),
    nextReviewAt: states.map((state) => state.nextReviewAt).filter((value): value is number => value !== null).sort((a, b) => a - b)[0] ?? null,
  }
}

export function reviewCandidatePriority(candidate: ReviewCandidate, now: number) {
  const state = averageSkillState(candidate)
  const lastActivity = candidate.lastReviewedAt ?? candidate.createdAt
  const daysSince = Math.max(0, (now - lastActivity) / DAY_MS)
  const dueDays = state?.nextReviewAt === null || state?.nextReviewAt === undefined
    ? 0
    : (now - state.nextReviewAt) / DAY_MS
  const due = state?.nextReviewAt == null ? 0 : clamp((dueDays + 2) / 16)
  const forgetting = state ? 1 - state.retrievability : clamp(daysSince / 75)
  const masteryGap = state ? 1 - state.mastery : .45
  const uncertainty = state?.uncertainty ?? .9
  const firstReview = candidate.reviewCount === 0 ? (now - candidate.createdAt <= 14 * DAY_MS ? 1 : .55) : 0
  const longNeglected = clamp(daysSince / 120)
  const recentFailure = candidate.lastRating === 'again' ? 1 : candidate.lastRating === 'hard' ? .55 : 0
  const recentDensity = candidate.lastReviewedAt && now - candidate.lastReviewedAt < 20 * 60 * 60 * 1000 ? 1 : 0
  const difficulty = candidate.difficulty === 'advanced' ? 1 : candidate.difficulty === 'intermediate' ? .5 : 0
  const taggedCoverage = candidate.tags.some((tag) => tag.type !== 'error') ? 1 : 0

  const score = due * 22 + forgetting * 18 + masteryGap * 17 + uncertainty * 10 +
    firstReview * 14 + longNeglected * 9 + recentFailure * 12 + difficulty * 4 +
    taggedCoverage * 2 - recentDensity * 14
  return Math.round(clamp(score, 0, 100) * 100) / 100
}

function mostFrequentTag(candidates: ReviewCandidate[], type: HorizonTagType) {
  const counts = new Map<string, { tag: ReviewTag; count: number }>()
  candidates.flatMap((candidate) => tagsOf(candidate, type)).forEach((tag) => {
    const key = tag.id || `name:${tag.name}`
    const current = counts.get(key)
    counts.set(key, { tag, count: (current?.count ?? 0) + 1 })
  })
  return [...counts.values()].sort((left, right) =>
    right.count - left.count || Number(right.tag.role === 'primary') - Number(left.tag.role === 'primary') ||
    left.tag.name.localeCompare(right.tag.name, 'zh-CN'))[0]?.tag ?? null
}

function commonTags(candidates: ReviewCandidate[], type: HorizonTagType, limit: number) {
  const counts = new Map<string, { tag: ReviewTag; count: number }>()
  candidates.flatMap((candidate) => tagsOf(candidate, type)).forEach((tag) => {
    const key = tag.id || `name:${tag.name}`
    const current = counts.get(key)
    counts.set(key, { tag, count: (current?.count ?? 0) + 1 })
  })
  return [...counts.values()]
    .sort((left, right) => right.count - left.count || left.tag.name.localeCompare(right.tag.name, 'zh-CN'))
    .slice(0, limit)
    .map(({ tag }) => tag)
}

function dominantDifficulty(candidates: ReviewCandidate[]): DifficultyLevel {
  const counts: Record<DifficultyLevel, number> = { basic: 0, intermediate: 0, advanced: 0 }
  candidates.forEach((candidate) => { counts[candidate.difficulty ?? 'intermediate'] += 1 })
  return (Object.keys(counts) as DifficultyLevel[]).sort((left, right) =>
    counts[right] - counts[left] || difficultyRank[left] - difficultyRank[right])[0]
}

function reasonFor(candidates: ReviewCandidate[], now: number) {
  if (candidates.length >= 2) return `近期有 ${candidates.length} 道错题集中在这一能力组合`
  const candidate = candidates[0]
  if (candidate.lastRating === 'again') return '上次复习仍不熟练，今天优先巩固'
  if (candidate.lastRating === 'hard') return '上次完成较困难，今天安排短时巩固'
  if (candidate.reviewCount === 0) return '这项内容尚未完成首次复习'
  if (candidate.lastReviewedAt && now - candidate.lastReviewedAt >= 30 * DAY_MS) return '距离上次复习时间较长'
  return '已接近下一次复习时间'
}

function buildUnit(candidates: ReviewCandidate[], now: number): ReviewUnitDraft {
  const sorted = [...candidates].sort((left, right) =>
    reviewCandidatePriority(right, now) - reviewCandidatePriority(left, now) || left.problemId.localeCompare(right.problemId))
  const knowledge = mostFrequentTag(sorted, 'knowledge')
  const methods = commonTags(sorted, 'method', 2)
  const models = commonTags(sorted, 'model', 2)
  const errors = commonTags(sorted, 'error', 2)
  const difficulty = dominantDifficulty(sorted)
  const secondaryTitle = methods[0]?.name ?? models[0]?.name
  const titleParts = [knowledge?.name, secondaryTitle && !knowledge?.name.includes(secondaryTitle) ? secondaryTitle : null].filter(Boolean)
  const title = titleParts.length ? titleParts.join(' · ') : sorted[0].title || '错题回顾'
  const tagKey = [knowledge, ...methods, ...models]
    .filter((tag): tag is ReviewTag => Boolean(tag))
    .map((tag) => `${tag.type}:${tag.id || tag.name}`)
    .sort()
    .join('|')
  const canonicalKey = `${sorted[0].subject.trim().toLocaleLowerCase('zh-CN')}|${tagKey || `problem:${sorted[0].problemId}`}|${difficulty}`
  const averagePriority = sorted.reduce((total, candidate) => total + reviewCandidatePriority(candidate, now), 0) / sorted.length
  const repetitionBonus = Math.min(12, Math.max(0, sorted.length - 1) * 5)
  return {
    canonicalKey,
    subject: sorted[0].subject,
    title,
    primaryKnowledge: knowledge,
    methods,
    models,
    errorCategories: errors,
    difficulty,
    priorityScore: Math.round(clamp(averagePriority + repetitionBonus, 0, 100) * 100) / 100,
    selectionReason: reasonFor(sorted, now),
    estimatedDurationSeconds: Math.min(720, 240 + Math.max(0, sorted.length - 1) * 60 + difficultyRank[difficulty] * 60),
    representativeProblems: sorted.slice(0, 3),
    allProblemIds: sorted.map((candidate) => candidate.problemId),
  }
}

function unitSimilarity(left: ReviewUnitDraft, right: ReviewUnitDraft) {
  return reviewSimilarity(left.representativeProblems[0], right.representativeProblems[0])
}

export function buildTodayReviewUnits(candidates: ReviewCandidate[], options: ReviewPlanOptions) {
  const eligible = candidates.filter((candidate) =>
    candidate.subject.trim() && candidate.stemMarkdown.trim())
  const ordered = [...eligible].sort((left, right) =>
    reviewCandidatePriority(right, options.now) - reviewCandidatePriority(left, options.now) ||
    left.createdAt - right.createdAt || left.problemId.localeCompare(right.problemId))
  const clusters: ReviewCandidate[][] = []
  ordered.forEach((candidate) => {
    const cluster = clusters.find((items) => canCluster(items[0], candidate))
    if (cluster) cluster.push(candidate)
    else clusters.push([candidate])
  })

  const available = clusters.map((cluster) => buildUnit(cluster, options.now))
  const selected: ReviewUnitDraft[] = []
  const maxModules = options.maxModules ?? 2
  while (available.length && selected.length < maxModules) {
    available.sort((left, right) => {
      const leftPenalty = selected.length ? Math.max(...selected.map((item) => unitSimilarity(left, item))) * 24 : 0
      const rightPenalty = selected.length ? Math.max(...selected.map((item) => unitSimilarity(right, item))) * 24 : 0
      return (right.priorityScore - rightPenalty) - (left.priorityScore - leftPenalty) || left.canonicalKey.localeCompare(right.canonicalKey)
    })
    selected.push(available.shift()!)
  }
  return selected
}

export function initialReviewSkillState(): ReviewSkillState {
  return {
    masteryEstimate: .45,
    stability: 1,
    retrievability: .65,
    evidenceCount: 0,
    successCount: 0,
    failureCount: 0,
    transferScore: 0,
    maxStableDifficulty: null,
    lastPracticedAt: null,
    nextReviewAt: null,
    uncertainty: 1,
  }
}

export function applyReviewRating(
  current: ReviewSkillState | null,
  rating: ReviewRating,
  difficulty: DifficultyLevel,
  reviewedAt: number,
): ReviewSkillState {
  const state = current ?? initialReviewSkillState()
  const config = {
    again: { mastery: -.18, stability: .55, retrievability: .3, interval: 1, uncertainty: .08, success: 0, failure: 1 },
    hard: { mastery: .03, stability: 1.15, retrievability: .66, interval: 1.2, uncertainty: .1, success: 0, failure: 0 },
    good: { mastery: .12, stability: 1.8, retrievability: .86, interval: 2.2, uncertainty: .14, success: 1, failure: 0 },
    easy: { mastery: .2, stability: 2.6, retrievability: .95, interval: 3.4, uncertainty: .18, success: 1, failure: 0 },
  }[rating]
  const stability = Math.max(.5, Math.min(365, state.stability * config.stability))
  const intervalDays = Math.max(1, Math.min(180, stability * config.interval))
  const previousDifficulty = state.maxStableDifficulty
  const promoteDifficulty = rating === 'good' || rating === 'easy'
  const maxStableDifficulty = promoteDifficulty && (
    previousDifficulty === null || difficultyRank[difficulty] > difficultyRank[previousDifficulty]
  ) ? difficulty : previousDifficulty
  return {
    ...state,
    masteryEstimate: clamp(state.masteryEstimate + config.mastery),
    stability,
    retrievability: config.retrievability,
    evidenceCount: state.evidenceCount + 1,
    successCount: state.successCount + config.success,
    failureCount: state.failureCount + config.failure,
    maxStableDifficulty,
    lastPracticedAt: reviewedAt,
    nextReviewAt: reviewedAt + Math.round(intervalDays * DAY_MS),
    uncertainty: clamp(state.uncertainty - config.uncertainty),
  }
}

export function ratingEvidence(rating: ReviewRating) {
  if (rating === 'again') return { result: 'not_demonstrated', weight: 1 }
  if (rating === 'hard') return { result: 'partially_demonstrated', weight: .75 }
  if (rating === 'easy') return { result: 'demonstrated', weight: 1.15 }
  return { result: 'demonstrated', weight: 1 }
}

export function localReviewDate(timestamp = Date.now()) {
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function startOfLocalReviewDay(timestamp: number) {
  const date = new Date(timestamp)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

export function addLocalReviewDays(timestamp: number, days: number) {
  const date = new Date(startOfLocalReviewDay(timestamp))
  date.setDate(date.getDate() + days)
  return date.getTime()
}

export function endOfLocalReviewDay(timestamp: number) {
  return addLocalReviewDays(timestamp, 1) - 1
}

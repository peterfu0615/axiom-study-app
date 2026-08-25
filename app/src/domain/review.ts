import type { DifficultyLevel, HorizonTagRole, HorizonTagType } from './models'

export const REVIEW_SCHEDULER_VERSION = 'ebbinghaus-v3'
export const DEFAULT_TARGET_RETENTION = .7
export const INITIAL_REVIEW_STABILITY_DAYS = 4

export type ReviewRating = 'again' | 'hard' | 'good' | 'easy'
export type ReviewUnitStatus = 'pending' | 'completed' | 'deferred'
export type ReviewSessionMode = 'quick' | 'standard' | 'mock_test'
export type ReviewSessionStatus =
  | 'draft' | 'generated' | 'exported' | 'submitted' | 'processing'
  | 'needs_review' | 'graded' | 'applied' | 'completed'
  | 'generation_failed' | 'upload_failed' | 'grading_failed' | 'cancelled' | 'expired'

export interface ReviewSessionSettings {
  mode: ReviewSessionMode
  maxDurationSeconds: number
  includeAnswerSheet: boolean
  hideSolutionsUntilSubmitted: boolean
  showSourceLabels: boolean
}

const sessionTransitions: Record<ReviewSessionStatus, ReviewSessionStatus[]> = {
  draft: ['generated', 'generation_failed', 'cancelled'],
  generated: ['exported', 'submitted', 'processing', 'generation_failed', 'cancelled', 'expired'],
  exported: ['submitted', 'processing', 'upload_failed', 'cancelled', 'expired'],
  submitted: ['processing', 'upload_failed', 'cancelled'],
  processing: ['needs_review', 'graded', 'grading_failed', 'cancelled'],
  needs_review: ['graded', 'processing', 'cancelled'],
  graded: ['applied', 'needs_review'],
  applied: ['completed'],
  completed: [],
  generation_failed: ['draft', 'generated', 'exported', 'cancelled'],
  upload_failed: ['submitted', 'processing', 'cancelled'],
  grading_failed: ['processing', 'needs_review', 'cancelled'],
  cancelled: [],
  expired: [],
}

export function canTransitionReviewSession(from: ReviewSessionStatus, to: ReviewSessionStatus) {
  return from === to || sessionTransitions[from].includes(to)
}

export function defaultReviewSessionSettings(mode: ReviewSessionMode, itemCount: number): ReviewSessionSettings {
  if (mode === 'quick') return {
    mode, maxDurationSeconds: Math.max(300, Math.min(600, itemCount * 180)),
    includeAnswerSheet: false, hideSolutionsUntilSubmitted: true, showSourceLabels: true,
  }
  if (mode === 'mock_test') return {
    mode, maxDurationSeconds: Math.max(1200, itemCount * 600),
    includeAnswerSheet: true, hideSolutionsUntilSubmitted: true, showSourceLabels: false,
  }
  return {
    mode, maxDurationSeconds: Math.max(600, itemCount * 420),
    includeAnswerSheet: false, hideSolutionsUntilSubmitted: true, showSourceLabels: true,
  }
}

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
  questionImagePath?: string | null
  diagramImagePaths?: string[]
  createdAt: number
  difficulty: DifficultyLevel | null
  tags: ReviewTag[]
  skillStates: Record<string, ReviewSkillState>
  bundleState?: ReviewSkillState | null
  mistakeCapturedAt?: number | null
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
  targetRetention?: number
  maxDailyMinutes?: number
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

export function normalizeTargetRetention(value = DEFAULT_TARGET_RETENTION) {
  return clamp(Number.isFinite(value) ? value : DEFAULT_TARGET_RETENTION, .4, .9)
}

export function reviewRetrievability(state: ReviewSkillState, now: number) {
  if (state.lastPracticedAt == null) return state.retrievability
  const elapsedDays = Math.max(0, now - state.lastPracticedAt) / DAY_MS
  return clamp(Math.exp(-elapsedDays / Math.max(.5, state.stability)))
}

export function reviewDueAt(state: ReviewSkillState, targetRetention = DEFAULT_TARGET_RETENTION) {
  if (state.lastPracticedAt == null) return state.nextReviewAt
  return state.lastPracticedAt + Math.round(
    Math.max(.5, state.stability) * -Math.log(normalizeTargetRetention(targetRetention)) * DAY_MS,
  )
}

export function effectiveSkillRetention(states: Array<{ state: ReviewSkillState; weight: number }>, now: number) {
  if (!states.length) return 1
  const values = states.map(({ state, weight }) => ({ value: reviewRetrievability(state, now), weight }))
  const weakest = Math.min(...values.map(({ value }) => value))
  const totalWeight = values.reduce((sum, item) => sum + item.weight, 0) || 1
  const average = values.reduce((sum, item) => sum + item.value * item.weight, 0) / totalWeight
  return clamp(weakest * .6 + average * .4)
}

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
  const dueAt = candidateDueAt(candidate, now)
  const dueDays = (now - dueAt) / DAY_MS
  const due = clamp((dueDays + 2) / 16)
  const forgetting = state
    ? 1 - candidateRetention(candidate, now)
    : clamp(daysSince / 75)
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

export function reviewTagEvidenceWeight(tag: Pick<ReviewTag, 'type' | 'role'>) {
  if (tag.type === 'method') return .85
  if (tag.type === 'model') return .75
  return tag.role === 'primary' ? 1 : .85
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
    estimatedDurationSeconds: sorted.slice(0, 3).reduce((total, candidate) =>
      total + estimateReviewProblemSeconds(candidate), 0),
    representativeProblems: sorted.slice(0, 3),
    allProblemIds: sorted.map((candidate) => candidate.problemId),
  }
}

function unitSimilarity(left: ReviewUnitDraft, right: ReviewUnitDraft) {
  return reviewSimilarity(left.representativeProblems[0], right.representativeProblems[0])
}

export function buildReviewUnitPool(candidates: ReviewCandidate[], now: number) {
  const eligible = candidates.filter((candidate) =>
    candidate.subject.trim() && candidate.stemMarkdown.trim())
  const ordered = [...eligible].sort((left, right) =>
    reviewCandidatePriority(right, now) - reviewCandidatePriority(left, now) ||
    left.createdAt - right.createdAt || left.problemId.localeCompare(right.problemId))
  const clusters: ReviewCandidate[][] = []
  const clustersByKnowledge = new Map<string, number[]>()
  ordered.forEach((candidate) => {
    const knowledgeKeys = [...tagKeys(candidate, 'knowledge')]
    const possibleIndexes = [...new Set(knowledgeKeys.flatMap((key) => clustersByKnowledge.get(key) ?? []))]
      .sort((left, right) => left - right)
    const clusterIndex = possibleIndexes.find((index) => canCluster(clusters[index][0], candidate))
    if (clusterIndex !== undefined) {
      clusters[clusterIndex].push(candidate)
      return
    }
    const nextIndex = clusters.length
    clusters.push([candidate])
    knowledgeKeys.forEach((key) => {
      const indexes = clustersByKnowledge.get(key) ?? []
      indexes.push(nextIndex)
      clustersByKnowledge.set(key, indexes)
    })
  })

  return clusters.map((cluster) => buildUnit(cluster, now))
}

export function buildTodayReviewUnits(candidates: ReviewCandidate[], options: ReviewPlanOptions) {
  const targetRetention = normalizeTargetRetention(options.targetRetention)
  const endOfToday = endOfLocalReviewDay(options.now)
  const dueCandidates = candidates.filter((candidate) => candidateDueAt(candidate, options.now, targetRetention) <= endOfToday)
  const available = buildReviewUnitPool(dueCandidates, options.now)
  const selected: ReviewUnitDraft[] = []
  const dailyMinutes = options.maxDailyMinutes ?? 25
  if (dailyMinutes <= 0) return selected
  const maxSeconds = Math.max(1, dailyMinutes) * 60
  const maxModules = Math.max(1, options.maxModules ?? 2)
  while (available.length) {
    available.sort((left, right) => {
      const leftPenalty = selected.length ? Math.max(...selected.map((item) => unitSimilarity(left, item))) * 24 : 0
      const rightPenalty = selected.length ? Math.max(...selected.map((item) => unitSimilarity(right, item))) * 24 : 0
      return (right.priorityScore - rightPenalty) - (left.priorityScore - leftPenalty) || left.canonicalKey.localeCompare(right.canonicalKey)
    })
    const next = available.shift()!
    if (selected.length >= maxModules) break
    if (selected.length && selected.reduce((sum, item) => sum + item.estimatedDurationSeconds, 0) + next.estimatedDurationSeconds > maxSeconds) continue
    selected.push(next)
  }
  return selected
}

export function candidateDueAt(candidate: ReviewCandidate, now: number, targetRetention = DEFAULT_TARGET_RETENTION) {
  const primaryKnowledge = candidate.tags.find((tag) => tag.type === 'knowledge' && tag.role === 'primary')
    ?? candidate.tags.find((tag) => tag.type === 'knowledge')
  const primaryState = primaryKnowledge?.id ? candidate.skillStates[primaryKnowledge.id] : null
  const schedulingStates = [primaryState, candidate.bundleState]
    .filter((state): state is ReviewSkillState => Boolean(state?.lastPracticedAt != null))
  if (schedulingStates.length) {
    return Math.min(...schedulingStates.map((state) => reviewDueAt(state, targetRetention) ?? Number.POSITIVE_INFINITY))
  }
  if (candidate.lastReviewedAt && candidate.lastRating) {
    return applyReviewRating(null, candidate.lastRating, candidate.difficulty ?? 'intermediate', candidate.lastReviewedAt, { targetRetention }).nextReviewAt ?? now
  }
  const capturedAt = candidate.mistakeCapturedAt ?? candidate.createdAt ?? now
  return reviewDueAt({ ...initialReviewSkillState(), lastPracticedAt: capturedAt }, targetRetention) ?? capturedAt
}

export function candidateRetention(candidate: ReviewCandidate, at: number) {
  const primaryKnowledge = candidate.tags.find((tag) => tag.type === 'knowledge' && tag.role === 'primary')
    ?? candidate.tags.find((tag) => tag.type === 'knowledge')
  const states = [
    primaryKnowledge?.id ? candidate.skillStates[primaryKnowledge.id] : null,
    candidate.bundleState,
  ].filter((state): state is ReviewSkillState => Boolean(state))
  if (states.length) return Math.min(...states.map((state) => reviewRetrievability(state, at)))
  const capturedAt = candidate.mistakeCapturedAt ?? candidate.createdAt
  return reviewRetrievability({ ...initialReviewSkillState(), lastPracticedAt: capturedAt }, at)
}

export function estimateReviewProblemSeconds(candidate: Pick<ReviewCandidate, 'difficulty' | 'tags' | 'diagramImagePaths'>) {
  const base = candidate.difficulty === 'advanced' ? 10 : candidate.difficulty === 'intermediate' ? 7 : 4
  const complexity = Math.min(3,
    candidate.tags.filter((tag) => tag.type === 'method' || tag.type === 'model').length)
  const diagram = candidate.diagramImagePaths?.length ? 2 : 0
  return Math.max(3, Math.min(15, base + complexity + diagram)) * 60
}

export function initialReviewSkillState(_targetRetention = DEFAULT_TARGET_RETENTION): ReviewSkillState {
  return {
    masteryEstimate: .45,
    stability: INITIAL_REVIEW_STABILITY_DAYS,
    retrievability: 1,
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

export function initialReviewSkillStateV1(): ReviewSkillState {
  return { ...initialReviewSkillState(), stability: 1, retrievability: .65 }
}

export function convertReviewStateV1ToV2(
  state: ReviewSkillState,
  now = Date.now(),
  targetRetention = DEFAULT_TARGET_RETENTION,
): ReviewSkillState {
  const target = normalizeTargetRetention(targetRetention)
  const intervalDays = state.lastPracticedAt != null && state.nextReviewAt != null
    ? Math.max(.25, (state.nextReviewAt - state.lastPracticedAt) / DAY_MS)
    : 1
  const stability = Math.max(.5, Math.min(3650, intervalDays / -Math.log(target)))
  const converted = { ...state, stability }
  return {
    ...converted,
    retrievability: converted.lastPracticedAt == null ? 1 : reviewRetrievability(converted, now),
    nextReviewAt: converted.lastPracticedAt == null
      ? converted.nextReviewAt
      : reviewDueAt(converted, target),
  }
}

export function convertReviewStateToV3(
  state: ReviewSkillState,
  fromVersion: string,
  now = Date.now(),
  targetRetention = DEFAULT_TARGET_RETENTION,
): ReviewSkillState {
  if (fromVersion === 'horizon-v1' || fromVersion === '1' || fromVersion === 'foundation-v1') {
    return convertReviewStateV1ToV2(state, now, targetRetention)
  }
  return {
    ...state,
    retrievability: state.lastPracticedAt == null ? state.retrievability : reviewRetrievability(state, now),
    nextReviewAt: state.lastPracticedAt == null ? state.nextReviewAt : reviewDueAt(state, targetRetention),
  }
}

export function applyReviewRatingV1(
  current: ReviewSkillState | null,
  rating: ReviewRating,
  difficulty: DifficultyLevel,
  reviewedAt: number,
): ReviewSkillState {
  const state = current ?? initialReviewSkillStateV1()
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

export function applyReviewRating(
  current: ReviewSkillState | null,
  rating: ReviewRating,
  difficulty: DifficultyLevel,
  reviewedAt: number,
  options: { targetRetention?: number; transfer?: boolean } = {},
): ReviewSkillState {
  const targetRetention = normalizeTargetRetention(options.targetRetention)
  const state = current ?? initialReviewSkillState(targetRetention)
  const before = reviewRetrievability(state, reviewedAt)
  const baseMultiplier = { again: .55, hard: 1.25, good: 1.9, easy: 2.8 }[rating]
  const successDifficulty = { basic: .9, intermediate: 1, advanced: 1.15 }[difficulty]
  const failureDifficulty = { basic: .8, intermediate: .9, advanced: 1 }[difficulty]
  const spacing = rating === 'again' ? 1 : 1 + .35 * (1 - before)
  const transfer = options.transfer && (rating === 'good' || rating === 'easy') ? 1.12 : 1
  const stability = Math.max(.5, Math.min(3650,
    state.stability * baseMultiplier * (rating === 'again' ? failureDifficulty : successDifficulty) * spacing * transfer))
  const masteryDelta = { again: -.18, hard: .03, good: .12, easy: .2 }[rating]
  const previousDifficulty = state.maxStableDifficulty
  const promoteDifficulty = rating === 'good' || rating === 'easy'
  const maxStableDifficulty = promoteDifficulty && (
    previousDifficulty === null || difficultyRank[difficulty] > difficultyRank[previousDifficulty]
  ) ? difficulty : previousDifficulty
  return {
    ...state,
    masteryEstimate: clamp(state.masteryEstimate + masteryDelta),
    stability,
    retrievability: 1,
    evidenceCount: state.evidenceCount + 1,
    successCount: state.successCount + (rating === 'good' || rating === 'easy' ? 1 : 0),
    failureCount: state.failureCount + (rating === 'again' ? 1 : 0),
    transferScore: options.transfer && (rating === 'good' || rating === 'easy')
      ? clamp(state.transferScore + (1 - state.transferScore) * .16)
      : state.transferScore,
    maxStableDifficulty,
    lastPracticedAt: reviewedAt,
    nextReviewAt: reviewedAt + Math.round(stability * -Math.log(targetRetention) * DAY_MS),
    uncertainty: clamp(state.uncertainty - ({ again: .08, hard: .1, good: .14, easy: .18 }[rating])),
  }
}

export function applyWeightedReviewRating(
  current: ReviewSkillState | null,
  rating: ReviewRating,
  difficulty: DifficultyLevel,
  reviewedAt: number,
  strength: number,
  transfer = false,
  targetRetention = DEFAULT_TARGET_RETENTION,
): ReviewSkillState {
  const state = current ?? initialReviewSkillState(targetRetention)
  const factor = clamp(strength, 0, 1)
  if (factor === 0) return state
  const full = applyReviewRating(state, rating, difficulty, reviewedAt, { transfer, targetRetention })
  const interpolate = (from: number, to: number) => from + (to - from) * factor
  const stability = Math.max(.5, interpolate(state.stability, full.stability))
  return {
    ...state,
    masteryEstimate: clamp(interpolate(state.masteryEstimate, full.masteryEstimate)),
    stability,
    retrievability: clamp(interpolate(state.retrievability, full.retrievability)),
    evidenceCount: state.evidenceCount + 1,
    successCount: state.successCount + (rating === 'good' || rating === 'easy' ? 1 : 0),
    failureCount: state.failureCount + (rating === 'again' ? 1 : 0),
    transferScore: transfer && (rating === 'good' || rating === 'easy')
      ? clamp(state.transferScore + (1 - state.transferScore) * .16 * factor)
      : state.transferScore,
    maxStableDifficulty: factor >= .5 ? full.maxStableDifficulty : state.maxStableDifficulty,
    lastPracticedAt: reviewedAt,
    nextReviewAt: reviewedAt + Math.round(stability * -Math.log(normalizeTargetRetention(targetRetention)) * DAY_MS),
    uncertainty: clamp(interpolate(state.uncertainty, full.uncertainty)),
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

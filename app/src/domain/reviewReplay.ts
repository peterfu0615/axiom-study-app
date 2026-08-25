import type { DifficultyLevel } from './models'
import {
  applyReviewRating,
  applyReviewRatingV1,
  convertReviewStateV1ToV2,
  initialReviewSkillState,
  initialReviewSkillStateV1,
  type ReviewRating,
  type ReviewSkillState,
} from './review'

export interface ReviewReplayEvent {
  logId: string
  reviewedAt: number
  subject: string
  skillBundleId: string
  rating: ReviewRating
  difficulty: DifficultyLevel
  tagIds: string[]
  previousBundleState: ReviewSkillState | null
  schedulerVersion?: string
}

export interface CurrentReplayState {
  kind: 'skill' | 'bundle'
  key: string
  subject: string
  entityId: string
  state: ReviewSkillState
  schedulerVersion: string
}

export interface ExpectedReplayState extends CurrentReplayState {
  eventCount: number
  legacyBoundary: boolean
}

export type ReplayDifferenceKind = 'missing' | 'extra' | 'mismatch'
export interface ReplayDifference {
  kind: ReplayDifferenceKind
  stateKind: 'skill' | 'bundle'
  key: string
  actual: ReviewSkillState | null
  expected: ReviewSkillState | null
}

export interface ReviewReplayPreview {
  status: 'consistent' | 'needs_rebuild' | 'legacy_partial' | 'empty'
  events: ReviewReplayEvent[]
  expected: ExpectedReplayState[]
  differences: ReplayDifference[]
  legacyKeys: string[]
}

const skillKey = (subject: string, tagId: string) => `skill:${subject}:${tagId}`
const bundleKey = (subject: string, bundleId: string) => `bundle:${subject}:${bundleId}`
const compareFields: Array<keyof ReviewSkillState> = [
  'masteryEstimate', 'stability', 'retrievability', 'evidenceCount',
  'successCount', 'failureCount', 'transferScore', 'maxStableDifficulty',
  'lastPracticedAt', 'nextReviewAt', 'uncertainty',
]

function equalValue(left: unknown, right: unknown) {
  if (typeof left === 'number' && typeof right === 'number') return Math.abs(left - right) < 1e-8
  return left === right
}

export function equalReviewState(left: ReviewSkillState, right: ReviewSkillState, kind: 'skill' | 'bundle') {
  const fields = kind === 'bundle'
    ? compareFields.filter((field) => !['successCount', 'failureCount', 'maxStableDifficulty'].includes(field))
    : compareFields
  return fields.every((field) => equalValue(left[field], right[field]))
}

export function replayReviewHistory(events: ReviewReplayEvent[]): ExpectedReplayState[] {
  const ordered = [...events].sort((left, right) =>
    left.reviewedAt - right.reviewedAt || left.logId.localeCompare(right.logId))
  const states = new Map<string, ExpectedReplayState>()
  ordered.forEach((event) => {
    const isModern = event.schedulerVersion === 'ebbinghaus-v2' || event.schedulerVersion === 'ebbinghaus-v3'
    const modernVersion = event.schedulerVersion === 'ebbinghaus-v3' ? 'ebbinghaus-v3' : 'ebbinghaus-v2'
    const transition = isModern ? applyReviewRating : applyReviewRatingV1
    const baselineFor = (current: ExpectedReplayState | undefined, fallback?: ReviewSkillState | null) => {
      const state = current?.state ?? fallback
      if (!state) return isModern ? initialReviewSkillState() : initialReviewSkillStateV1()
      return isModern && current?.schedulerVersion === 'horizon-v1'
        ? convertReviewStateV1ToV2(state, event.reviewedAt)
        : state
    }
    const uniqueTagIds = [...new Set(event.tagIds)].sort()
    uniqueTagIds.forEach((tagId) => {
      const key = skillKey(event.subject, tagId)
      const current = states.get(key)
      const next = transition(baselineFor(current), event.rating, event.difficulty, event.reviewedAt)
      states.set(key, {
        kind: 'skill', key, subject: event.subject, entityId: tagId,
        state: next, schedulerVersion: isModern ? modernVersion : 'horizon-v1', eventCount: (current?.eventCount ?? 0) + 1,
        legacyBoundary: false,
      })
    })
    const key = bundleKey(event.subject, event.skillBundleId)
    const current = states.get(key)
    const baseline = baselineFor(current, event.previousBundleState)
    states.set(key, {
      kind: 'bundle', key, subject: event.subject, entityId: event.skillBundleId,
      state: transition(baseline, event.rating, event.difficulty, event.reviewedAt),
      schedulerVersion: isModern ? modernVersion : 'horizon-v1', eventCount: (current?.eventCount ?? 0) + 1,
      legacyBoundary: !current && Boolean(event.previousBundleState?.evidenceCount),
    })
  })
  return [...states.values()].sort((left, right) => left.key.localeCompare(right.key))
}

export function previewReviewStateReplay(
  events: ReviewReplayEvent[],
  currentStates: CurrentReplayState[],
): ReviewReplayPreview {
  if (!events.length) return { status: 'empty', events: [], expected: [], differences: [], legacyKeys: [] }
  const expected = replayReviewHistory(events)
  const expectedByKey = new Map(expected.map((item) => [item.key, item]))
  const currentByKey = new Map(currentStates.map((item) => [item.key, item]))
  const firstEventAt = Math.min(...events.map((event) => event.reviewedAt))
  const legacyKeys: string[] = []
  const differences: ReplayDifference[] = []

  expected.forEach((item) => {
    const actual = currentByKey.get(item.key)
    // Skill-level immutable coverage begins with horizon_review_logs. If an
    // existing state contains more evidence than the covered tag events, its
    // earlier history cannot be invented and strict rebuild is withheld.
    if (item.kind === 'skill' && actual && actual.state.evidenceCount > item.eventCount) {
      legacyKeys.push(item.key)
      return
    }
    if (!actual) differences.push({ kind: 'missing', stateKind: item.kind, key: item.key, actual: null, expected: item.state })
    else if (!equalReviewState(actual.state, item.state, item.kind)) {
      differences.push({ kind: 'mismatch', stateKind: item.kind, key: item.key, actual: actual.state, expected: item.state })
    }
  })

  currentStates.forEach((actual) => {
    if (expectedByKey.has(actual.key)) return
    const strictlyCovered = ['horizon-v1', 'ebbinghaus-v2', 'ebbinghaus-v3'].includes(actual.schedulerVersion) && actual.state.evidenceCount > 0 &&
      (actual.state.lastPracticedAt ?? 0) >= firstEventAt
    if (strictlyCovered) differences.push({ kind: 'extra', stateKind: actual.kind, key: actual.key, actual: actual.state, expected: null })
  })

  return {
    status: differences.length ? 'needs_rebuild' : legacyKeys.length ? 'legacy_partial' : 'consistent',
    events: [...events].sort((left, right) => left.reviewedAt - right.reviewedAt || left.logId.localeCompare(right.logId)),
    expected,
    differences,
    legacyKeys: legacyKeys.sort(),
  }
}

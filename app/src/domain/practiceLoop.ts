import type { ReviewRating, ReviewSkillState } from './review'
import type { PracticeGradingResult, PracticeTagEvidence } from './practiceGrading'

export type PracticeLoopStatus = 'active' | 'needs_reinforcement' | 'mastered' | 'stopped'
export type PracticeLoopStopReason = 'all_correct' | 'mastery_reached' | 'budget_reached' | 'user_stopped' | 'no_distinct_items' | null

export interface PracticeLoop {
  id: string
  rootPracticeSetId: string
  currentPracticeSetId: string
  status: PracticeLoopStatus
  roundIndex: number
  itemBudget: number
  consumedItems: number
  stopReason: PracticeLoopStopReason
  nextPracticeSetId: string | null
  updatedAt: number
}

export function practiceRating(result: PracticeGradingResult): ReviewRating {
  if (result.correctness === 'correct') return 'good'
  if (result.correctness === 'partial') return 'hard'
  return 'again'
}

export function tagEvidenceUpdate(
  evidence: Pick<PracticeTagEvidence, 'result' | 'confidence' | 'weight'>,
  grading: Pick<PracticeGradingResult, 'independentCompletion' | 'usedHint'>,
) {
  const rating: ReviewRating | null = evidence.result === 'demonstrated' ? 'good'
    : evidence.result === 'contradicted' ? 'again' : null
  if (!rating) return { rating: null, strength: 0 }
  return {
    rating,
    strength: evidence.confidence * evidence.weight
      * (grading.independentCompletion ? 1 : .75)
      * (grading.usedHint ? .65 : 1),
  }
}

export function isMasteredByExistingState(states: Array<ReviewSkillState | null>) {
  const known = states.filter((state): state is ReviewSkillState => state !== null)
  return known.length > 0 && known.every((state) => state.masteryEstimate >= .78 && state.uncertainty <= .35)
}

export function decidePracticeLoop(input: {
  results: PracticeGradingResult[]
  targetStates: Array<ReviewSkillState | null>
  consumedItems: number
  itemBudget: number
  userStopped?: boolean
}) {
  if (input.userStopped) return { status: 'stopped', stopReason: 'user_stopped' } as const
  if (input.results.some((result) => result.correctness === 'needs_review' || result.requiresReview)) {
    throw new Error('仍有待人工确认的批改结果，不能提交学习证据')
  }
  if (input.results.length > 0 && input.results.every((result) => result.correctness === 'correct')) {
    return { status: 'mastered', stopReason: 'all_correct' } as const
  }
  if (isMasteredByExistingState(input.targetStates)) {
    return { status: 'mastered', stopReason: 'mastery_reached' } as const
  }
  if (input.consumedItems >= input.itemBudget) {
    return { status: 'stopped', stopReason: 'budget_reached' } as const
  }
  return { status: 'needs_reinforcement', stopReason: null } as const
}

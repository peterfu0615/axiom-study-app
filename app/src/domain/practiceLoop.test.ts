import { describe, expect, it } from 'vitest'
import { initialReviewSkillState } from './review'
import type { PracticeGradingResult } from './practiceGrading'
import { decidePracticeLoop, practiceRating } from './practiceLoop'

const grade = (correctness: PracticeGradingResult['correctness'], score = correctness === 'correct' ? 100 : 0): PracticeGradingResult => ({
  correctness, score, method: 'manual', errorCategory: correctness === 'incorrect' ? 'calculation' : null,
  evidence: [], explanation: '', requiresReview: correctness === 'needs_review', userConfirmed: true,
})

describe('practice loop decisions', () => {
  it('maps final grades onto the existing Horizon ratings', () => {
    expect(practiceRating(grade('correct'))).toBe('good')
    expect(practiceRating(grade('partial', 50))).toBe('hard')
    expect(practiceRating(grade('incorrect'))).toBe('again')
  })

  it('exits when the round passes or the existing mastery condition is met', () => {
    expect(decidePracticeLoop({ results: [grade('correct')], targetStates: [], consumedItems: 1, itemBudget: 6 })).toEqual({ status: 'mastered', stopReason: 'all_correct' })
    const mastered = { ...initialReviewSkillState(), masteryEstimate: .82, uncertainty: .2 }
    expect(decidePracticeLoop({ results: [grade('partial', 50)], targetStates: [mastered], consumedItems: 1, itemBudget: 6 })).toEqual({ status: 'mastered', stopReason: 'mastery_reached' })
  })

  it('reinforces partial failure but stops at the budget and on user request', () => {
    const input = { results: [grade('incorrect')], targetStates: [], consumedItems: 2, itemBudget: 6 }
    expect(decidePracticeLoop(input).status).toBe('needs_reinforcement')
    expect(decidePracticeLoop({ ...input, consumedItems: 6 })).toEqual({ status: 'stopped', stopReason: 'budget_reached' })
    expect(decidePracticeLoop({ ...input, userStopped: true })).toEqual({ status: 'stopped', stopReason: 'user_stopped' })
  })

  it('refuses unresolved grading evidence', () => {
    expect(() => decidePracticeLoop({ results: [grade('needs_review')], targetStates: [], consumedItems: 1, itemBudget: 3 })).toThrow('待人工确认')
  })
})

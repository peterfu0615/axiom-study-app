import { describe, expect, it } from 'vitest'
import type { PracticeItem } from './practice'
import { gradePracticeAnswer, mathematicallyEquivalent } from './practiceGrading'

const item = (canonicalAnswer: string, options: string[] | null = null): PracticeItem => ({
  id: 'item-1', practiceSetId: 'set-1', orderIndex: 0, sourceType: 'existing_problem', sourceProblemId: 'p-1',
  subject: '数学', targetSkillBundleId: null, targetTags: [], difficulty: 'basic', statementMarkdown: '题目', options,
  canonicalAnswer, solutionJson: '{}', gradingRubric: { criteria: ['答案正确'], maxScore: 100 }, diagramIds: [],
  questionImagePath: null, diagramImagePaths: [], generationMetadata: null, validationStatus: 'valid', createdAt: 1,
})
const answer = (rawMarkdown: string) => ({ rawMarkdown, steps: [{ index: 1, contentMarkdown: rawMarkdown }], source: 'user' as const })

describe('practice grading', () => {
  it('treats fractions, decimals and expanded polynomials as mathematically equivalent', () => {
    expect(mathematicallyEquivalent('1/2', '0.5')).toBe(true)
    expect(mathematicallyEquivalent('x(x+1)', 'x²+x')).toBe(true)
    expect(mathematicallyEquivalent('x(x+2)', 'x²+x')).toBe(false)
  })
  it('grades choices and inequality boundaries deterministically', () => {
    expect(gradePracticeAnswer(item('B', ['1', '2']), answer('B')).correctness).toBe('correct')
    expect(gradePracticeAnswer(item('m > -(1)/(3)'), answer('m > -1/3')).correctness).toBe('correct')
    expect(gradePracticeAnswer(item('\\because 3m + 1 > 0\n\\Longrightarrow m > -\\frac{1}{3}\n\\therefore m \\text{ 的取值范围是 } m > -\\frac{1}{3}.'), answer('m > -1/3')).correctness).toBe('correct')
  })
  it('marks a rubric-heavy response for review instead of inventing a confidence score', () => {
    const subjective = item('证明完成')
    subjective.gradingRubric.criteria = ['结论', '推理链']
    const graded = gradePracticeAnswer(subjective, { ...answer('由条件可得...'), steps: [{ index: 1, contentMarkdown: '步骤一' }, { index: 2, contentMarkdown: '步骤二' }] })
    expect(graded.correctness).toBe('needs_review')
    expect(graded.score).toBeNull()
    expect(graded).not.toHaveProperty('confidence')
  })
})

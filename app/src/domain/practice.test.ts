import { describe, expect, it } from 'vitest'
import { buildPracticeBlueprint, validateGeneratedPracticeItem, type PracticeProblemCandidate, type PracticeTargetSkill } from './practice'
import { initialReviewSkillState } from './review'

const problem = (id: string, relevance = 1): PracticeProblemCandidate => ({
  problemId: id, subject: '数学', statementMarkdown: `题目 ${id}`,
  solutionJson: '{"steps":[{"content":"解答"}]}', canonicalAnswer: '2', options: null,
  targetTags: [], diagramIds: [], questionImagePath: null, diagramImagePaths: [], originalDifficulty: 'intermediate', relevance,
})
const target = (mastery: number, uncertainty = .2): PracticeTargetSkill => ({
  id: 'tag-1', name: '一次方程', type: 'knowledge',
  state: { ...initialReviewSkillState(), masteryEstimate: mastery, uncertainty },
})

describe('practice planner', () => {
  it('uses deterministic weak/consolidating/stable difficulty ladders', () => {
    const create = (mastery: number) => buildPracticeBlueprint({
      sourceType: 'review_unit', sourceRef: 'module', subject: '数学', targetSkills: [target(mastery)],
      relatedProblems: [problem('a', 3), problem('b', 2), problem('c', 1)], recentFailureCount: 0, desiredBudget: 3,
    })
    expect(create(.2).items.map((item) => item.difficulty)).toEqual(['basic', 'basic', 'intermediate'])
    expect(create(.6).items.map((item) => item.difficulty)).toEqual(['basic', 'intermediate', 'intermediate'])
    expect(create(.9).items.map((item) => item.difficulty)).toEqual(['intermediate', 'intermediate', 'advanced'])
  })

  it('deduplicates sources and reports an honest shortfall', () => {
    const blueprint = buildPracticeBlueprint({
      sourceType: 'today', sourceRef: 'today', subject: '数学', targetSkills: [],
      relatedProblems: [problem('a'), problem('a'), problem('b')], recentFailureCount: 0, desiredBudget: 3,
    })
    expect(blueprint.items.map((item) => item.problem.problemId)).toEqual(['a', 'b'])
    expect(blueprint.warnings[0]).toContain('仅找到 2 道')
  })

  it('excludes prior-round surfaces and prioritizes the failed error category', () => {
    const candidate = (id: string, error: string, relevance: number): PracticeProblemCandidate => ({
      ...problem(id, relevance),
      targetTags: [{ id: error, name: error, type: 'error', role: 'secondary' }],
    })
    const blueprint = buildPracticeBlueprint({
      sourceType: 'practice_attempt', sourceRef: 'attempt-1', subject: '数学', targetSkills: [target(.3)],
      relatedProblems: [candidate('old', 'calculation', 1), candidate('generic', 'other', .9), candidate('targeted', 'calculation', .5)],
      recentFailureCount: 2, desiredBudget: 2, excludedProblemIds: ['old'], preferredErrorCategories: ['calculation'],
    })
    expect(blueprint.items.map((item) => item.problem.problemId)).toEqual(['targeted', 'generic'])
  })

  it('rejects generated schema success when semantics are invalid', () => {
    expect(validateGeneratedPracticeItem({
      statementMarkdown: '选择正确答案', canonicalAnswer: 'C', solutionJson: '{}', difficulty: 'hard',
      options: ['A', 'B'], targetTagIds: ['other'], expectedTargetTagIds: ['target'], diagramStatus: 'failed',
    })).toEqual(expect.arrayContaining(['solution_invalid', 'difficulty_invalid', 'answer_not_in_options', 'target_mismatch', 'diagram_failed']))
  })
})

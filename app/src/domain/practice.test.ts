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

  it('keeps every daily learning topic represented across subjects', () => {
    const bundled = (id: string, subject: string, bundle: string, relevance: number): PracticeProblemCandidate => ({
      ...problem(id, relevance), subject, targetSkillBundleId: bundle,
    })
    const blueprint = buildPracticeBlueprint({
      sourceType: 'today', sourceRef: 'session-1', subject: '综合', subjects: ['数学', '物理'],
      targetSkills: [
        { id: 'bundle:algebra', name: '方程', type: 'model', state: null },
        { id: 'bundle:motion', name: '运动', type: 'model', state: null },
      ],
      relatedProblems: [
        bundled('math-high', '数学', 'algebra', 10),
        bundled('math-next', '数学', 'algebra', 9),
        bundled('physics', '物理', 'motion', 1),
      ],
      recentFailureCount: 0,
      desiredBudget: 2,
    })
    expect(blueprint.items.map((item) => item.problem.problemId)).toEqual(['math-high', 'physics'])
  })

  it('alternates each source from confirmed evidence and starts with a variant', () => {
    const blueprint = buildPracticeBlueprint({
      sourceType: 'today', sourceRef: 'today', subject: '数学', targetSkills: [],
      relatedProblems: [
        problem('new'),
        { ...problem('after-variant'), confirmedPracticeCount: 1, lastConfirmedAt: 10, lastConfirmedSourceType: 'generated_variant' },
        { ...problem('after-original'), confirmedPracticeCount: 1, lastConfirmedAt: 20, lastConfirmedSourceType: 'existing_problem' },
      ], recentFailureCount: 0, desiredBudget: 3,
    })
    expect(blueprint.items.map((item) => [item.problem.problemId, item.requestedSourceType])).toEqual([
      ['new', 'generated_variant'],
      ['after-variant', 'existing_problem'],
      ['after-original', 'generated_variant'],
    ])
  })

  it('prioritizes never-confirmed and least-recently confirmed sources', () => {
    const blueprint = buildPracticeBlueprint({
      sourceType: 'today', sourceRef: 'today', subject: '数学', targetSkills: [],
      relatedProblems: [
        { ...problem('recent', 100), confirmedPracticeCount: 2, lastConfirmedAt: 200 },
        { ...problem('never', 1), confirmedPracticeCount: 0, lastConfirmedAt: null },
        { ...problem('old', 1), confirmedPracticeCount: 1, lastConfirmedAt: 100 },
      ], recentFailureCount: 0, desiredBudget: 3,
    })
    expect(blueprint.items.map((item) => item.problem.problemId)).toEqual(['never', 'old', 'recent'])
  })

  it('rejects generated schema success when semantics are invalid', () => {
    expect(validateGeneratedPracticeItem({
      statementMarkdown: '选择正确答案', canonicalAnswer: 'C', solutionJson: '{}', difficulty: 'hard',
      options: ['A', 'B'], targetTagIds: ['other'], expectedTargetTagIds: ['target'], diagramStatus: 'failed',
    })).toEqual(expect.arrayContaining(['solution_invalid', 'difficulty_invalid', 'answer_not_in_options', 'target_mismatch', 'diagram_failed']))
  })
})

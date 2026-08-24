import { describe, expect, it } from 'vitest'
import type { PracticeProblemCandidate } from './practice'
import { createPracticeVariantPlan, validatePracticeVariant, variantPlanEligibilityErrors } from './variantPractice'

const source: PracticeProblemCandidate = {
  problemId: 'problem-1', targetSkillBundleId: 'bundle-1', subject: '数学',
  statementMarkdown: '解方程 $2x+1=5$', options: null, canonicalAnswer: 'x=2',
  solutionJson: JSON.stringify({ steps: [{ content: '移项得 2x=4' }, { content: 'x=2' }] }),
  targetTags: [
    { id: 'knowledge-1', name: '一元一次方程', type: 'knowledge', role: 'primary' },
    { id: 'method-1', name: '移项', type: 'method', role: 'primary' },
    { id: 'model-1', name: '解方程', type: 'model', role: 'primary' },
  ],
  diagramIds: [], questionImagePath: null, diagramImagePaths: [], originalDifficulty: 'basic', relevance: 1,
}

describe('variant practice contract', () => {
  it('builds immutable subject, tag, difficulty and required-step constraints', () => {
    const plan = createPracticeVariantPlan({ id: 'plan-1', source, targetDifficulty: 'basic', createdAt: 1 })
    expect(plan.invariants).toMatchObject({
      subject: '数学', sourceProblemId: 'problem-1', targetKnowledgeTagIds: ['knowledge-1'],
      targetMethodTagIds: ['method-1'], targetModelTagIds: ['model-1'], targetDifficulty: 'basic',
    })
    expect(plan.invariants.requiredSteps).toEqual(['移项得 2x=4', 'x=2'])
    expect(variantPlanEligibilityErrors(plan)).toEqual([])
  })

  it('accepts a changed surface only after independent invariant verification', () => {
    const plan = createPracticeVariantPlan({ id: 'plan-1', source, targetDifficulty: 'basic' })
    const candidate = {
      subject: '数学', statementMarkdown: '解方程 $3y+2=11$', options: null, canonicalAnswer: 'y=3',
      solutionJson: JSON.stringify({ contentMarkdown: '移项得 $3y=9$，所以 $y=3$。' }), difficulty: 'basic' as const,
      targetTagIds: ['knowledge-1', 'method-1', 'model-1'],
      changes: [{ kind: 'numeric_values' as const, summary: '修改系数和常数' }], diagramPolicy: 'none' as const,
    }
    expect(validatePracticeVariant(plan, source, candidate, {
      independentAnswer: '3', independentSolutionJson: JSON.stringify({ contentMarkdown: 'y=3' }),
      conditionComplete: true, uniqueAnswer: true, preservesCoreKnowledge: true, preservesCoreMethod: true,
      preservesCoreModel: true, targetTagIds: candidate.targetTagIds, difficulty: 'basic', diagramCompatible: true,
      usesOutOfScopeKnowledge: false,
      requiredStepCoverage: [
        { step: '移项得 2x=4', covered: true, evidence: '移项得 3y=9' },
        { step: 'x=2', covered: true, evidence: 'y=3' },
      ], notes: [],
    })).toEqual([])
  })

  it('rejects answer disagreement, tag drift and high-risk semantic changes', () => {
    const plan = createPracticeVariantPlan({ id: 'plan-1', source, targetDifficulty: 'basic' })
    const errors = validatePracticeVariant(plan, source, {
      subject: '物理', statementMarkdown: '求逆命题', options: null, canonicalAnswer: '4', solutionJson: '{}',
      difficulty: 'advanced', targetTagIds: ['other'], changes: [], diagramPolicy: 'preserved',
    }, {
      independentAnswer: '5', independentSolutionJson: '{}', conditionComplete: false, uniqueAnswer: false,
      preservesCoreKnowledge: false, preservesCoreMethod: false, preservesCoreModel: false,
      targetTagIds: ['other'], difficulty: 'advanced', diagramCompatible: false, usesOutOfScopeKnowledge: true,
      requiredStepCoverage: [], notes: [],
    })
    expect(errors).toEqual(expect.arrayContaining([
      'subject_changed', 'solution_invalid', 'difficulty_mismatch', 'target_mismatch', 'unexpected_target',
      'change_not_allowed', 'independent_answer_mismatch', 'condition_incomplete', 'answer_not_unique',
      'knowledge_changed', 'method_changed', 'model_changed', 'out_of_scope', 'diagram_incompatible',
    ]))
  })
})

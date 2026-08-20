import { describe, expect, it } from 'vitest'
import type { SubjectivePracticeGradingInput } from '../domain/practiceGrading'
import { buildSubjectivePracticeGradingPrompt, parseSubjectivePracticeGrading } from './practiceGradingContract'

const input: SubjectivePracticeGradingInput = {
  subject: '数学', statementMarkdown: '证明题', canonicalAnswer: '成立', canonicalSolution: '连接辅助线',
  rubric: { criteria: ['辅助线', '推理'], maxScore: 100 },
  studentAnswer: { rawMarkdown: '作答', steps: [{ index: 1, contentMarkdown: '构造辅助线' }], source: 'ai' },
  targetTags: [
    { id: 'knowledge-1', name: '全等三角形', type: 'knowledge', role: 'primary' },
    { id: 'method-1', name: '倍长中线', type: 'method', role: 'primary' },
  ],
  skillBundleId: 'bundle-1', difficulty: 'intermediate', sourceType: 'generated_variant', usedHint: false,
}

function output(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    correctness: 'partial', score: 60, process_complete: true, first_error_step: 2,
    error_category: 'calculation_error', error_reason: '最后一步移项符号错误',
    correct_alternative_step: '应写为 x=2', used_target_method: true,
    applied_target_knowledge: true, matched_target_model: true,
    independent_completion: true, used_hint: false,
    evidence: ['辅助线和全等证明正确，最后计算错误'],
    tag_evidence: [
      { tag_id: 'knowledge-1', tag_type: 'knowledge', result: 'demonstrated', confidence: .93, evidence: '正确应用全等判定', weight: .9 },
      { tag_id: 'method-1', tag_type: 'method', result: 'demonstrated', confidence: .9, evidence: '正确构造倍长中线', weight: 1 },
    ],
    bundle_evidence: { skill_bundle_id: 'bundle-1', result: 'demonstrated', transfer: true, difficulty: 'intermediate', confidence: .87 },
    explanation: '主要思路正确，末步计算错误。', overall_confidence: .87, needs_review: false,
    ...overrides,
  })
}

describe('subjective practice grading contract', () => {
  it('requires first-error and per-tag evidence without collapsing a calculation error into all tags', () => {
    const prompt = buildSubjectivePracticeGradingPrompt(input)
    expect(prompt).toContain('首个错误步骤')
    expect(prompt).toContain('不能因为最终计算错误而否定')
    const result = parseSubjectivePracticeGrading(output(), input)
    expect(result.firstErrorStep).toBe(2)
    expect(result.tagEvidence).toHaveLength(2)
    expect(result.tagEvidence.every((entry) => entry.result === 'demonstrated')).toBe(true)
    expect(result.requiresReview).toBe(false)
  })

  it('forces low-confidence grading into confirmation', () => {
    const result = parseSubjectivePracticeGrading(output({ overall_confidence: .6 }), input)
    expect(result.requiresReview).toBe(true)
  })

  it('rejects fabricated, missing, duplicated or cross-type target evidence', () => {
    const invalid = JSON.parse(output()) as Record<string, unknown>
    invalid.tag_evidence = [{ tag_id: 'other-subject-tag', tag_type: 'knowledge', result: 'demonstrated', confidence: .9, evidence: '错误标签', weight: 1 }]
    expect(() => parseSubjectivePracticeGrading(JSON.stringify(invalid), input)).toThrow('目标标签')
  })
})

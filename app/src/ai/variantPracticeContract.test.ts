import { describe, expect, it } from 'vitest'
import { parsePracticeVariantCandidate, parsePracticeVariantVerification } from './variantPracticeContract'

describe('variant practice provider contract', () => {
  it('parses a generated candidate into the durable internal solution shape', () => {
    const result = parsePracticeVariantCandidate(JSON.stringify({
      subject: '数学', statement_markdown: '解方程 $3x=9$', options: null, canonical_answer: 'x=3',
      solution: { content_markdown: '$x=3$', steps: ['两边同除以 3'] }, difficulty: 'basic',
      target_tag_ids: ['k1', 'm1', 'p1'], changes: [{ kind: 'numeric_values', summary: '修改系数' }], diagram_policy: 'none',
    }))
    expect(result.canonicalAnswer).toBe('x=3')
    expect(JSON.parse(result.solutionJson).steps).toEqual([{ index: 1, contentMarkdown: '两边同除以 3' }])
  })

  it('parses independent verification and rejects loose booleans', () => {
    const valid = {
      independent_answer: '3', independent_solution: { content_markdown: 'x=3', steps: [] },
      condition_complete: true, unique_answer: true, preserves_core_knowledge: true,
      preserves_core_method: true, preserves_core_model: true, target_tag_ids: ['k1'], difficulty: 'basic',
      diagram_compatible: true, uses_out_of_scope_knowledge: false, notes: [],
    }
    expect(parsePracticeVariantVerification(JSON.stringify(valid)).independentAnswer).toBe('3')
    expect(() => parsePracticeVariantVerification(JSON.stringify({ ...valid, unique_answer: 'yes' }))).toThrow(/unique_answer/)
  })
})

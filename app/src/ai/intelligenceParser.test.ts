import { describe, expect, it } from 'vitest'
import {
  parseExplainSelection,
  parseReasoningAnalysis,
  parseStudentAttempt,
} from './intelligenceParser'

describe('intelligence parsers', () => {
  it('parses student attempt with LaTeX steps', () => {
    const parsed = parseStudentAttempt(
      JSON.stringify({
        raw_markdown: '设 $x=1$。',
        steps: [
          { index: 1, content_markdown: '$x=1$', confidence: 0.9 },
        ],
      }),
    )
    expect(parsed.attempt.steps[0].contentMarkdown).toContain('$x=1$')
  })

  it('repairs fences, trailing commas, and truncated containers', () => {
    const parsed = parseReasoningAnalysis(
      '```json\n{"approach":"代入","step_evaluations":[],"first_wrong_step":null,"error_type":null,"reason":null,"knowledge_gaps":[],"suggestion":null,}\n```',
    )
    expect(parsed.analysis.approach).toBe('代入')
    expect(parsed.repairStrategy).toContain('strip-markdown-fence')
    expect(parsed.repairStrategy).toContain('remove-trailing-commas')
  })

  it('parses explanation output and rejects invalid JSON', () => {
    const parsed = parseExplainSelection(
      JSON.stringify({
        explanation_markdown: '这里使用了 $a^2+b^2=c^2$。',
        key_point: '勾股定理',
        related_knowledge_points: ['直角三角形'],
      }),
    )
    expect(parsed.result.keyPoint).toBe('勾股定理')
    expect(() => parseExplainSelection('not json')).toThrow('JSON')
  })

  it('normalizes invalid error_type variants to allowed enum values', () => {
    const base = {
      approach: '代入法',
      step_evaluations: [],
      first_wrong_step: null,
      reason: '计算失误',
      knowledge_gaps: [],
      suggestion: '复核运算',
    }
    const cases: Array<[unknown, string | null]> = [
      ['concept', 'concept_error'],
      ['Calculation Error', 'calculation_error'],
      ['arithmetic', 'calculation_error'],
      ['formula_mistake', 'formula_error'],
      ['logic_error', 'logic_gap'],
      ['misread', 'reading_error'],
      ['unfinished', 'incomplete_solution'],
      ['none', 'no_error'],
      ['some_unknown_thing', 'unknown'],
      [42, 'unknown'],
    ]
    for (const [input, expected] of cases) {
      const parsed = parseReasoningAnalysis(
        JSON.stringify({ ...base, error_type: input }),
      )
      expect(parsed.analysis.errorType).toBe(expected)
      expect(parsed.repairStrategy).toContain('normalize-error_type')
    }
  })

  it('passes through valid error_type without normalization', () => {
    const parsed = parseReasoningAnalysis(
      JSON.stringify({
        approach: null,
        step_evaluations: [],
        first_wrong_step: null,
        error_type: 'calculation_error',
        reason: null,
        knowledge_gaps: [],
        suggestion: null,
      }),
    )
    expect(parsed.analysis.errorType).toBe('calculation_error')
    expect(parsed.repairStrategy).toBeNull()
  })
})

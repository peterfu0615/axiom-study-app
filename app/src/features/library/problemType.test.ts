import { describe, expect, it } from 'vitest'
import { problemTypeLabel } from './problemType'

describe('problemTypeLabel', () => {
  it('translates supported provider enums', () => {
    expect(problemTypeLabel('solution')).toBe('解答题')
    expect(problemTypeLabel('multiple-choice')).toBe('选择题')
  })

  it('removes the AI prefix from a readable Chinese type', () => {
    expect(problemTypeLabel('AI 题型：证明题')).toBe('证明题')
  })

  it('does not expose unknown internal enums', () => {
    expect(problemTypeLabel('long_form_v2')).toBe('待识别')
    expect(problemTypeLabel(null)).toBe('待识别')
  })
})

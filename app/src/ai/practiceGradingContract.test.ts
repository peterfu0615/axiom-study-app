import { describe, expect, it } from 'vitest'
import { buildSubjectivePracticeGradingPrompt, parseSubjectivePracticeGrading } from './practiceGradingContract'

describe('subjective practice grading contract', () => {
  it('keeps rubric grading separate from extraction and excludes confidence', () => {
    const prompt = buildSubjectivePracticeGradingPrompt({ subject: '数学', statementMarkdown: '证明题', canonicalAnswer: '成立', canonicalSolution: '连接辅助线', rubric: { criteria: ['辅助线', '推理'], maxScore: 100 }, studentAnswer: { rawMarkdown: '作答', steps: [], source: 'ai' } })
    expect(prompt).toContain('评分 rubric')
    expect(prompt).toContain('不重新做 OCR')
    expect(prompt).toContain('不要输出置信度')
  })
  it('parses only structured grading fields', () => {
    const result = parseSubjectivePracticeGrading('{"correctness":"partial","score":60,"error_category":"logic_gap","evidence":["缺一步"],"explanation":"主要思路正确"}')
    expect(result.method).toBe('subjective_ai')
    expect(result.correctness).toBe('partial')
  })
})

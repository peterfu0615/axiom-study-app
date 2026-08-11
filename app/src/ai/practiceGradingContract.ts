import type { PracticeGradingResult, SubjectivePracticeGradingInput } from '../domain/practiceGrading'

export const subjectivePracticeGradingJSONSchema = {
  type: 'object', additionalProperties: false,
  required: ['correctness', 'score', 'error_category', 'evidence', 'explanation'],
  properties: {
    correctness: { type: 'string', enum: ['correct', 'incorrect', 'partial', 'needs_review'] },
    score: { type: ['number', 'null'], minimum: 0, maximum: 100 },
    error_category: { type: ['string', 'null'] },
    evidence: { type: 'array', items: { type: 'string' } },
    explanation: { type: 'string' },
  },
} as const

export function buildSubjectivePracticeGradingPrompt(input: SubjectivePracticeGradingInput) {
  return `你是中国中学作业批改模型。此阶段只判断答案质量，不重新做 OCR，也不扩展为学习状态更新。
根据题目、标准解、评分 rubric 与学生答案给出结构化批改。允许不同但正确的方法；partial 仅用于确有部分得分证据的答案；无法可靠判断时使用 needs_review。不要输出置信度或概率。
只返回符合 JSON Schema 的 JSON，不要代码围栏。

<grading_input>
${JSON.stringify(input)}
</grading_input>`
}

export function parseSubjectivePracticeGrading(raw: string): PracticeGradingResult {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const value = JSON.parse(cleaned) as Record<string, unknown>
  const correctness = value.correctness
  if (!['correct', 'incorrect', 'partial', 'needs_review'].includes(String(correctness))
    || (value.score !== null && (typeof value.score !== 'number' || value.score < 0 || value.score > 100))
    || !Array.isArray(value.evidence) || !value.evidence.every((entry) => typeof entry === 'string')
    || typeof value.explanation !== 'string') throw new Error('主观题批改结果不符合结构化契约')
  return {
    correctness: correctness as PracticeGradingResult['correctness'], score: value.score as number | null,
    method: 'subjective_ai', errorCategory: typeof value.error_category === 'string' ? value.error_category : null,
    evidence: value.evidence as string[], explanation: value.explanation,
    requiresReview: correctness === 'needs_review', userConfirmed: false,
  }
}

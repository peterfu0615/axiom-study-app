import type { PracticeItem } from './practice'
import type { DifficultyLevel, HorizonTagType } from './models'
import type { ReviewTag } from './review'

export interface StructuredStudentAnswer {
  rawMarkdown: string
  steps: Array<{ index: number; contentMarkdown: string }>
  source: 'ai' | 'user'
}

export type PracticeCorrectness = 'correct' | 'incorrect' | 'partial' | 'needs_review'
export type PracticeGradingMethod = 'choice' | 'boolean' | 'numeric' | 'expression' | 'subjective_ai' | 'manual'
export type PracticeTagEvidenceResult = 'demonstrated' | 'contradicted' | 'insufficient'

export interface PracticeTagEvidence {
  tagId: string
  tagType: Exclude<HorizonTagType, 'error'>
  result: PracticeTagEvidenceResult
  confidence: number
  evidence: string
  weight: number
}

export interface PracticeBundleEvidence {
  skillBundleId: string | null
  result: PracticeTagEvidenceResult
  transfer: boolean
  difficulty: DifficultyLevel
  confidence: number
}

export const PRACTICE_GRADING_AUTO_APPLY_CONFIDENCE = .72

export interface PracticeGradingResult {
  modelRunId: string | null
  correctness: PracticeCorrectness
  score: number | null
  method: PracticeGradingMethod
  processComplete: boolean
  firstErrorStep: number | null
  errorCategory: string | null
  errorReason: string | null
  correctAlternativeStep: string | null
  usedTargetMethod: boolean | null
  appliedTargetKnowledge: boolean | null
  matchedTargetModel: boolean | null
  independentCompletion: boolean
  usedHint: boolean
  evidence: string[]
  tagEvidence: PracticeTagEvidence[]
  bundleEvidence: PracticeBundleEvidence
  explanation: string
  overallConfidence: number
  requiresReview: boolean
  userConfirmed: boolean
}

export interface SubjectivePracticeGradingInput {
  subject: string
  statementMarkdown: string
  canonicalAnswer: string
  canonicalSolution: string
  rubric: { criteria: string[]; maxScore: number }
  studentAnswer: StructuredStudentAnswer
  targetTags: ReviewTag[]
  skillBundleId: string | null
  difficulty: DifficultyLevel
  sourceType: PracticeItem['sourceType']
  usedHint: boolean
}

export function gradingRequiresReview(result: Pick<PracticeGradingResult, 'correctness' | 'overallConfidence' | 'tagEvidence'>) {
  return result.correctness === 'needs_review'
    || result.overallConfidence < PRACTICE_GRADING_AUTO_APPLY_CONFIDENCE
    || result.tagEvidence.some((entry) => entry.result !== 'insufficient'
      && entry.confidence < PRACTICE_GRADING_AUTO_APPLY_CONFIDENCE)
}

export function normalizePracticeGradingResult(
  value: PracticeGradingResult,
  context?: Pick<PracticeItem, 'targetSkillBundleId' | 'difficulty' | 'sourceType'>,
): PracticeGradingResult {
  const legacy = value as PracticeGradingResult & Partial<PracticeGradingResult>
  const overallConfidence = Number.isFinite(legacy.overallConfidence)
    ? Math.min(1, Math.max(0, legacy.overallConfidence))
    : legacy.requiresReview ? 0 : 1
  const normalized: PracticeGradingResult = {
    ...value,
    modelRunId: legacy.modelRunId ?? null,
    processComplete: legacy.processComplete ?? false,
    firstErrorStep: legacy.firstErrorStep ?? null,
    errorCategory: legacy.errorCategory ?? null,
    errorReason: legacy.errorReason ?? null,
    correctAlternativeStep: legacy.correctAlternativeStep ?? null,
    usedTargetMethod: legacy.usedTargetMethod ?? null,
    appliedTargetKnowledge: legacy.appliedTargetKnowledge ?? null,
    matchedTargetModel: legacy.matchedTargetModel ?? null,
    independentCompletion: legacy.independentCompletion ?? true,
    usedHint: legacy.usedHint ?? false,
    evidence: Array.isArray(legacy.evidence) ? legacy.evidence : [],
    tagEvidence: Array.isArray(legacy.tagEvidence) ? legacy.tagEvidence : [],
    bundleEvidence: legacy.bundleEvidence ?? {
      skillBundleId: context?.targetSkillBundleId ?? null,
      result: 'insufficient', transfer: context?.sourceType === 'generated_variant',
      difficulty: context?.difficulty ?? 'basic', confidence: 0,
    },
    explanation: legacy.explanation ?? '',
    overallConfidence,
    requiresReview: Boolean(legacy.requiresReview),
    userConfirmed: Boolean(legacy.userConfirmed),
  }
  normalized.requiresReview = normalized.requiresReview || gradingRequiresReview(normalized)
  return normalized
}

function normalized(value: string) {
  let result = value.trim().toLowerCase()
    .replace(/[−–—]/g, '-').replace(/[＋﹢]/g, '+')
    .replace(/\\left|\\right|\\,|\\!|\\;|\\quad/g, '')
    .replace(/\\times|\\cdot/g, '*').replace(/\\div/g, '/')
    .replace(/\\geq|≥/g, '>=').replace(/\\leq|≤/g, '<=')
    .replace(/\*\*|\\\(|\\\)|\\text\{[^}]*\}|[$。；;]/g, '')
    .replace(/²/g, '^2').replace(/³/g, '^3')
  for (let index = 0; index < 6; index += 1) {
    const next = result.replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, '(($1)/($2))')
    if (next === result) break
    result = next
  }
  return result.replace(/\\[a-z]+/g, '').replace(/\s+/g, '')
}

function numericValue(value: string): number | null {
  const candidate = normalized(value)
    .replace(/^.*?=/, '')
    .replace(/\(|\)/g, '')
    .replace(/^-\(([-+]?\d+(?:\.\d+)?)\)\/(?:\(([-+]?\d+(?:\.\d+)?)\))$/, '-$1/$2')
  if (/^[-+]?\d+(?:\.\d+)?$/.test(candidate)) return Number(candidate)
  const fraction = candidate.match(/^([-+]?\d+(?:\.\d+)?)\/([-+]?\d+(?:\.\d+)?)$/)
  if (!fraction || Number(fraction[2]) === 0) return null
  return Number(fraction[1]) / Number(fraction[2])
}

class ExpressionParser {
  private position = 0
  private readonly source: string
  private readonly variable: string
  private readonly value: number
  constructor(source: string, variable: string, value: number) {
    this.source = source; this.variable = variable; this.value = value
  }
  parse() { const result = this.sum(); return this.position === this.source.length && Number.isFinite(result) ? result : null }
  private sum(): number { let value = this.product(); while (this.peek() === '+' || this.peek() === '-') { const op = this.take(); const right = this.product(); value = op === '+' ? value + right : value - right } return value }
  private product(): number { let value = this.power(); while (this.peek() === '*' || this.peek() === '/') { const op = this.take(); const right = this.power(); value = op === '*' ? value * right : value / right } return value }
  private power(): number { let value = this.unary(); if (this.peek() === '^') { this.take(); value **= this.power() } return value }
  private unary(): number { if (this.peek() === '+') { this.take(); return this.unary() } if (this.peek() === '-') { this.take(); return -this.unary() } return this.atom() }
  private atom(): number {
    if (this.peek() === '(') { this.take(); const value = this.sum(); if (this.take() !== ')') return Number.NaN; return value }
    if (this.source.startsWith(this.variable, this.position)) { this.position += this.variable.length; return this.value }
    const match = this.source.slice(this.position).match(/^\d+(?:\.\d+)?/)
    if (!match) return Number.NaN
    this.position += match[0].length
    return Number(match[0])
  }
  private peek() { return this.source[this.position] }
  private take() { return this.source[this.position++] }
}

function expressionSource(value: string) {
  return normalized(value)
    .replace(/(\d|[a-z]|\))(?=([a-z]|\())/g, '$1*')
    .replace(/\)(?=\d)/g, ')*')
}

export function mathematicallyEquivalent(left: string, right: string) {
  if (normalized(left) === normalized(right)) return true
  const leftNumeric = numericValue(left); const rightNumeric = numericValue(right)
  if (leftNumeric !== null && rightNumeric !== null) return Math.abs(leftNumeric - rightNumeric) <= 1e-9
  const leftSource = expressionSource(left); const rightSource = expressionSource(right)
  const variables = [...new Set(`${leftSource}${rightSource}`.match(/[a-z]/g) ?? [])]
  if (variables.length !== 1 || /[<>=]/.test(`${leftSource}${rightSource}`)) return false
  let compared = 0
  for (const sample of [-3, -1.5, -.5, .5, 2, 5]) {
    const leftValue = new ExpressionParser(leftSource, variables[0], sample).parse()
    const rightValue = new ExpressionParser(rightSource, variables[0], sample).parse()
    if (leftValue === null || rightValue === null) return false
    if (Math.abs(leftValue - rightValue) > 1e-7 * Math.max(1, Math.abs(leftValue), Math.abs(rightValue))) return false
    compared += 1
  }
  return compared >= 4
}

function relation(value: string) {
  const cleaned = normalized(value)
  const matches = [...cleaned.matchAll(/([a-z])([<>]=?)/g)]
  const match = matches.at(-1)
  if (!match || match.index === undefined) return null
  const tail = cleaned.slice(match.index + match[0].length)
  const boundary = tail.match(/^-?\(*\d+(?:\.\d+)?\)*(?:\/\(*\d+(?:\.\d+)?\)*)?/)?.[0]
  return boundary ? { variable: match[1], operator: match[2], boundary } : null
}

function equivalentRelation(left: string, right: string) {
  const a = relation(left); const b = relation(right)
  return Boolean(a && b && a.variable === b.variable && a.operator === b.operator
    && numericValue(a.boundary) !== null && numericValue(b.boundary) !== null
    && Math.abs(numericValue(a.boundary)! - numericValue(b.boundary)!) <= 1e-9)
}

function objectiveTagEvidence(item: PracticeItem, correct: boolean, processComplete: boolean): PracticeTagEvidence[] {
  return item.targetTags.flatMap((tag) => {
    if (!tag.id || tag.type === 'error') return []
    const canJudgeFromFinalAnswer = tag.type === 'knowledge'
    const result: PracticeTagEvidenceResult = canJudgeFromFinalAnswer
      ? (correct ? 'demonstrated' : 'contradicted')
      : processComplete && correct ? 'demonstrated' : 'insufficient'
    return [{
      tagId: tag.id,
      tagType: tag.type,
      result,
      confidence: canJudgeFromFinalAnswer ? .98 : result === 'demonstrated' ? .82 : .96,
      evidence: canJudgeFromFinalAnswer
        ? (correct ? '最终答案与标准答案数学等价。' : '最终答案与标准答案不等价。')
        : result === 'demonstrated' ? '作答过程完整且最终答案正确。' : '只有最终答案，无法判断方法或题型模型。',
      weight: canJudgeFromFinalAnswer ? .8 : result === 'demonstrated' ? .65 : 0,
    }]
  })
}

function result(item: PracticeItem, correct: boolean, method: PracticeGradingMethod, evidence: string, answer: StructuredStudentAnswer): PracticeGradingResult {
  const processComplete = answer.steps.length > 1
  const tagEvidence = objectiveTagEvidence(item, correct, processComplete)
  const grading: PracticeGradingResult = {
    modelRunId: null,
    correctness: correct ? 'correct' : 'incorrect', score: correct ? 100 : 0, method,
    processComplete, firstErrorStep: correct ? null : Math.max(1, answer.steps.length),
    errorCategory: correct ? null : 'answer_mismatch',
    errorReason: correct ? null : '最终答案与标准答案不等价。',
    correctAlternativeStep: correct ? null : '请从最后一个可确认步骤重新核对运算或代数变形。',
    usedTargetMethod: processComplete ? correct : null,
    appliedTargetKnowledge: correct,
    matchedTargetModel: processComplete ? correct : null,
    independentCompletion: true, usedHint: false, evidence: [evidence], tagEvidence,
    bundleEvidence: {
      skillBundleId: item.targetSkillBundleId,
      result: correct && processComplete ? 'demonstrated' : correct ? 'insufficient' : 'contradicted',
      transfer: item.sourceType === 'generated_variant', difficulty: item.difficulty,
      confidence: processComplete ? .9 : .78,
    },
    explanation: correct ? '学生答案与标准答案在数学意义上等价。' : '学生答案与标准答案不等价。',
    overallConfidence: .98, requiresReview: false, userConfirmed: false,
  }
  grading.requiresReview = gradingRequiresReview(grading)
  return grading
}

export function gradePracticeAnswer(item: PracticeItem, answer: StructuredStudentAnswer): PracticeGradingResult {
  const student = answer.rawMarkdown
  if (!student.trim() || /未检测到作答内容/.test(student)) return result(item, false, 'expression', '未检测到有效作答', answer)
  if (item.options?.length) {
    const expected = normalized(item.canonicalAnswer).match(/[a-z]/)?.[0] ?? normalized(item.canonicalAnswer)
    const actual = normalized(student).match(/[a-z]/)?.[0] ?? normalized(student)
    return result(item, actual === expected, 'choice', `选择 ${actual.toUpperCase()}，标准答案 ${expected.toUpperCase()}`, answer)
  }
  const booleans = new Map([['正确', true], ['对', true], ['true', true], ['错误', false], ['错', false], ['false', false]])
  const expectedBoolean = booleans.get(normalized(item.canonicalAnswer)); const actualBoolean = booleans.get(normalized(student))
  if (expectedBoolean !== undefined && actualBoolean !== undefined) return result(item, expectedBoolean === actualBoolean, 'boolean', '判断题直接比较', answer)
  if (numericValue(student) !== null && numericValue(item.canonicalAnswer) !== null) return result(item, mathematicallyEquivalent(student, item.canonicalAnswer), 'numeric', '数值按分数/小数等价比较', answer)
  if (equivalentRelation(student, item.canonicalAnswer)) return result(item, true, 'expression', '不等式变量、方向与边界等价', answer)
  if (mathematicallyEquivalent(student, item.canonicalAnswer)) return result(item, true, 'expression', '表达式在多个合法取样点恒等', answer)
  if (answer.steps.length > 1 || item.gradingRubric.criteria.length > 1) {
    return {
      modelRunId: null,
      correctness: 'needs_review', score: null, method: 'subjective_ai', processComplete: false,
      firstErrorStep: null, errorCategory: null, errorReason: null, correctAlternativeStep: null,
      usedTargetMethod: null, appliedTargetKnowledge: null, matchedTargetModel: null,
      independentCompletion: true, usedHint: false,
      evidence: [...item.gradingRubric.criteria], tagEvidence: [],
      bundleEvidence: { skillBundleId: item.targetSkillBundleId, result: 'insufficient', transfer: item.sourceType === 'generated_variant', difficulty: item.difficulty, confidence: 0 },
      explanation: '该题包含过程性评分要求，需要按标准解与 rubric 逐步检查。',
      overallConfidence: 0, requiresReview: true, userConfirmed: false,
    }
  }
  return result(item, false, 'expression', '可判定表达式不等价', answer)
}

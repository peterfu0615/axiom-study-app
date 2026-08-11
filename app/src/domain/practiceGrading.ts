import type { PracticeItem } from './practice'

export interface StructuredStudentAnswer {
  rawMarkdown: string
  steps: Array<{ index: number; contentMarkdown: string }>
  source: 'ai' | 'user'
}

export type PracticeCorrectness = 'correct' | 'incorrect' | 'partial' | 'needs_review'
export type PracticeGradingMethod = 'choice' | 'boolean' | 'numeric' | 'expression' | 'subjective_ai' | 'manual'

export interface PracticeGradingResult {
  correctness: PracticeCorrectness
  score: number | null
  method: PracticeGradingMethod
  errorCategory: string | null
  evidence: string[]
  explanation: string
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

function result(correct: boolean, method: PracticeGradingMethod, evidence: string): PracticeGradingResult {
  return {
    correctness: correct ? 'correct' : 'incorrect', score: correct ? 100 : 0, method,
    errorCategory: correct ? null : 'answer_mismatch', evidence: [evidence],
    explanation: correct ? '学生答案与标准答案在数学意义上等价。' : '学生答案与标准答案不等价。',
    requiresReview: false, userConfirmed: false,
  }
}

export function gradePracticeAnswer(item: PracticeItem, answer: StructuredStudentAnswer): PracticeGradingResult {
  const student = answer.rawMarkdown
  if (!student.trim() || /未检测到作答内容/.test(student)) return result(false, 'expression', '未检测到有效作答')
  if (item.options?.length) {
    const expected = normalized(item.canonicalAnswer).match(/[a-z]/)?.[0] ?? normalized(item.canonicalAnswer)
    const actual = normalized(student).match(/[a-z]/)?.[0] ?? normalized(student)
    return result(actual === expected, 'choice', `选择 ${actual.toUpperCase()}，标准答案 ${expected.toUpperCase()}`)
  }
  const booleans = new Map([['正确', true], ['对', true], ['true', true], ['错误', false], ['错', false], ['false', false]])
  const expectedBoolean = booleans.get(normalized(item.canonicalAnswer)); const actualBoolean = booleans.get(normalized(student))
  if (expectedBoolean !== undefined && actualBoolean !== undefined) return result(expectedBoolean === actualBoolean, 'boolean', '判断题直接比较')
  if (numericValue(student) !== null && numericValue(item.canonicalAnswer) !== null) return result(mathematicallyEquivalent(student, item.canonicalAnswer), 'numeric', '数值按分数/小数等价比较')
  if (equivalentRelation(student, item.canonicalAnswer)) return result(true, 'expression', '不等式变量、方向与边界等价')
  if (mathematicallyEquivalent(student, item.canonicalAnswer)) return result(true, 'expression', '表达式在多个合法取样点恒等')
  if (answer.steps.length > 1 || item.gradingRubric.criteria.length > 1) {
    return { correctness: 'needs_review', score: null, method: 'subjective_ai', errorCategory: null,
      evidence: [...item.gradingRubric.criteria], explanation: '该题包含过程性评分要求，需要按标准解与 rubric 逐步检查。', requiresReview: true, userConfirmed: false }
  }
  return result(false, 'expression', '可判定表达式不等价')
}

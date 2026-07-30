import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv'
import type {
  ExplainResult,
  ReasoningAnalysis,
  ReasoningStepEvaluation,
  StudentAttempt,
  StudentAttemptStep,
} from '../domain/models'
import {
  explainSelectionJSONSchema,
  reasoningAnalysisJSONSchema,
  studentAttemptJSONSchema,
  type ExplainSelectionJSON,
  type ReasoningAnalysisJSON,
  type StudentAttemptJSON,
} from './intelligenceContract'

const ajv = new Ajv({ allErrors: true, strict: false })
const validateStudentAttempt = ajv.compile(studentAttemptJSONSchema)
const validateReasoningAnalysis = ajv.compile(reasoningAnalysisJSONSchema)
const validateExplainSelection = ajv.compile(explainSelectionJSONSchema)

export class IntelligenceParseError extends Error {
  readonly repairStrategy: string | null

  constructor(message: string, repairStrategy: string | null = null) {
    super(message)
    this.name = 'IntelligenceParseError'
    this.repairStrategy = repairStrategy
  }
}

function stripFence(value: string) {
  const trimmed = value.trim()
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu)
  return match ? match[1].trim() : trimmed
}

function extractObject(value: string) {
  const start = value.indexOf('{')
  if (start < 0) throw new IntelligenceParseError('模型响应中没有 JSON 对象')
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < value.length; index += 1) {
    const character = value[index]
    if (inString) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') inString = false
      continue
    }
    if (character === '"') {
      inString = true
      continue
    }
    if (character === '{') depth += 1
    if (character === '}') {
      depth -= 1
      if (depth === 0) return value.slice(start, index + 1)
    }
  }
  return value.slice(start)
}

function removeTrailingCommas(value: string) {
  let output = ''
  let inString = false
  let escaped = false
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    if (inString) {
      output += character
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') inString = false
      continue
    }
    if (character === '"') {
      inString = true
      output += character
      continue
    }
    if (character === ',') {
      let next = index + 1
      while (/\s/u.test(value[next] ?? '')) next += 1
      if (value[next] === '}' || value[next] === ']') continue
    }
    output += character
  }
  return output
}

function closeContainers(value: string) {
  const stack: string[] = []
  let inString = false
  let escaped = false
  for (const character of value) {
    if (inString) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') inString = false
      continue
    }
    if (character === '"') {
      inString = true
      continue
    }
    if (character === '{' || character === '[') stack.push(character)
    if (character === '}' || character === ']') {
      const expected = character === '}' ? '{' : '['
      if (stack.pop() !== expected) {
        throw new IntelligenceParseError('模型 JSON 的括号顺序无效')
      }
    }
  }
  if (inString) {
    throw new IntelligenceParseError('模型 JSON 在字符串中被截断，无法安全修复')
  }
  return value + stack.reverse().map((item) => (item === '{' ? '}' : ']')).join('')
}

function schemaMessage(errors: ErrorObject[] | null | undefined) {
  return (errors ?? [])
    .slice(0, 4)
    .map((error) => `${error.instancePath || '/'} ${error.message ?? '无效'}`)
    .join('；')
}

function parseJSON(rawOutput: string, validate: ValidateFunction) {
  const strategies: string[] = []
  let candidate = rawOutput.trim()
  const unfenced = stripFence(candidate)
  if (unfenced !== candidate) strategies.push('strip-markdown-fence')
  candidate = unfenced
  let parsed: unknown
  try {
    parsed = JSON.parse(candidate)
  } catch {
    const extracted = extractObject(candidate)
    if (extracted !== candidate) strategies.push('extract-json-object')
    const withoutTrailing = removeTrailingCommas(extracted)
    if (withoutTrailing !== extracted) strategies.push('remove-trailing-commas')
    const completed = closeContainers(withoutTrailing)
    if (completed !== withoutTrailing) strategies.push('complete-containers')
    try {
      parsed = JSON.parse(completed)
    } catch (error) {
      throw new IntelligenceParseError(
        `无法解析模型 JSON：${String(error)}`,
        strategies.length ? strategies.join(',') : null,
      )
    }
  }
  if (!validate(parsed)) {
    throw new IntelligenceParseError(
      `模型 JSON 不符合 Schema：${schemaMessage(validate.errors)}`,
      strategies.length ? strategies.join(',') : null,
    )
  }
  return { value: parsed, repairStrategy: strategies.length ? strategies.join(',') : null }
}

function normalizeSteps(value: StudentAttemptJSON) {
  const steps: StudentAttemptStep[] = value.steps.map((step) => ({
    index: step.index,
    contentMarkdown: step.content_markdown,
    confidence: step.confidence,
  }))
  if (steps.some((step, index) => step.index !== index + 1)) {
    throw new IntelligenceParseError('学生解答 steps.index 必须从 1 连续递增')
  }
  return steps
}

export function parseStudentAttempt(rawOutput: string): {
  attempt: Pick<StudentAttempt, 'rawMarkdown' | 'steps'>
  repairStrategy: string | null
} {
  const parsed = parseJSON(rawOutput, validateStudentAttempt)
  const value = parsed.value as StudentAttemptJSON
  return {
    attempt: {
      rawMarkdown: value.raw_markdown,
      steps: normalizeSteps(value),
    },
    repairStrategy: parsed.repairStrategy,
  }
}

export function parseReasoningAnalysis(rawOutput: string): {
  analysis: Pick<
    ReasoningAnalysis,
    | 'approach'
    | 'stepEvaluations'
    | 'firstWrongStep'
    | 'errorType'
    | 'reason'
    | 'knowledgeGaps'
    | 'suggestion'
  >
  repairStrategy: string | null
} {
  const parsed = parseJSON(rawOutput, validateReasoningAnalysis)
  const value = parsed.value as ReasoningAnalysisJSON
  const stepEvaluations: ReasoningStepEvaluation[] = value.step_evaluations.map(
    (step) => ({
      studentStepIndex: step.student_step_index,
      status: step.status,
      comment: step.comment,
    }),
  )
  return {
    analysis: {
      approach: value.approach,
      stepEvaluations,
      firstWrongStep: value.first_wrong_step,
      errorType: value.error_type,
      reason: value.reason,
      knowledgeGaps: value.knowledge_gaps,
      suggestion: value.suggestion,
    },
    repairStrategy: parsed.repairStrategy,
  }
}

export function parseExplainSelection(rawOutput: string): {
  result: ExplainResult
  repairStrategy: string | null
} {
  const parsed = parseJSON(rawOutput, validateExplainSelection)
  const value = parsed.value as ExplainSelectionJSON
  return {
    result: {
      explanationMarkdown: value.explanation_markdown,
      keyPoint: value.key_point,
      relatedKnowledgePoints: value.related_knowledge_points,
    },
    repairStrategy: parsed.repairStrategy,
  }
}

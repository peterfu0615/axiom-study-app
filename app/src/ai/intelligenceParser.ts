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

const ALLOWED_ERROR_TYPES = new Set<ReasoningAnalysisJSON['error_type']>([
  'concept_error',
  'calculation_error',
  'formula_error',
  'logic_gap',
  'reading_error',
  'incomplete_solution',
  'no_error',
  'unknown',
  null,
])

const ERROR_TYPE_ALIASES: Record<string, ReasoningAnalysisJSON['error_type']> = {
  concept: 'concept_error',
  concept_error: 'concept_error',
  conceptual: 'concept_error',
  calculation: 'calculation_error',
  calculation_error: 'calculation_error',
  arithmetic: 'calculation_error',
  compute_error: 'calculation_error',
  formula: 'formula_error',
  formula_error: 'formula_error',
  formula_mistake: 'formula_error',
  logic: 'logic_gap',
  logic_gap: 'logic_gap',
  logic_error: 'logic_gap',
  logical_gap: 'logic_gap',
  missing_step: 'logic_gap',
  reading: 'reading_error',
  reading_error: 'reading_error',
  misread: 'reading_error',
  incomplete: 'incomplete_solution',
  incomplete_solution: 'incomplete_solution',
  unfinished: 'incomplete_solution',
  none: 'no_error',
  no_error: 'no_error',
  correct: 'no_error',
  none_error: 'no_error',
  unknown_error: 'unknown',
  unknown: 'unknown',
  other: 'unknown',
}

function normalizeErrorType(value: unknown): ReasoningAnalysisJSON['error_type'] {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') return 'unknown'
  const key = value.trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (ALLOWED_ERROR_TYPES.has(key as ReasoningAnalysisJSON['error_type'])) {
    return key as ReasoningAnalysisJSON['error_type']
  }
  if (key in ERROR_TYPE_ALIASES) return ERROR_TYPE_ALIASES[key]
  if (key.includes('concept')) return 'concept_error'
  if (key.includes('calcul') || key.includes('arith') || key.includes('compute')) return 'calculation_error'
  if (key.includes('formula')) return 'formula_error'
  if (key.includes('logic') || key.includes('missing')) return 'logic_gap'
  if (key.includes('read') || key.includes('misread')) return 'reading_error'
  if (key.includes('incomplete') || key.includes('unfinished')) return 'incomplete_solution'
  if (key.includes('no_error') || key.includes('correct') || key.includes('none')) return 'no_error'
  return 'unknown'
}

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

function parseJSON(rawOutput: string, validate: ValidateFunction, normalize?: (value: unknown) => unknown) {
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
  parsed = normalize ? normalize(parsed) : parsed
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
  const parsed = parseJSON(rawOutput, validateStudentAttempt, (input) => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return input
    const source = { ...(input as Record<string, unknown>) }
    if (Array.isArray(source.steps)) source.steps = source.steps.map((step) => {
      if (!step || typeof step !== 'object' || Array.isArray(step)) return step
      const copy = { ...(step as Record<string, unknown>) }
      delete copy.confidence
      return copy
    })
    return source
  })
  const value = parsed.value as StudentAttemptJSON
  return {
    attempt: {
      rawMarkdown: value.raw_markdown,
      steps: normalizeSteps(value),
    },
    repairStrategy: parsed.repairStrategy,
  }
}

export function sanitizeAIOutputText(text: string | null | undefined): string {
  if (!text) return ''
  let cleaned = text.trim()

  // 检测垃圾字符串的起始位置（可能出现多次或在不同位置）
  const trashPatterns = [
    /gaps_placeholder/i,
    /field_must_match_schema/i,
    /_name_gaps_/i,
    /_array_type_check_/i,
    /_is_knowledge_gaps_/i,
    /knowledge_gaps_field_below/i,
    /_field_is_knowledge_gaps_/i,
    /_field_is_array_of_strings_/i,
    // 覆盖 AI 元评论变体
    /format is correct/i,
    /properly handled/i,
    /no errors?\s*\.?\s*no_error/i,
    /strictly adheres to requirements/i,
    /shelter\/knowledge_gaps/i,
    /no control tokens/i,
    /parseable json/i,
    /raw json string/i,
    /outside fences/i,
    /json block/i,
    /let me (re-?generate|make sure|continue|finish)/i,
    /wait,? let'?s/i,
    /schema_name/i,
  ]

  let earliestCut = -1
  for (const pattern of trashPatterns) {
    const match = cleaned.match(pattern)
    if (match && match.index !== undefined) {
      if (earliestCut === -1 || match.index < earliestCut) {
        earliestCut = match.index
      }
    }
  }

  if (earliestCut >= 0) {
    // 往前找，如果前面是 / 或 _ 或空格，也一起截掉
    let cutStart = earliestCut
    while (cutStart > 0 && /[\/_\s]/.test(cleaned[cutStart - 1])) {
      cutStart -= 1
    }
    cleaned = cleaned.slice(0, cutStart).trim()
  }

  return cleaned
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
  // 预解析：在 schema 校验前对 error_type 做归一化，
  // 容忍模型返回的变体（如 concept、calculation、Chinese 名称等）。
  const preStrategies: string[] = []
  let preCandidate = rawOutput.trim()
  const preUnfenced = stripFence(preCandidate)
  if (preUnfenced !== preCandidate) {
    preCandidate = preUnfenced
    preStrategies.push('strip-markdown-fence')
  }
  let preParsed: unknown
  try {
    preParsed = JSON.parse(preCandidate)
  } catch {
    const extracted = extractObject(preCandidate)
    if (extracted !== preCandidate) preStrategies.push('extract-json-object')
    const withoutTrailing = removeTrailingCommas(extracted)
    if (withoutTrailing !== extracted) preStrategies.push('remove-trailing-commas')
    const completed = closeContainers(withoutTrailing)
    if (completed !== withoutTrailing) preStrategies.push('complete-containers')
    try {
      preParsed = JSON.parse(completed)
    } catch (error) {
      throw new IntelligenceParseError(
        `无法解析模型 JSON：${String(error)}`,
        preStrategies.length ? preStrategies.join(',') : null,
      )
    }
  }

  // 对 error_type 做归一化（在 schema 校验前）
  if (preParsed && typeof preParsed === 'object' && !Array.isArray(preParsed)) {
    const obj = preParsed as Record<string, unknown>
    if (
      'error_type' in obj &&
      !ALLOWED_ERROR_TYPES.has(obj.error_type as ReasoningAnalysisJSON['error_type'])
    ) {
      const original = obj.error_type
      const mapped = normalizeErrorType(original)
      obj.error_type = mapped
      if (String(mapped) !== String(original)) {
        preStrategies.push(`normalize-error_type:${String(original)}→${String(mapped)}`)
      }
    }
  }

  // 用已修复+归一化的对象重新序列化，交给 parseJSON 做最终校验
  const jsonString =
    preParsed && typeof preParsed === 'object' ? JSON.stringify(preParsed) : preCandidate
  const parsed = parseJSON(jsonString, validateReasoningAnalysis)
  const value = parsed.value as ReasoningAnalysisJSON
  const stepEvaluations: ReasoningStepEvaluation[] = value.step_evaluations.map(
    (step) => ({
      studentStepIndex: step.student_step_index,
      status: step.status,
      comment: sanitizeAIOutputText(step.comment),
    }),
  )
  const mergedStrategies = [
    ...new Set([
      ...preStrategies,
      ...(parsed.repairStrategy ? parsed.repairStrategy.split(',') : []),
    ]),
  ]
  const cleanedGaps = (value.knowledge_gaps ?? [])
    .map(sanitizeAIOutputText)
    .filter((gap) => gap.length > 0 && !/gaps_placeholder|schema_name|type_check/i.test(gap))

  return {
    analysis: {
      approach: sanitizeAIOutputText(value.approach),
      stepEvaluations,
      firstWrongStep: value.first_wrong_step,
      errorType: value.error_type,
      reason: sanitizeAIOutputText(value.reason),
      knowledgeGaps: cleanedGaps,
      suggestion: sanitizeAIOutputText(value.suggestion),
    },
    repairStrategy: mergedStrategies.length ? mergedStrategies.join(',') : null,
  }
}

const JSON_ESCAPE_SEQUENCES: Record<string, string> = {
  '"': '"',
  '\\': '\\',
  '/': '/',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
}

/**
 * 从流式累积的部分（或完整）JSON 文本中尽力提取指定字段的字符串值。
 * 用于「向我解释」流式期在 JSON 尚未接收完整时先行渲染正文，
 * 避免把原始 JSON（转义符、字段名）直接暴露给用户。
 *
 * 容错策略：
 *   - 字段尚未到达 / 输入不是对象文本 → 返回 null（调用方退回占位提示）；
 *   - 字符串值被截断（未收到结束引号）→ 返回已接收的部分，实现渐进显示；
 *   - 转义序列被截断（孤立的反斜杠、不完整的 \\uXXXX）或遇到非法转义
 *     → 丢弃残缺转义并返回此前已解析的部分；
 *   - 任何异常一律吞掉并返回 null，本函数绝不抛错。
 */
export function extractPartialField(accumulated: string, field: string): string | null {
  try {
    if (!accumulated || !field) return null
    const escapedField = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const keyPattern = new RegExp(`"${escapedField}"\\s*:\\s*"`, 'u')
    const keyMatch = keyPattern.exec(accumulated)
    if (!keyMatch) return null

    let index = keyMatch.index + keyMatch[0].length
    let value = ''
    while (index < accumulated.length) {
      const character = accumulated[index]
      if (character === '"') return value
      if (character !== '\\') {
        value += character
        index += 1
        continue
      }
      const next = accumulated[index + 1]
      if (next === undefined) return value
      if (next === 'u') {
        const hex = accumulated.slice(index + 2, index + 6)
        if (!/^[0-9a-fA-F]{4}$/u.test(hex)) return value
        value += String.fromCodePoint(Number.parseInt(hex, 16))
        index += 6
        continue
      }
      const mapped = JSON_ESCAPE_SEQUENCES[next]
      if (mapped === undefined) return value
      value += mapped
      index += 2
    }
    return value
  } catch {
    return null
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
      explanationMarkdown: sanitizeAIOutputText(value.explanation_markdown),
      keyPoint: sanitizeAIOutputText(value.key_point),
      relatedKnowledgePoints: value.related_knowledge_points
        .map(sanitizeAIOutputText)
        .filter((point) => point.length > 0),
    },
    repairStrategy: parsed.repairStrategy,
  }
}

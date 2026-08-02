import type { ErrorObject } from 'ajv'
import { normalizeAIProblemAnalysis } from '../domain/ai'
import type { AIProblemAnalysis } from '../domain/models'
import validateProblemAnalysis from './generated/problemAnalysisValidator.js'

export interface ParsedProblemAnalysis {
  analysis: AIProblemAnalysis
  repairStrategy: string | null
}

export class ProblemAnalysisParseError extends Error {
  readonly repairStrategy: string | null

  constructor(message: string, repairStrategy: string | null = null) {
    super(message)
    this.name = 'ProblemAnalysisParseError'
    this.repairStrategy = repairStrategy
  }
}

function stripMarkdownFence(value: string) {
  const trimmed = value.trim()
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu)
  return match ? match[1].trim() : trimmed
}

function extractJSONObject(value: string) {
  const start = value.indexOf('{')
  if (start < 0) throw new ProblemAnalysisParseError('模型响应中没有 JSON 对象')
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

function closeTruncatedContainers(value: string) {
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
    if (character === '{' || character === '[') {
      stack.push(character)
      continue
    }
    if (character === '}' || character === ']') {
      const expected = character === '}' ? '{' : '['
      if (stack.pop() !== expected) {
        throw new ProblemAnalysisParseError('模型 JSON 的括号顺序无效')
      }
    }
  }
  if (inString) {
    throw new ProblemAnalysisParseError('模型 JSON 在字符串中被截断，无法安全修复')
  }
  return value + stack.reverse().map((item) => (item === '{' ? '}' : ']')).join('')
}

function canonicalizeAnalysis(value: unknown) {
  const source =
    value && typeof value === 'object'
      ? { ...(value as Record<string, unknown>) }
      : {}
  const aliases: Record<string, string[]> = {
    problem_type: ['problemType'],
    stem_markdown: ['stemMarkdown'],
    sub_questions: ['subQuestions'],
    knowledge_points: ['knowledgePoints'],
    knowledge_tags: ['knowledgeTags'],
    method_tags: ['methodTags'],
    model_tags: ['modelTags'],
    error_categories: ['errorCategories'],
    textbook_hint: ['textbookHint'],
  }
  for (const [canonical, candidates] of Object.entries(aliases)) {
    if (source[canonical] !== undefined) continue
    const alias = candidates.find((candidate) => source[candidate] !== undefined)
    if (alias) {
      source[canonical] = source[alias]
      delete source[alias]
    }
  }
  const defaults: Record<string, unknown> = {
    title: null,
    subject: null,
    problem_type: null,
    stem_markdown: null,
    choices: [],
    sub_questions: [],
    diagram: null,
    knowledge_points: [],
    knowledge_tags: [],
    method_tags: [],
    model_tags: [],
    difficulty: null,
    error_categories: [],
    textbook_hint: null,
    confidence: null,
    warnings: [],
  }
  for (const [key, fallback] of Object.entries(defaults)) {
    if (source[key] === undefined) source[key] = fallback
  }
  if (
    source.diagram !== null &&
    (typeof source.diagram !== 'object' || Array.isArray(source.diagram))
  ) {
    source.diagram = null
    const warnings = Array.isArray(source.warnings) ? source.warnings : []
    source.warnings = [...warnings, '模型图形字段格式异常，已降级为 null']
  }
  if (source.diagram && typeof source.diagram === 'object') {
    const diagram = { ...(source.diagram as Record<string, unknown>) }
    if (diagram.kind === undefined) diagram.kind = null
    source.diagram = diagram
  }
  if (source.textbook_hint && typeof source.textbook_hint === 'object' && !Array.isArray(source.textbook_hint)) {
    const hint = { ...(source.textbook_hint as Record<string, unknown>) }
    for (const key of ['title', 'grade', 'volume', 'publisher', 'edition']) {
      if (hint[key] === undefined) hint[key] = null
    }
    if (hint.confidence === undefined) hint.confidence = 0
    if (hint.evidence === undefined) hint.evidence = ''
    source.textbook_hint = hint
  }
  return source
}

function normalizeDiagramBBoxArray(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { value, repaired: false, degraded: false }
  }
  const source = value as Record<string, unknown>
  const diagramValue = source.diagram
  if (
    !diagramValue ||
    typeof diagramValue !== 'object' ||
    Array.isArray(diagramValue)
  ) {
    return { value, repaired: false, degraded: false }
  }
  const diagram = diagramValue as Record<string, unknown>
  const bbox = diagram.bbox
  if (bbox === null || bbox === undefined) {
    return { value, repaired: false, degraded: false }
  }
  if (Array.isArray(bbox)) {
    if (
      bbox.length !== 4 ||
      !bbox.every(
        (coordinate) =>
          typeof coordinate === 'number' &&
          Number.isFinite(coordinate) &&
          coordinate >= 0 &&
          coordinate <= 1,
      )
    ) {
      return {
        value: {
          ...source,
          diagram: { ...diagram, bbox: null },
        },
        repaired: true,
        degraded: true,
      }
    }
    const [x, y, width, height] = bbox
    return {
      value: {
        ...source,
        diagram: {
          ...diagram,
          bbox: { x, y, width, height },
        },
      },
      repaired: true,
      degraded: false,
    }
  }
  if (typeof bbox !== 'object' || Array.isArray(bbox)) {
    return {
      value: {
        ...source,
        diagram: { ...diagram, bbox: null },
      },
      repaired: true,
      degraded: true,
    }
  }
  const bboxObject = bbox as Record<string, unknown>
  const keys = ['x', 'y', 'width', 'height'] as const
  const hasValidCoordinates = keys.every((key) => {
    const coordinate = bboxObject[key]
    return (
      typeof coordinate === 'number' &&
      Number.isFinite(coordinate) &&
      coordinate >= 0 &&
      coordinate <= 1
    )
  })
  if (!hasValidCoordinates) {
    return {
      value: {
        ...source,
        diagram: { ...diagram, bbox: null },
      },
      repaired: true,
      degraded: true,
    }
  }
  if (Object.keys(bboxObject).some((key) => !keys.includes(key as typeof keys[number]))) {
    return {
      value: {
        ...source,
        diagram: {
          ...diagram,
          bbox: {
            x: bboxObject.x,
            y: bboxObject.y,
            width: bboxObject.width,
            height: bboxObject.height,
          },
        },
      },
      repaired: true,
      degraded: false,
    }
  }
  return {
    value,
    repaired: false,
    degraded: false,
  }
}

function schemaErrorMessage(errors: ErrorObject[] | null | undefined) {
  return (errors ?? [])
    .slice(0, 4)
    .map((error) => `${error.instancePath || '/'} ${error.message ?? '无效'}`)
    .join('；')
}

export interface ProblemAnalysisDifficultyNormalization {
  value: unknown
  repairStrategy: string | null
  warnings: string[]
}

/**
 * `difficulty.score` is a useful auxiliary measurement, but it must not make
 * an otherwise complete problem unusable.  Keep the strict schema for the
 * core fields and repair only the score shape immediately before validation.
 */
export function normalizeProblemAnalysisDifficultyScore(
  value: unknown,
): ProblemAnalysisDifficultyNormalization {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { value, repairStrategy: null, warnings: [] }
  }
  const source = value as Record<string, unknown>
  const difficulty = source.difficulty
  if (difficulty === null || difficulty === undefined) {
    return { value, repairStrategy: null, warnings: [] }
  }
  if (typeof difficulty !== 'object' || Array.isArray(difficulty)) {
    return { value, repairStrategy: null, warnings: [] }
  }

  const candidate = difficulty as Record<string, unknown>
  const hasOwnScore = Object.prototype.hasOwnProperty.call(candidate, 'score')
  const warningFor = (message: string) => {
    if (Array.isArray(source.warnings)) return [...source.warnings, message]
    if (source.warnings === undefined) return [message]
    // Keep an invalid warnings field intact so the strict schema still rejects
    // it; this compatibility repair must not hide an unrelated schema error.
    return source.warnings
  }

  if (!hasOwnScore) {
    return {
      value: {
        ...source,
        difficulty: { ...candidate, score: null },
        warnings: warningFor('模型未返回难度分数，已保留为空'),
      },
      repairStrategy: 'normalize-missing-difficulty-score',
      warnings: ['模型未返回难度分数，已保留为空'],
    }
  }

  const score = candidate.score
  if (
    score === null ||
    (typeof score === 'number' && Number.isFinite(score) && score >= 0 && score <= 1)
  ) {
    return { value, repairStrategy: null, warnings: [] }
  }

  return {
    value: {
      ...source,
      difficulty: { ...candidate, score: null },
      warnings: warningFor('模型返回的难度分数无效，已保留为空'),
    },
    repairStrategy: 'normalize-invalid-difficulty-score',
    warnings: ['模型返回的难度分数无效，已保留为空'],
  }
}

export function parseProblemAnalysis(rawOutput: string): ParsedProblemAnalysis {
  const strategies: string[] = []
  let candidate = rawOutput.trim()
  const withoutFence = stripMarkdownFence(candidate)
  if (withoutFence !== candidate) strategies.push('strip-markdown-fence')
  candidate = withoutFence

  let parsed: unknown
  try {
    parsed = JSON.parse(candidate)
  } catch {
    const extracted = extractJSONObject(candidate)
    if (extracted !== candidate) strategies.push('extract-json-object')
    const withoutTrailingCommas = removeTrailingCommas(extracted)
    if (withoutTrailingCommas !== extracted) strategies.push('remove-trailing-commas')
    const completed = closeTruncatedContainers(withoutTrailingCommas)
    if (completed !== withoutTrailingCommas) strategies.push('complete-containers')
    try {
      parsed = JSON.parse(completed)
    } catch (error) {
      throw new ProblemAnalysisParseError(
        `无法解析模型 JSON：${String(error)}`,
        strategies.length ? strategies.join(',') : null,
      )
    }
  }

  const difficultyNormalization = normalizeProblemAnalysisDifficultyScore(parsed)
  if (difficultyNormalization.repairStrategy) {
    strategies.push(difficultyNormalization.repairStrategy)
    parsed = difficultyNormalization.value
  }

  const bboxNormalization = normalizeDiagramBBoxArray(parsed)
  if (bboxNormalization.repaired) {
    strategies.push('normalize-diagram-bbox-array')
    const repaired = bboxNormalization.value as Record<string, unknown>
    if (repaired.diagram && typeof repaired.diagram === 'object') {
      const diagram = repaired.diagram as Record<string, unknown>
      const warnings = bboxNormalization.degraded
        ? Array.isArray(repaired.warnings)
          ? [...repaired.warnings, '模型图形边界格式异常，已降级为 null']
          : ['模型图形边界格式异常，已降级为 null']
        : repaired.warnings
      parsed = { ...repaired, diagram, warnings }
    } else {
      parsed = repaired
    }
  }

  if (!validateProblemAnalysis(parsed)) {
    const canonical = canonicalizeAnalysis(parsed)
    if (JSON.stringify(canonical) !== JSON.stringify(parsed)) {
      strategies.push('canonicalize-schema-fields')
      parsed = canonical
    }
  }
  if (!validateProblemAnalysis(parsed)) {
    throw new ProblemAnalysisParseError(
      `模型 JSON 不符合 Schema：${schemaErrorMessage(validateProblemAnalysis.errors)}`,
      strategies.length ? strategies.join(',') : null,
    )
  }

  return {
    analysis: normalizeAIProblemAnalysis(parsed),
    repairStrategy: strategies.length ? strategies.join(',') : null,
  }
}

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
    warnings: [],
  }
  for (const [key, fallback] of Object.entries(defaults)) {
    if (source[key] === undefined) source[key] = fallback
  }
  const repairWarnings = Array.isArray(source.warnings)
    ? source.warnings.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
    : []
  const warn = (message: string) => {
    if (!repairWarnings.includes(message)) repairWarnings.push(message)
  }

  for (const key of ['title', 'subject', 'problem_type', 'stem_markdown']) {
    if (source[key] !== null && typeof source[key] !== 'string') {
      source[key] = null
      warn(`模型 ${key} 字段格式异常，已忽略`)
    }
  }
  if (!Array.isArray(source.choices)) {
    source.choices = []
    warn('模型选项字段格式异常，已忽略')
  } else {
    const original = source.choices
    const normalized = original.flatMap((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return []
      const candidate = item as Record<string, unknown>
      return typeof candidate.label === 'string' && candidate.label.trim() &&
        typeof candidate.text === 'string' && candidate.text.trim()
        ? [{ label: candidate.label.trim(), text: candidate.text.trim() }]
        : []
    })
    source.choices = normalized
    if (normalized.length !== original.length) warn('部分选项格式异常，已忽略无效项')
  }
  if (!Array.isArray(source.sub_questions)) {
    source.sub_questions = []
    warn('模型小问字段格式异常，已忽略')
  } else {
    const original = source.sub_questions
    const normalized = original.flatMap((item, position) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return []
      const candidate = item as Record<string, unknown>
      const content = candidate.content ?? candidate.text
      const index = Number(candidate.index)
      return typeof content === 'string' && content.trim()
        ? [{ index: Number.isInteger(index) && index > 0 ? index : position + 1, content: content.trim() }]
        : []
    })
    source.sub_questions = normalized
    if (normalized.length !== original.length || original.some((item) => Boolean(item && typeof item === 'object' && !Array.isArray(item) && 'text' in item))) {
      warn('部分小问字段已安全修复或忽略')
    }
  }
  if (source.diagram !== null && (typeof source.diagram !== 'object' || Array.isArray(source.diagram))) {
    source.diagram = null
    warn('模型图形字段格式异常，已降级为 null')
  }
  if (source.diagram && typeof source.diagram === 'object') {
    const candidate = source.diagram as Record<string, unknown>
    const exists = candidate.exists === true
    const kind = ['geometry', 'function', 'chart', 'table', 'other'].includes(String(candidate.kind))
      ? candidate.kind : null
    const bbox = candidate.bbox && typeof candidate.bbox === 'object' && !Array.isArray(candidate.bbox)
      ? candidate.bbox : null
    source.diagram = { exists, kind: exists ? kind : null, bbox: exists ? bbox : null }
    if (exists && (!kind || !bbox)) warn('模型图形类型或边界不完整，已保留可用部分')
  }
  if (source.textbook_hint && typeof source.textbook_hint === 'object' && !Array.isArray(source.textbook_hint)) {
    const hint = source.textbook_hint as Record<string, unknown>
    source.textbook_hint = {
      title: typeof hint.title === 'string' ? hint.title : null,
      grade: typeof hint.grade === 'string' ? hint.grade : null,
      volume: typeof hint.volume === 'string' ? hint.volume : null,
      publisher: typeof hint.publisher === 'string' ? hint.publisher : null,
      edition: typeof hint.edition === 'string' ? hint.edition : null,
      evidence: typeof hint.evidence === 'string' ? hint.evidence : '',
    }
  } else if (source.textbook_hint !== null) {
    source.textbook_hint = null
    warn('模型教材线索格式异常，已忽略')
  }

  if (!Array.isArray(source.knowledge_points)) source.knowledge_points = []
  else source.knowledge_points = source.knowledge_points.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map((item) => item.trim())

  const sourceAliases: Record<string, 'problem' | 'solution' | 'student_attempt' | 'textbook_hint'> = {
    problem: 'problem', '题面': 'problem', '整题': 'problem', solution: 'solution', '解题': 'solution',
    student_attempt: 'student_attempt', '学生作答': 'student_attempt', textbook_hint: 'textbook_hint', '教材': 'textbook_hint',
  }
  for (const key of ['knowledge_tags', 'unresolved_knowledge_candidates', 'method_tags', 'model_tags', 'error_categories']) {
    if (!Array.isArray(source[key])) { source[key] = []; warn(`模型 ${key} 字段格式异常，已忽略`); continue }
    const original = source[key] as unknown[]
    const usedLegacyShape = original.some((item) => typeof item === 'string' || Boolean(item && typeof item === 'object' && !Array.isArray(item) && ('primary' in item || 'secondary' in item)))
    const normalized = original.flatMap((item) => {
      const candidate = typeof item === 'string' ? { name: item } :
        item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : null
      if (!candidate || typeof candidate.name !== 'string' || !candidate.name.trim()) return []
      const sourceValue = typeof candidate.source === 'string' ? candidate.source : ''
      const normalizedSource = sourceAliases[sourceValue] ?? 'problem'
      const canonicalTagId = candidate.canonical_tag_id ?? candidate.canonicalTagId
      return [{
        canonical_tag_id: typeof canonicalTagId === 'string' && canonicalTagId.trim()
          ? canonicalTagId.trim() : null,
        name: candidate.name.trim(),
        role: candidate.role === 'primary' || candidate.primary === true ? 'primary' : 'secondary',
        evidence: typeof candidate.evidence === 'string' ? candidate.evidence : '',
        source: normalizedSource,
      }]
    })
    source[key] = normalized
    if (normalized.length !== original.length || usedLegacyShape) {
      warn(`部分 ${key} 标签已安全修复或忽略`)
    }
  }
  if (source.difficulty && typeof source.difficulty === 'object' && !Array.isArray(source.difficulty)) {
    const difficulty = source.difficulty as Record<string, unknown>
    if (['basic', 'intermediate', 'advanced'].includes(String(difficulty.level))) {
      source.difficulty = {
        level: difficulty.level,
        score: typeof difficulty.score === 'number' && Number.isFinite(difficulty.score) && difficulty.score >= 0 && difficulty.score <= 1 ? difficulty.score : null,
        reason: typeof difficulty.reason === 'string' ? difficulty.reason : '',
      }
    } else { source.difficulty = null; warn('模型难度字段格式异常，已忽略') }
  } else if (source.difficulty !== null) {
    source.difficulty = null
    warn('模型难度字段格式异常，已忽略')
  }
  source.warnings = repairWarnings
  const allowed = new Set([...Object.keys(defaults), 'unresolved_knowledge_candidates'])
  for (const key of Object.keys(source)) if (!allowed.has(key)) delete source[key]
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

  const analysis = normalizeAIProblemAnalysis(parsed)
  if (!analysis.stemMarkdown.trim() && analysis.subQuestions.length === 0) {
    throw new ProblemAnalysisParseError(
      '模型 JSON 不符合 Schema：/stem_markdown 与 /sub_questions 均没有可读题目内容',
      strategies.length ? strategies.join(',') : null,
    )
  }
  return {
    analysis,
    repairStrategy: strategies.length ? strategies.join(',') : null,
  }
}

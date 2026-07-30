import type { ErrorObject } from 'ajv'
import type { GeneratedSolution, SolutionStep } from '../domain/models'
import validateSolution from './generated/solutionValidator.js'

export interface ParsedSolution {
  solution: GeneratedSolution
  repairStrategy: string | null
}

export class SolutionParseError extends Error {
  readonly repairStrategy: string | null

  constructor(message: string, repairStrategy: string | null = null) {
    super(message)
    this.name = 'SolutionParseError'
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
  if (start < 0) throw new SolutionParseError('模型响应中没有 JSON 对象')
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
        throw new SolutionParseError('模型 JSON 的括号顺序无效')
      }
    }
  }
  if (inString) {
    throw new SolutionParseError('模型 JSON 在字符串中被截断，无法安全修复')
  }
  return value + stack.reverse().map((item) => (item === '{' ? '}' : ']')).join('')
}

function canonicalizeSolution(value: unknown) {
  const source =
    value && typeof value === 'object' && !Array.isArray(value)
      ? { ...(value as Record<string, unknown>) }
      : {}
  const aliases: Record<string, string[]> = {
    content_markdown: ['contentMarkdown'],
    key_method: ['keyMethod'],
    used_formulas: ['usedFormulas'],
    knowledge_points: ['knowledgePoints'],
  }
  for (const [canonical, candidates] of Object.entries(aliases)) {
    if (source[canonical] !== undefined) continue
    const alias = candidates.find((candidate) => source[candidate] !== undefined)
    if (alias) {
      source[canonical] = source[alias]
      delete source[alias]
    }
  }
  if (source.key_method === undefined) source.key_method = null
  if (source.used_formulas === undefined) source.used_formulas = []
  if (source.knowledge_points === undefined) source.knowledge_points = []
  if (Array.isArray(source.steps)) {
    source.steps = source.steps.map((step) => {
      if (!step || typeof step !== 'object' || Array.isArray(step)) return step
      const normalized = { ...(step as Record<string, unknown>) }
      if (
        normalized.content_markdown === undefined &&
        normalized.contentMarkdown !== undefined
      ) {
        normalized.content_markdown = normalized.contentMarkdown
        delete normalized.contentMarkdown
      }
      return normalized
    })
  }
  return source
}

function schemaErrorMessage(errors: ErrorObject[] | null | undefined) {
  return (errors ?? [])
    .slice(0, 4)
    .map((error) => `${error.instancePath || '/'} ${error.message ?? '无效'}`)
    .join('；')
}

function normalizeStep(step: Record<string, unknown>): SolutionStep {
  return {
    index: Number(step.index),
    title: String(step.title),
    contentMarkdown: String(step.content_markdown),
  }
}

export function parseSolution(rawOutput: string): ParsedSolution {
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
    if (withoutTrailingCommas !== extracted) {
      strategies.push('remove-trailing-commas')
    }
    const completed = closeTruncatedContainers(withoutTrailingCommas)
    if (completed !== withoutTrailingCommas) {
      strategies.push('complete-containers')
    }
    try {
      parsed = JSON.parse(completed)
    } catch (error) {
      throw new SolutionParseError(
        `无法解析 Solution JSON：${String(error)}`,
        strategies.length ? strategies.join(',') : null,
      )
    }
  }

  if (!validateSolution(parsed)) {
    const canonical = canonicalizeSolution(parsed)
    if (JSON.stringify(canonical) !== JSON.stringify(parsed)) {
      strategies.push('canonicalize-solution-fields')
      parsed = canonical
    }
  }
  if (!validateSolution(parsed)) {
    throw new SolutionParseError(
      `Solution JSON 不符合 Schema：${schemaErrorMessage(validateSolution.errors)}`,
      strategies.length ? strategies.join(',') : null,
    )
  }

  const value = parsed as Record<string, unknown>
  const steps = (value.steps as Record<string, unknown>[]).map(normalizeStep)
  if (steps.some((step, index) => step.index !== index + 1)) {
    throw new SolutionParseError(
      'Solution steps.index 必须从 1 连续递增',
      strategies.length ? strategies.join(',') : null,
    )
  }
  return {
    solution: {
      contentMarkdown: String(value.content_markdown),
      steps,
      keyMethod:
        value.key_method === null ? null : String(value.key_method),
      usedFormulas: (value.used_formulas as unknown[]).map(String),
      knowledgePoints: (value.knowledge_points as unknown[]).map(String),
    },
    repairStrategy: strategies.length ? strategies.join(',') : null,
  }
}

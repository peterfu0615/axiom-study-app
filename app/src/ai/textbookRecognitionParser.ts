import type { TextbookMetadataField, TextbookRecognition } from '../domain/horizon'

export class TextbookRecognitionParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TextbookRecognitionParseError'
  }
}

function extractJSONObject(value: string) {
  const trimmed = value.trim().replace(/^```(?:json)?\s*|\s*```$/giu, '')
  const start = trimmed.indexOf('{')
  if (start < 0) throw new TextbookRecognitionParseError('教材识别结果中没有 JSON 对象')
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < trimmed.length; index += 1) {
    const character = trimmed[index]
    if (inString) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') inString = false
      continue
    }
    if (character === '"') inString = true
    else if (character === '{') depth += 1
    else if (character === '}') {
      depth -= 1
      if (depth === 0) return trimmed.slice(start, index + 1)
    }
  }
  throw new TextbookRecognitionParseError('教材识别 JSON 不完整')
}

function field(value: unknown): TextbookMetadataField {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  const raw = source.value
  const name = typeof raw === 'string' && raw.trim() ? raw.trim() : null
  const confidence = typeof source.confidence === 'number' && Number.isFinite(source.confidence)
    ? Math.min(1, Math.max(0, source.confidence))
    : 0
  return {
    value: name,
    confidence,
    evidence: typeof source.evidence === 'string' ? source.evidence.trim() : '',
  }
}

export function parseTextbookRecognition(rawOutput: string): TextbookRecognition {
  let parsed: unknown
  try {
    parsed = JSON.parse(extractJSONObject(rawOutput))
  } catch (error) {
    if (error instanceof TextbookRecognitionParseError) throw error
    throw new TextbookRecognitionParseError(`教材识别结果不是有效 JSON：${String(error)}`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TextbookRecognitionParseError('教材识别结果必须是对象')
  }
  const value = parsed as Record<string, unknown>
  const overallConfidence = typeof value.overall_confidence === 'number' && Number.isFinite(value.overall_confidence)
    ? Math.min(1, Math.max(0, value.overall_confidence))
    : 0
  return {
    title: field(value.title),
    subject: field(value.subject),
    grade: field(value.grade),
    volume: field(value.volume),
    publisher: field(value.publisher),
    edition: field(value.edition),
    overallConfidence,
    warnings: Array.isArray(value.warnings)
      ? value.warnings.filter((warning): warning is string => typeof warning === 'string')
      : [],
  }
}

import type {
  AIDiagramKind,
  AIChoice,
  AIDifficulty,
  AIProblemAnalysis,
  AISubQuestion,
  AITagCandidate,
  NormalizedRect,
} from './models'

const DIAGRAM_KINDS = new Set<AIDiagramKind>([
  'geometry',
  'function',
  'chart',
  'table',
  'other',
  'unknown',
])

function normalizeDiagramKind(
  value: unknown,
  hasDiagram: boolean,
): AIDiagramKind {
  if (!hasDiagram) return 'unknown'
  const normalized = asString(value).toLowerCase() as AIDiagramKind
  return DIAGRAM_KINDS.has(normalized) ? normalized : 'unknown'
}

function asString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function clampUnit(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.min(1, Math.max(0, number)) : 0
}

function normalizeTagCandidates(value: unknown): AITagCandidate[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const candidate = item as Record<string, unknown>
    const name = asString(candidate.name)
    if (!name) return []
    const source = asString(candidate.source)
    return [{
      name,
      role: candidate.role === 'primary' ? 'primary' : 'secondary',
      confidence: clampUnit(candidate.confidence),
      evidence: asString(candidate.evidence),
      source: ['solution', 'student_attempt', 'textbook_hint'].includes(source)
        ? source as AITagCandidate['source']
        : 'problem',
    }]
  })
}

function normalizeDifficulty(value: unknown): AIDifficulty | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Record<string, unknown>
  const level = asString(candidate.level)
  if (!['basic', 'intermediate', 'advanced'].includes(level)) return null
  const rawScore = candidate.score
  return {
    level: level as AIDifficulty['level'],
    score: typeof rawScore === 'number' && Number.isFinite(rawScore)
      ? clampUnit(rawScore)
      : null,
    confidence: clampUnit(candidate.confidence),
    reason: asString(candidate.reason),
  }
}

function normalizeBBox(value: unknown, addSafetyMargin = false): NormalizedRect {
  const candidate =
    value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : {}
  const x = clampUnit(candidate.x)
  const y = clampUnit(candidate.y)
  const width = Math.min(1 - x, clampUnit(candidate.width))
  const height = Math.min(1 - y, clampUnit(candidate.height))
  if (!addSafetyMargin || width <= 0 || height <= 0) {
    return { x, y, width, height }
  }
  const margin = 0.02
  const paddedX = Math.max(0, x - margin)
  const paddedY = Math.max(0, y - margin)
  return {
    x: paddedX,
    y: paddedY,
    width: Math.min(1 - paddedX, width + x - paddedX + margin),
    height: Math.min(1 - paddedY, height + y - paddedY + margin),
  }
}

function normalizeChoices(value: unknown): AIChoice[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  return value
    .map((choice): AIChoice | null => {
      if (!choice || typeof choice !== 'object') return null
      const item = choice as Record<string, unknown>
      const label = asString(item.label).toUpperCase()
      const text = asString(item.text)
      if (!/^[A-Z]$/.test(label) || !text || seen.has(label)) return null
      seen.add(label)
      return { label, text }
    })
    .filter((choice): choice is AIChoice => choice !== null)
}

function normalizeSubQuestions(value: unknown): AISubQuestion[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<number>()
  return value
    .map((question, position): AISubQuestion | null => {
      if (!question || typeof question !== 'object') return null
      const item = question as Record<string, unknown>
      const parsedIndex = Number(item.index)
      const index =
        Number.isInteger(parsedIndex) && parsedIndex > 0
          ? parsedIndex
          : position + 1
      const content = asString(item.content)
      if (!content || seen.has(index)) return null
      seen.add(index)
      return { index, content }
    })
    .filter((question): question is AISubQuestion => question !== null)
    .sort((left, right) => left.index - right.index)
}

function removeDuplicatedChoices(stem: string, choices: AIChoice[]) {
  if (choices.length < 2 || !stem) return stem
  const labels = new Set(choices.map((choice) => choice.label))
  const matches = [
    ...stem.matchAll(
      /(^|\n|\s{2,})[（(]?\s*([A-Z])\s*[）).．、:：]\s*/gim,
    ),
  ].filter((match) => labels.has(match[2].toUpperCase()))
  if (new Set(matches.map((match) => match[2].toUpperCase())).size < 2) {
    return stem
  }
  const first = matches[0]
  return stem.slice(0, first.index).trim()
}

function compactTitleText(value: string) {
  return value
    .replace(/^\s*(?:第\s*)?\d+\s*[.．、题]\s*/u, '')
    .replace(/[（(]\s*\d+\s*分\s*[）)]/gu, '')
    .replace(/\s+/gu, '')
    .replace(/[·•|｜/—–_]+/gu, '-')
    .replace(/-{2,}/gu, '-')
    .replace(/^-|-$/gu, '')
}

function fitTitleParts(parts: string[], maximumLength = 16) {
  let output = ''
  for (const part of parts.map(compactTitleText).filter(Boolean)) {
    const separator = output ? '-' : ''
    const remaining = maximumLength - Array.from(output + separator).length
    if (remaining <= 0) break
    const next = Array.from(part).slice(0, remaining).join('')
    output += separator + next
    if (next.length < part.length) break
  }
  return output
}

export function normalizeAIProblemTitle(
  value: unknown,
  problemType: string,
  knowledgePoints: string[],
  stemMarkdown: string,
) {
  const proposed = compactTitleText(asString(value))
  const plainStem = stemMarkdown
    .replace(/[$\\{}_*#>`~()[\]，。！？：；、\s]/gu, '')
    .toLowerCase()
  const plainTitle = proposed.replace(/[-，。！？：；、\s]/gu, '').toLowerCase()
  const directlyCopied =
    plainTitle.length >= 8 && plainStem.includes(plainTitle)
  const fallbackParts = [
    knowledgePoints[0] ?? '',
    problemType,
    knowledgePoints[1] ?? '',
  ]
  if (!proposed || directlyCopied) return fitTitleParts(fallbackParts)
  return fitTitleParts(proposed.split('-'))
}

export function normalizeAIProblemAnalysis(
  value: unknown,
): AIProblemAnalysis {
  const candidate =
    value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : {}
  const choices = normalizeChoices(candidate.choices)
  const knowledgePoints =
    candidate.knowledgePoints ?? candidate.knowledge_points
  const normalizedKnowledgePoints = Array.isArray(knowledgePoints)
    ? knowledgePoints.map(asString).filter(Boolean)
    : []
  const diagram =
    candidate.diagram && typeof candidate.diagram === 'object'
      ? (candidate.diagram as Record<string, unknown>)
      : null
  const hasDiagram = Boolean(
    diagram?.exists ?? candidate.hasDiagram ?? candidate.has_diagram,
  )
  const stemMarkdown = removeDuplicatedChoices(
    asString(candidate.stemMarkdown ?? candidate.stem_markdown),
    choices,
  )
  const problemType = asString(
    candidate.problemType ?? candidate.problem_type,
  )

  return {
    title: normalizeAIProblemTitle(
      candidate.title,
      problemType,
      normalizedKnowledgePoints,
      stemMarkdown,
    ),
    subject: asString(candidate.subject),
    problemType,
    stemMarkdown,
    choices,
    subQuestions: normalizeSubQuestions(
      candidate.subQuestions ?? candidate.sub_questions,
    ),
    hasDiagram,
    diagramKind: normalizeDiagramKind(
      diagram?.kind ?? candidate.diagramKind ?? candidate.diagram_kind,
      hasDiagram,
    ),
    diagramBBox: normalizeBBox(
      diagram?.bbox ?? candidate.diagramBBox ?? candidate.diagram_bbox,
      hasDiagram,
    ),
    knowledgePoints: normalizedKnowledgePoints,
    knowledgeTags: normalizeTagCandidates(
      candidate.knowledgeTags ?? candidate.knowledge_tags,
    ),
    methodTags: normalizeTagCandidates(
      candidate.methodTags ?? candidate.method_tags,
    ),
    modelTags: normalizeTagCandidates(
      candidate.modelTags ?? candidate.model_tags,
    ),
    difficulty: normalizeDifficulty(candidate.difficulty),
    errorCategories: normalizeTagCandidates(
      candidate.errorCategories ?? candidate.error_categories,
    ),
    confidence: clampUnit(candidate.confidence),
    warnings: Array.isArray(candidate.warnings)
      ? candidate.warnings.map(asString).filter(Boolean)
      : [],
  }
}

export function resolveProblemField(
  userValue: string | null | undefined,
  aiValue: string | null | undefined,
  ocrValue: string | null | undefined,
) {
  if (userValue !== null && userValue !== undefined) return userValue
  if (aiValue !== null && aiValue !== undefined) return aiValue
  return ocrValue ?? null
}

import { describe, expect, it } from 'vitest'
import {
  parseProblemAnalysis,
  ProblemAnalysisParseError,
} from './problemAnalysisParser'

const valid = {
  title: '分式-选择题-化简',
  subject: '数学',
  problem_type: '选择题',
  stem_markdown: '化简 $\\frac{x}{2}$。',
  choices: [{ label: 'A', text: '$\\frac{1}{2}$' }],
  sub_questions: [],
  diagram: { exists: false, kind: null, bbox: null },
  knowledge_points: ['分式'],
  knowledge_tags: [{
    name: '分式',
    role: 'primary',
    confidence: 0.93,
    evidence: '题干要求化简分式',
    source: 'problem',
  }],
  method_tags: [],
  model_tags: [],
  difficulty: {
    level: 'basic',
    score: 0.2,
    confidence: 0.8,
    reason: '直接应用分式化简规则',
  },
  error_categories: [],
  textbook_hint: null,
  confidence: 0.9,
  warnings: [],
}

describe('parseProblemAnalysis', () => {
  it('accepts a valid schema object without repair', () => {
    const parsed = parseProblemAnalysis(JSON.stringify(valid))
    expect(parsed.analysis.title).toBe(valid.title)
    expect(parsed.repairStrategy).toBeNull()
  })

  it('normalizes an optional textbook hint without requiring a second AI call', () => {
    const parsed = parseProblemAnalysis(JSON.stringify({
      ...valid,
      textbook_hint: {
        title: '数学八年级下册',
        grade: '八年级',
        volume: '下册',
        publisher: '人民教育出版社',
        edition: '2022年版',
        confidence: 0.82,
        evidence: '题面页眉明确写出教材册别',
      },
    }))
    expect(parsed.analysis.textbookHint?.volume).toBe('下册')
    expect(parsed.analysis.textbookHint?.confidence).toBeCloseTo(0.82)
  })

  it('keeps compatibility with older output that has no textbook hint', () => {
    const legacy = { ...valid }
    delete (legacy as { textbook_hint?: unknown }).textbook_hint
    const parsed = parseProblemAnalysis(JSON.stringify(legacy))
    expect(parsed.analysis.textbookHint).toBeNull()
  })

  it('fills nullable textbook hint fields when a provider returns a partial object', () => {
    const parsed = parseProblemAnalysis(JSON.stringify({
      ...valid,
      textbook_hint: { grade: '八年级' },
    }))
    expect(parsed.analysis.textbookHint).toEqual(expect.objectContaining({
      title: null,
      grade: '八年级',
      confidence: 0,
      evidence: '',
    }))
  })

  it('extracts fenced JSON and removes trailing commas', () => {
    const raw = `说明文字\n\`\`\`json\n${JSON.stringify(valid).replace(
      /}$/,
      ',}',
    )}\n\`\`\`\n额外说明`
    const parsed = parseProblemAnalysis(raw)
    expect(parsed.analysis.choices).toHaveLength(1)
    expect(parsed.repairStrategy).toContain('extract-json-object')
    expect(parsed.repairStrategy).toContain('remove-trailing-commas')
  })

  it('completes safely truncated arrays and objects', () => {
    const raw = JSON.stringify(valid).slice(0, -2)
    const parsed = parseProblemAnalysis(raw)
    expect(parsed.analysis.subject).toBe('数学')
    expect(parsed.repairStrategy).toContain('complete-containers')
  })

  it('fills missing top-level fields with nullable compatibility values', () => {
    const parsed = parseProblemAnalysis('{"stemMarkdown":"题干"}')
    expect(parsed.analysis.stemMarkdown).toBe('题干')
    expect(parsed.analysis.subQuestions).toEqual([])
    expect(parsed.repairStrategy).toContain('canonicalize-schema-fields')
  })

  it('normalizes an Antigravity bbox tuple to the schema object shape', () => {
    const parsed = parseProblemAnalysis(
      JSON.stringify({
        ...valid,
        diagram: {
          exists: true,
          kind: 'geometry',
          bbox: [0.1, 0.2, 0.3, 0.4],
        },
      }),
    )
    expect(parsed.analysis.diagramBBox.x).toBeCloseTo(0.08)
    expect(parsed.analysis.diagramBBox.y).toBeCloseTo(0.18)
    expect(parsed.analysis.diagramBBox.width).toBeCloseTo(0.34)
    expect(parsed.analysis.diagramBBox.height).toBeCloseTo(0.44)
    expect(parsed.analysis.warnings.join('')).not.toContain('降级为 null')
    expect(parsed.repairStrategy).toBe('normalize-diagram-bbox-array')
  })

  it('removes extra bbox fields without rejecting otherwise valid bounds', () => {
    const parsed = parseProblemAnalysis(
      JSON.stringify({
        ...valid,
        diagram: {
          exists: true,
          kind: 'function',
          bbox: { x: 0.1, y: 0.2, width: 0.3, height: 0.4, label: 'graph' },
        },
      }),
    )
    expect(parsed.analysis.diagramKind).toBe('function')
    expect(parsed.analysis.diagramBBox.width).toBeCloseTo(0.34)
    expect(parsed.analysis.warnings.join('')).not.toContain('降级为 null')
  })

  it('degrades malformed bbox tuples to null with a warning', () => {
    const parsed = parseProblemAnalysis(
      JSON.stringify({
        ...valid,
        diagram: {
          exists: true,
          kind: 'geometry',
          bbox: [0.1, 0.2, 0.3],
        },
      }),
    )
    expect(parsed.analysis.diagramBBox.width).toBe(0)
    expect(parsed.analysis.warnings.join('')).toContain('边界格式异常')
  })

  it('rejects schema violations instead of fabricating content', () => {
    expect(() =>
      parseProblemAnalysis(
        JSON.stringify({ ...valid, confidence: 2, choices: 'A' }),
      ),
    ).toThrow(ProblemAnalysisParseError)
  })

  it('rejects an unterminated JSON string', () => {
    expect(() => parseProblemAnalysis('{"title":"未完成')).toThrow(
      '字符串中被截断',
    )
  })
})

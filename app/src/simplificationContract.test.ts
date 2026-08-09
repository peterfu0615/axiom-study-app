import { describe, expect, it } from 'vitest'
// @ts-expect-error Vitest executes this contract in Node, while the app tsconfig is browser-only.
import { readFileSync } from 'node:fs'
import { parseProblemAnalysis } from './ai/problemAnalysisParser'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

describe('confidence-free active contracts', () => {
  it('does not ask new problem or textbook runs for confidence fields', () => {
    const problemSchema = read('./ai/problemAnalysis.schema.json')
    const textbookSchema = read('./ai/textbookRecognition.schema.json')
    const studentContract = read('./ai/intelligenceContract.ts')
    expect(problemSchema).not.toContain('"confidence"')
    expect(textbookSchema).not.toContain('"confidence"')
    expect(textbookSchema).not.toContain('"overall_confidence"')
    expect(studentContract).not.toContain("required: ['index', 'content_markdown', 'confidence']")
  })

  it('reads historical problem output but drops every legacy confidence field', () => {
    const parsed = parseProblemAnalysis(JSON.stringify({
      title: '历史题目', subject: '数学', problem_type: '解答题', stem_markdown: '题干',
      choices: [], sub_questions: [], diagram: null, knowledge_points: [],
      knowledge_tags: [{ name: '一次函数', role: 'primary', confidence: .98, evidence: '题干', source: 'problem' }],
      method_tags: [], model_tags: [], difficulty: null, error_categories: [],
      confidence: .95, warnings: [],
    }))
    expect(parsed.analysis).not.toHaveProperty('confidence')
    expect(parsed.analysis.knowledgeTags?.[0]).not.toHaveProperty('confidence')
  })
})

describe('simplified tag and responsive UI contract', () => {
  it('does not expose mapping or confidence language in ProblemTags', () => {
    const source = read('./features/library/ProblemTags.tsx')
    expect(source).not.toMatch(/置信度|未映射|选择对应标签|AI 标签映射结果/u)
    expect(source).toContain('keepProblemTag')
    expect(source).toContain('保留')
  })

  it('reflows from component width and constrains every long-content layer', () => {
    const css = read('./features/library/ProblemTags.css')
    expect(css).toContain('container-type: inline-size')
    expect(css).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))')
    expect(css).toContain('@container problem-tags')
    expect(css).toContain('.controlled-problem-tag__heading')
    expect(css).toContain('overflow-wrap: anywhere')
  })

  it('centers a bounded ErrorState while preserving left-aligned copy', () => {
    const css = read('./components/ui/ui.css')
    expect(css).toContain('width: min(100%, var(--ax-state-panel-max))')
    expect(css).toContain('margin-inline: auto')
    expect(css).toContain('text-align: left')
    expect(css).toContain('.ax-error-state code { display: block; max-width: 100%')
  })
})

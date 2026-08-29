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

describe('autonomous compact tag UI contract', () => {
  it('exposes only tag results and icon actions in ProblemTags', () => {
    const source = read('./features/library/ProblemTags.tsx')
    expect(source).not.toMatch(/置信度|未映射|选择对应标签|AI 标签映射结果|AI 识别|手动添加|已确认|待处理|识别依据|选择本题教材/u)
    expect(source).toContain('className="problem-tag-add"')
    expect(source).toContain('className="problem-tag-remove"')
    expect(source).toContain('label={`添加${labels[type]}`}')
    expect(source).toContain('label={`移除${tag.canonicalName}`}')
    expect(source).toContain("label: '撤销'")
    expect(source).not.toContain('armedTagId')
    expect(source).not.toContain('再次点击确认移除')
    expect(source).not.toContain('tag.evidence')
    expect(source).not.toContain('>添加</Button>')
    expect(source).not.toContain('>移除</Button>')
  })

  it('reflows from component width and constrains every long-content layer', () => {
    const css = read('./features/library/ProblemTags.css')
    expect(css).toContain('container-type: inline-size')
    expect(css).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))')
    expect(css).toContain('@container problem-tags')
    expect(css).toContain('.problem-tag-collection { display: flex')
    expect(css).toContain('flex-wrap: wrap')
    expect(css).toContain('.controlled-problem-tag { display: inline-flex')
    expect(css).toContain('width: fit-content')
    expect(css).toContain('max-width: 100%')
    expect(css).toContain('overflow-wrap: anywhere')
    expect(css).not.toContain('.controlled-problem-tag { width: 100%')
  })

  it('centers a bounded ErrorState while preserving left-aligned copy', () => {
    const source = read('./components/ui/index.tsx')
    const css = read('./components/ui/ui.css')
    expect(source).not.toContain('{error.detailSafe}')
    expect(source).not.toContain('{error.code}')
    expect(css).toContain('width: min(100%, var(--ax-state-panel-max))')
    expect(css).toContain('margin-inline: auto')
    expect(css).toContain('text-align: left')
    expect(css).not.toContain('.ax-error-state code')
  })
})

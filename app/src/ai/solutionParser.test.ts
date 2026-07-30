import { describe, expect, it } from 'vitest'
import { SOLUTION_PROMPT } from './solutionContract'
import { parseSolution, SolutionParseError } from './solutionParser'

const valid = {
  content_markdown: String.raw`$$\because AB=AC\therefore \angle B=\angle C$$`,
  steps: [
    {
      index: 1,
      title: '利用等腰三角形性质',
      content_markdown: String.raw`$$\because AB=AC\therefore \angle B=\angle C$$`,
    },
  ],
  key_method: '等腰三角形性质',
  used_formulas: [String.raw`\angle B=\angle C`],
  knowledge_points: ['等腰三角形'],
}

describe('parseSolution', () => {
  it('accepts a complete geometry solution', () => {
    const parsed = parseSolution(JSON.stringify(valid))
    expect(parsed.solution.steps).toHaveLength(1)
    expect(parsed.solution.contentMarkdown).toContain(String.raw`\because`)
    expect(parsed.repairStrategy).toBeNull()
  })

  it('repairs fenced JSON, aliases, trailing commas, and optional fields', () => {
    const raw = `说明\n\`\`\`json
${JSON.stringify({
  contentMarkdown: valid.content_markdown,
  steps: [
    {
      index: 1,
      title: '函数变形',
      contentMarkdown: String.raw`$$y=(x-1)^2-1$$`,
    },
  ],
}).replace(/}$/, ',}')}
\`\`\``
    const parsed = parseSolution(raw)
    expect(parsed.solution.keyMethod).toBeNull()
    expect(parsed.solution.usedFormulas).toEqual([])
    expect(parsed.repairStrategy).toContain('extract-json-object')
    expect(parsed.repairStrategy).toContain('remove-trailing-commas')
    expect(parsed.repairStrategy).toContain('canonicalize-solution-fields')
  })

  it('safely completes truncated containers', () => {
    const parsed = parseSolution(JSON.stringify(valid).slice(0, -2))
    expect(parsed.solution.knowledgePoints).toEqual(['等腰三角形'])
    expect(parsed.repairStrategy).toContain('complete-containers')
  })

  it('rejects empty steps and discontinuous indexes', () => {
    expect(() =>
      parseSolution(JSON.stringify({ ...valid, steps: [] })),
    ).toThrow(SolutionParseError)
    expect(() =>
      parseSolution(
        JSON.stringify({
          ...valid,
          steps: [{ ...valid.steps[0], index: 2 }],
        }),
      ),
    ).toThrow('必须从 1 连续递增')
  })

  it('rejects invalid JSON and unterminated strings', () => {
    expect(() => parseSolution('没有结构化输出')).toThrow('没有 JSON 对象')
    expect(() => parseSolution('{"content_markdown":"未完成')).toThrow(
      '字符串中被截断',
    )
  })
})

describe('SOLUTION_PROMPT', () => {
  it('locks the mathematical writing contract', () => {
    expect(SOLUTION_PROMPT).toContain('只返回一个符合 JSON Schema')
    expect(SOLUTION_PROMPT).toContain(String.raw`\because`)
    expect(SOLUTION_PROMPT).toContain(String.raw`\therefore`)
    expect(SOLUTION_PROMPT).toContain('禁止用“因为……所以……”')
    expect(SOLUTION_PROMPT).toContain('行内公式放在 $...$')
  })
})

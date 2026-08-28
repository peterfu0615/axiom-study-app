import { describe, expect, it } from 'vitest'
import type { PracticeItem, PracticeSet } from './practice'
import {
  A4_POINTS,
  PRACTICE_LAYOUT_VERSION,
  buildCompletePracticeDocument,
  buildPracticeDocument,
  answerPolicy,
  estimateVisibleWritingUnits,
  parsePracticeInlineContent,
  parsePracticeMarkdown,
} from './practiceDocument'

const item = (index: number, difficulty: PracticeItem['difficulty'] = 'intermediate'): PracticeItem => ({
  id: `item-${index}`, practiceSetId: 'set-1', orderIndex: index, sourceType: 'existing_problem',
  sourceProblemId: `problem-${index}`, subject: '数学', targetSkillBundleId: 'bundle-1', targetTags: [], difficulty,
  statementMarkdown: `第 ${index + 1} 题：求方程 $x^2-${index + 1}=0$ 的解。`, options: null,
  canonicalAnswer: `x=±√${index + 1}`, solutionJson: '{"contentMarkdown":"移项后开平方。"}',
  gradingRubric: { criteria: ['答案正确'], maxScore: 100 }, diagramIds: [], questionImagePath: null,
  diagramImagePaths: [], generationMetadata: null, validationStatus: 'valid', createdAt: 1,
})
const set = (count: number): PracticeSet => ({
  id: 'set-1', subject: '数学', sourceType: 'review_unit', sourceRef: 'module-1', strategy: 'deterministic-v1', status: 'ready',
  targetSkills: [], generationMetadata: {}, createdAt: 1, updatedAt: 1,
  items: Array.from({ length: count }, (_, index) => item(index, index % 3 === 2 ? 'advanced' : 'intermediate')),
})

describe('PracticeDocument', () => {
  it('scales answer space by visible writing rather than TeX command length', () => {
    const short = { ...item(0), canonicalAnswer: 'x=2', solutionJson: '{"steps":[{"contentMarkdown":"代入。"}]}' }
    const fraction = { ...item(1), canonicalAnswer: String.raw`\frac{1}{2}`, solutionJson: '{"steps":[{"contentMarkdown":"通分并化简。"}]}' }
    const medium = { ...item(2), canonicalAnswer: 'x=2', solutionJson: '{"steps":[{"contentMarkdown":"移项。"},{"contentMarkdown":"合并同类项。"},{"contentMarkdown":"检验。"}]}' }
    const proof = { ...item(3, 'advanced'), statementMarkdown: '证明四边形面积关系。', canonicalAnswer: '所以结论成立。', solutionJson: '{"steps":[{"contentMarkdown":"连接辅助线。"},{"contentMarkdown":"证明两个三角形全等。"},{"contentMarkdown":"推出对应边相等。"},{"contentMarkdown":"完成证明。"}]}' }
    expect(estimateVisibleWritingUnits(String.raw`\frac{1}{2}`)).toBeLessThan(estimateVisibleWritingUnits(String.raw`\frac{123456}{789012}`))
    expect(answerPolicy(short).minimumHeightPoints).toBeLessThanOrEqual(answerPolicy(fraction).minimumHeightPoints)
    expect(answerPolicy(fraction).minimumHeightPoints).toBeLessThan(answerPolicy(medium).minimumHeightPoints)
    expect(answerPolicy(medium).minimumHeightPoints).toBeLessThanOrEqual(answerPolicy(proof).minimumHeightPoints)
    for (const candidate of [short, fraction, medium, proof]) {
      const policy = answerPolicy(candidate)
      expect(policy.minimumHeightPoints).toBeGreaterThanOrEqual(76)
      expect(policy.minimumHeightPoints).toBeLessThanOrEqual(220)
      expect(policy.lineCount).toBeGreaterThanOrEqual(3)
      expect(policy.lineCount).toBeLessThanOrEqual(12)
    }
  })

  it('preserves common LaTeX as structured math instead of printable text', () => {
    const blocks = parsePracticeMarkdown([
      '一次函数 $y=(3m+1)x-2$。',
      '',
      '几何关系：\\angle ABC，AC \\perp BD，$180^\\circ$。',
      '',
      '$$\\frac{1}{2}+\\sqrt{3}$$',
      '',
      '多项式 x^2+2x+1。',
    ].join('\n'))
    const serialized = JSON.stringify(blocks)
    expect(serialized).toContain('"kind":"inlineMath","latex":"y=(3m+1)x-2"')
    expect(serialized).toContain('"kind":"inlineMath","latex":"\\\\angle ABC"')
    expect(serialized).toContain('"kind":"inlineMath","latex":"AC \\\\perp BD"')
    expect(serialized).toContain('"kind":"inlineMath","latex":"180^\\\\circ"')
    expect(serialized).toContain('"kind":"displayMath","latex":"\\\\frac{1}{2}+\\\\sqrt{3}"')
    expect(serialized).toContain('"kind":"inlineMath","latex":"x^2+2x+1"')
    expect(blocks.flatMap((block) => block.kind === 'paragraph' ? block.content : [])
      .filter((content) => content.kind === 'text').map((content) => content.text).join(''))
      .not.toMatch(/\\(?:angle|perp|circ|frac|sqrt)\b/u)
  })

  it('keeps Chinese inside bare LaTeX text groups attached to the formula', () => {
    const content = parsePracticeInlineContent(
      String.raw`\therefore m \text{ 的取值范围是 } m > -\frac{1}{3}.`,
    )
    expect(content).toEqual([
      { kind: 'text', text: '∴ ' },
      {
        kind: 'inlineMath',
        latex: String.raw`m \text{ 的取值范围是 } m > -\frac{1}{3}.`,
      },
    ])
  })

  it('preserves adjacent display delimiters embedded in a canonical answer', () => {
    const content = parsePracticeInlineContent(
      String.raw`解不等式 $3m+1 > 0$ 得：$$3m > -1$$ $$m > -\frac{1}{3}$$ $\therefore m$ 的取值范围是 $m > -\frac{1}{3}$。`,
    )
    expect(content.filter((item) => item.kind === 'inlineMath').map((item) => item.latex)).toEqual([
      '3m+1 > 0',
      '3m > -1',
      String.raw`m > -\frac{1}{3}`,
      String.raw`\therefore m`,
      String.raw`m > -\frac{1}{3}`,
    ])
    expect(content.filter((item) => item.kind === 'text').map((item) => item.text).join('')).not.toContain('$')
  })

  it('keeps answer blanks as printable text instead of invalid math', () => {
    const content = parsePracticeInlineContent(
      String.raw`物理性质：(1)___________；显式占位：$(2)___________$；下标 $x_1$。`,
    )
    expect(content.filter((item) => item.kind === 'inlineMath')).toEqual([
      { kind: 'inlineMath', latex: 'x_1' },
    ])
    expect(content.filter((item) => item.kind === 'text').map((item) => item.text).join(''))
      .toContain('(1)___________；显式占位：(2)___________')
  })

  it('adapts one practice set into practice and solution sections with forced cover breaks', () => {
    const practiceSet = set(6)
    practiceSet.items[0].questionImagePath = '/tmp/source-question.png'
    practiceSet.items[1].diagramImagePaths = ['/tmp/diagram.svg']
    practiceSet.items[1].diagramIds = ['diagram-1']
    const document = buildCompletePracticeDocument(practiceSet, { attemptId: 'attempt-complete', generatedAt: 1_786_464_000_000 })

    expect(document.documentType).toBe('complete')
    expect(document.sections.map((section) => section.kind)).toEqual(['exercise', 'solution'])
    document.sections.forEach((section) => {
      expect(section.blocks[0]).toMatchObject({ kind: 'sectionCover', section: section.kind })
      expect(section.blocks[1]).toEqual({ kind: 'pageBreak', reason: 'cover_to_body' })
      expect(section.blocks.filter((block) => block.kind === 'question')).toHaveLength(6)
    })
    expect(JSON.stringify(document.sections[0])).not.toContain('/tmp/source-question.png')
    expect(JSON.stringify(document.sections[0])).toContain('"kind":"tikzDiagram"')
    expect(document.sections[0].blocks.flatMap((block) => block.kind === 'question' ? block.content : [])
      .filter((block) => block.kind === 'answerSpace').map((block) => block.practiceItemId))
      .toEqual(practiceSet.items.map((practiceItem) => practiceItem.id))
  })

  it('marks a verified AI variant in both printable sections without exposing target tags', () => {
    const practiceSet = set(1)
    practiceSet.items[0] = { ...practiceSet.items[0], sourceType: 'generated_variant', variantPlanId: 'plan-1' }
    const document = buildCompletePracticeDocument(practiceSet, { attemptId: 'attempt-variant', generatedAt: 1 })
    document.sections.forEach((section) => {
      const serialized = JSON.stringify(section)
      expect(serialized).toContain('AI 变式题')
      expect(serialized).not.toContain('审校')
      expect(serialized).not.toContain('targetTags')
    })
  })

  it('builds distinct quick and mock-test PDF contracts', () => {
    const standard = set(2)
    const quick = { ...set(2), sessionMode: 'quick' as const, sessionSettings: {
      mode: 'quick' as const, maxDurationSeconds: 360, includeAnswerSheet: false,
      hideSolutionsUntilSubmitted: true, showSourceLabels: true,
    } }
    const mock = { ...set(2), sessionMode: 'mock_test' as const, sessionSettings: {
      mode: 'mock_test' as const, maxDurationSeconds: 1200, includeAnswerSheet: true,
      hideSolutionsUntilSubmitted: true, showSourceLabels: false,
    } }
    expect(answerPolicy(quick.items[0], 'quick').minimumHeightPoints)
      .toBeLessThan(answerPolicy(standard.items[0], 'standard').minimumHeightPoints)
    const mockDocument = buildCompletePracticeDocument(mock, { attemptId: 'attempt-mock', generatedAt: 1 })
    expect(mockDocument.sections.map((section) => section.kind)).toEqual(['exercise', 'answer_sheet', 'solution'])
    expect(JSON.stringify(mockDocument.sections[0])).not.toContain('answerSpace')
    expect(mockDocument.sections[1].blocks.filter((block) => block.kind === 'question')).toHaveLength(2)
    expect(JSON.stringify(mockDocument.sections[1])).toContain('answerSpace')
    expect(mockDocument.metadata).toMatchObject({ sessionMode: 'mock_test', maxDurationSeconds: 1200 })
  })

  it('keeps the exercise section when solution JSON is missing or malformed', () => {
    const practiceSet = set(2)
    practiceSet.items[0] = { ...practiceSet.items[0], solutionJson: '{}' }
    practiceSet.items[1] = { ...practiceSet.items[1], canonicalAnswer: '', solutionJson: 'not-json' }
    const document = buildCompletePracticeDocument(practiceSet, { attemptId: 'attempt-degraded', generatedAt: 1 })
    const exercise = document.sections.find((section) => section.kind === 'exercise')
    const solution = document.sections.find((section) => section.kind === 'solution')
    const exerciseText = JSON.stringify(exercise)
    const solutionText = JSON.stringify(solution)

    expect(exercise?.blocks.filter((block) => block.kind === 'question')).toHaveLength(2)
    expect(exerciseText).toContain('answerSpace')
    expect(solutionText).toContain('详细解析暂不可用')
    expect(solutionText).toContain('当前题目的答案与解析暂不可用')
  })

  it('keeps stable A4 question numbering and page identity', () => {
    const left = buildPracticeDocument(set(8), { attemptId: 'attempt-1', documentType: 'questions', generatedAt: 10 })
    const right = buildPracticeDocument(set(8), { attemptId: 'attempt-1', documentType: 'questions', generatedAt: 10 })
    expect(left).toEqual(right)
    expect(left.layout).toMatchObject({ version: PRACTICE_LAYOUT_VERSION, pageSize: 'A4', widthPoints: A4_POINTS.width })
    expect(left.pages.flatMap((page) => page.questions.map((question) => question.displayNumber))).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(new Set(left.pages.map((page) => page.pageIdentity)).size).toBe(left.pages.length)
  })

  it('binds every normalized answer region to one practice item', () => {
    const document = buildPracticeDocument(set(6), { attemptId: 'attempt-answer', documentType: 'answer_sheet' })
    const regions = document.pages.flatMap((page) => page.answerRegions)
    expect(regions.map((region) => region.practiceItemId)).toEqual(set(6).items.map((practiceItem) => practiceItem.id))
    regions.forEach((region) => {
      expect(region.x + region.width).toBeLessThanOrEqual(1)
      expect(region.y + region.height).toBeLessThanOrEqual(1)
      expect(region.width * region.height).toBeGreaterThan(0)
    })
    expect(document.pages.every((page) => page.qrPayload.includes('attempt=attempt-answer'))).toBe(true)
  })
})

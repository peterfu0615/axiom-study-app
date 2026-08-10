import { describe, expect, it } from 'vitest'
import {
  normalizeAIProblemAnalysis,
  normalizeAIProblemTitle,
  resolveProblemField,
} from './ai'

describe('resolveProblemField', () => {
  it('keeps user edits above AI and OCR values', () => {
    expect(resolveProblemField('用户值', 'AI 值', 'OCR 值')).toBe(
      '用户值',
    )
    expect(resolveProblemField(null, 'AI 值', 'OCR 值')).toBe('AI 值')
    expect(resolveProblemField(null, null, 'OCR 值')).toBe('OCR 值')
  })

  it('treats an intentionally cleared user value as an override', () => {
    expect(resolveProblemField('', 'AI 值', 'OCR 值')).toBe('')
  })
})

describe('normalizeAIProblemAnalysis', () => {
  it('accepts snake_case output, ignores legacy confidence, and clamps diagram bounds', () => {
    const result = normalizeAIProblemAnalysis({
      title: ' 数学 · 几何证明 ',
      subject: ' 数学 ',
      problem_type: '几何证明',
      stem_markdown: '题干',
      choices: [{ label: ' A ', text: ' 选项 ' }, { text: '忽略' }],
      sub_questions: [
        { index: 2, content: ' 第二问 ' },
        { index: 1, content: ' 第一问 ' },
      ],
      diagram: {
        exists: true,
        kind: 'geometry',
        bbox: { x: 0.8, y: 0.9, width: 0.5, height: 0.5 },
      },
      knowledge_points: [' 全等三角形 '],
      confidence: 1.4,
      warnings: [' 低清晰度 '],
    })
    expect(result).toMatchObject({
      title: '数学-几何证明',
      subject: '数学',
      problemType: '几何证明',
      stemMarkdown: '题干',
      choices: [{ label: 'A', text: '选项' }],
      subQuestions: [
        { index: 1, content: '第一问' },
        { index: 2, content: '第二问' },
      ],
      hasDiagram: true,
      diagramKind: 'geometry',
      knowledgePoints: ['全等三角形'],
      warnings: ['低清晰度'],
    })
    expect(result.diagramBBox.x).toBeCloseTo(0.78)
    expect(result.diagramBBox.y).toBeCloseTo(0.88)
    expect(result.diagramBBox.width).toBeCloseTo(0.22)
    expect(result.diagramBBox.height).toBeCloseTo(0.12)
  })

  it('keeps old diagram records compatible when the kind is absent', () => {
    expect(
      normalizeAIProblemAnalysis({
        diagram: {
          exists: true,
          bbox: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 },
        },
      }).diagramKind,
    ).toBe('unknown')
  })

  it('degrades missing or invalid sub-questions to an empty array', () => {
    expect(
      normalizeAIProblemAnalysis({ stem_markdown: '完整原题干' }),
    ).toMatchObject({
      stemMarkdown: '完整原题干',
      subQuestions: [],
    })
    expect(
      normalizeAIProblemAnalysis({
        sub_questions: [{ index: 1, content: '' }, null],
      }).subQuestions,
    ).toEqual([])
  })

  it('removes repeated choice blocks from the stem and keeps unique labels', () => {
    const result = normalizeAIProblemAnalysis({
      stem_markdown: '若 $x>0$，则下列结论正确的是\nA. 甲\nB. 乙',
      choices: [
        { label: 'a', text: '甲' },
        { label: 'A', text: '重复项' },
        { label: 'B', text: '乙' },
        { label: '', text: '无标签' },
      ],
      diagram: { exists: false, bbox: {} },
    })
    expect(result.stemMarkdown).toBe('若 $x>0$，则下列结论正确的是')
    expect(result.choices).toEqual([
      { label: 'A', text: '甲' },
      { label: 'B', text: '乙' },
    ])
  })
})

describe('normalizeAIProblemTitle', () => {
  it('keeps a long model title intact while normalizing its separators', () => {
    const title = normalizeAIProblemTitle(
      '分式 · 选择题 · 含参数分式方程化简与求值',
      '选择题',
      ['分式'],
      '题干',
    )
    expect(title).toBe('分式-选择题-含参数分式方程化简与求值')
    expect(Array.from(title).length).toBeGreaterThan(16)
  })

  it('does not truncate a long structured fallback title', () => {
    expect(normalizeAIProblemTitle(
      null,
      '综合证明与计算题',
      ['相似三角形的判定与性质', '圆内接四边形中的角度关系'],
      '完整题干',
    )).toBe('相似三角形的判定与性质-综合证明与计算题-圆内接四边形中的角度关系')
  })

  it('rejects a direct stem excerpt and falls back to structured fields', () => {
    expect(
      normalizeAIProblemTitle(
        '正方形中的平行线证明',
        '几何证明',
        ['正方形', '平行线'],
        '如图，在正方形中的平行线证明需要添加辅助线。',
      ),
    ).toBe('正方形-几何证明-平行线')
  })

  it('removes question numbers and score markers', () => {
    expect(
      normalizeAIProblemTitle(
        '20.（6分）函数 · 填空题 · 零点',
        '填空题',
        ['函数'],
        '题干',
      ),
    ).toBe('函数-填空题-零点')
  })
})

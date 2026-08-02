import { describe, expect, it } from 'vitest'
import {
  normalizeTextbookRecognitionChapters,
  parseTextbookRecognition,
  TextbookRecognitionParseError,
} from './textbookRecognitionParser'

const response = JSON.stringify({
  title: { value: '人教版七年级数学上册', confidence: 0.96, evidence: '文件名与第 1 页标题' },
  subject: { value: '数学', confidence: 0.99, evidence: '数学 七年级 上册' },
  grade: { value: '七年级', confidence: 0.91, evidence: '七年级' },
  volume: { value: '上册', confidence: 0.88, evidence: '上册' },
  publisher: { value: '人民教育出版社', confidence: 0.85, evidence: '人民教育出版社' },
  edition: { value: '2024 年版', confidence: 0.61, evidence: '版权页 OCR 不完整' },
  overall_confidence: 0.86,
  warnings: ['版本字段建议确认。'],
})

describe('textbook recognition parser', () => {
  it('keeps field confidence and evidence for confirmation UI', () => {
    const result = parseTextbookRecognition(response)
    expect(result.subject.value).toBe('数学')
    expect(result.edition.confidence).toBe(0.61)
    expect(result.warnings).toEqual(['版本字段建议确认。'])
  })

  it('normalizes the new chapter to knowledge-point contract without section nodes', () => {
    const result = parseTextbookRecognition(JSON.stringify({
      ...JSON.parse(response),
      chapters: [{
        title: '第十六章 二次根式', page_start: 1, page_end: 18,
        knowledge_points: [{ name: '二次根式的概念', page_numbers: [2, 3], evidence: '教材原文', confidence: .9 }],
      }],
    }))
    expect(result.chapters).toEqual([expect.objectContaining({
      title: '第十六章 二次根式',
      knowledgePoints: [expect.objectContaining({ name: '二次根式的概念', chapterName: '第十六章 二次根式' })],
    })])
    expect(result.chapters.flatMap((chapter) => chapter.knowledgePoints).every((point) => point.chapterName)).toBe(true)
  })

  it('maps legacy level two and three entries to the nearest chapter', () => {
    const result = parseTextbookRecognition(JSON.stringify({
      ...JSON.parse(response),
      chapters: [
        { title: '第一章 有理数', level: 1, page_number: 1 },
        { title: '1.1 正数和负数', level: 2, page_number: 2 },
        { title: '相反数', level: 3, page_number: 4 },
      ],
    }))
    expect(result.chapters).toHaveLength(1)
    expect(result.chapters[0].knowledgePoints.map((point) => point.name)).toEqual(['1.1 正数和负数', '相反数'])
    expect(result.chapters[0].knowledgePoints.every((point) => point.chapterName === '第一章 有理数')).toBe(true)
    expect(result.chapters.some((chapter) => chapter.title === '节')).toBe(false)
  })

  it('puts legacy knowledge before a chapter in one review-only chapter', () => {
    const result = parseTextbookRecognition(JSON.stringify({
      ...JSON.parse(response),
      chapters: [{ title: '相反数', level: 2, page_number: 4 }],
    }))
    expect(result.chapters).toHaveLength(1)
    expect(result.chapters[0]).toMatchObject({ title: '待归类知识点', isUnclassified: true })
    expect(result.chapters[0].knowledgePoints[0].name).toBe('相反数')
  })

  it('normalizes camelCase stored checkpoint chapters before persistence', () => {
    const chapters = normalizeTextbookRecognitionChapters({
      chapters: [
        { title: '第一章', pageStart: 1, pageEnd: 12, knowledgePoints: [] },
        { title: '1.1 正数和负数', level: 2, pageNumber: 2 },
      ],
    })
    expect(chapters).toHaveLength(1)
    expect(chapters[0].knowledgePoints[0].name).toBe('1.1 正数和负数')
  })

  it('normalizes unavailable fields instead of inventing a value', () => {
    const result = parseTextbookRecognition(JSON.stringify({
      title: {}, subject: {}, grade: {}, volume: {}, publisher: {}, edition: {},
      overall_confidence: 2, warnings: 'bad',
    }))
    expect(result.subject.value).toBeNull()
    expect(result.subject.confidence).toBe(0)
    expect(result.overallConfidence).toBe(1)
    expect(result.warnings).toEqual([])
  })

  it('rejects a response without a JSON object', () => {
    expect(() => parseTextbookRecognition('无法识别')).toThrow(TextbookRecognitionParseError)
  })
})

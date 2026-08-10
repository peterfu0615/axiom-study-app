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
  chapters: [],
  overall_confidence: 0.86,
  warnings: ['版本字段建议确认。'],
})

describe('textbook recognition parser', () => {
  it('keeps evidence while ignoring historical confidence fields', () => {
    const result = parseTextbookRecognition(response)
    expect(result.subject.value).toBe('数学')
    expect(result.edition).toEqual({ value: '2024 年版', evidence: '版权页 OCR 不完整' })
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

  it('normalizes schema-valid null metadata fields instead of inventing a value', () => {
    const result = parseTextbookRecognition(JSON.stringify({
      title: { value: null, confidence: 0, evidence: '' },
      subject: { value: null, confidence: 0, evidence: '' },
      grade: { value: null, confidence: 0, evidence: '' },
      volume: { value: null, confidence: 0, evidence: '' },
      publisher: { value: null, confidence: 0, evidence: '' },
      edition: { value: null, confidence: 0, evidence: '' },
      chapters: [],
      overall_confidence: 0.2,
      warnings: [],
    }))
    expect(result.subject.value).toBeNull()
    expect(result.subject).not.toHaveProperty('confidence')
    expect(result).not.toHaveProperty('overallConfidence')
    expect(result.warnings).toEqual([])
  })

  it('rejects a response without a JSON object', () => {
    expect(() => parseTextbookRecognition('无法识别')).toThrow(TextbookRecognitionParseError)
  })
})

describe('textbook recognition schema validation', () => {
  it('accepts a fully valid payload', () => {
    expect(() => parseTextbookRecognition(response)).not.toThrow()
  })

  it('rejects a payload missing required fields with an explicit parse error', () => {
    const missing = JSON.parse(response)
    delete missing.chapters
    expect(() => parseTextbookRecognition(JSON.stringify(missing)))
      .toThrowError(/教材识别 JSON 不符合 Schema/u)
    expect(() => parseTextbookRecognition(JSON.stringify(missing)))
      .toThrow(TextbookRecognitionParseError)
  })

  it('rejects a payload whose chapter omits knowledge_points', () => {
    const invalid = {
      ...JSON.parse(response),
      chapters: [{ title: '第一章 有理数', level: 1, page_number: 1 }],
    }
    expect(() => parseTextbookRecognition(JSON.stringify(invalid)))
      .toThrow(TextbookRecognitionParseError)
  })

  it('canonicalizes omitted nullable chapter bounds without inventing pages', () => {
    const payload = {
      ...JSON.parse(response),
      chapters: [{
        title: '第一章 有理数',
        page_start: 1,
        knowledge_points: [],
      }],
    }
    const result = parseTextbookRecognition(JSON.stringify(payload))
    expect(result.chapters[0]).toMatchObject({ pageStart: 1, pageEnd: null })
  })

  it('rejects a payload with wrong field types instead of degrading to dirty data', () => {
    const invalid = {
      ...JSON.parse(response),
      subject: { value: 42, evidence: '数学' },
      warnings: 'bad',
    }
    expect(() => parseTextbookRecognition(JSON.stringify(invalid)))
      .toThrowError(/教材识别 JSON 不符合 Schema/u)
  })
})

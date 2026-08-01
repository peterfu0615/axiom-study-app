import { describe, expect, it } from 'vitest'
import {
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

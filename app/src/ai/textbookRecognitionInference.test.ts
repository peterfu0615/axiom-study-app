import { describe, expect, it } from 'vitest'
import { inferMissingTextbookRecognition } from './textbookRecognitionInference'
import { parseTextbookRecognition } from './textbookRecognitionParser'

const emptyField = { value: null, confidence: 0, evidence: '' }

describe('textbook recognition inference fallback', () => {
  it('fills missing fields from local filename and extracted evidence', () => {
    const recognition = parseTextbookRecognition(JSON.stringify({
      title: emptyField, subject: emptyField, grade: emptyField, volume: emptyField,
      publisher: emptyField, edition: emptyField,
      chapters: [], overall_confidence: 0.98, warnings: [],
    }))
    const result = inferMissingTextbookRecognition(recognition, {
      sourceName: '（根据2022年版课程标准修订）义务教育教科书·数学八年级下册.pdf',
      outline: [{ title: '第 15 章 分式', evidenceText: '第 15 章 分式' }],
      pages: [{ pageNumber: 3, evidenceText: '数学 八年级 下册 华东师范大学出版社' }],
    })
    expect(result.subject.value).toBe('数学')
    expect(result.grade.value).toBe('八年级')
    expect(result.volume.value).toBe('下册')
    expect(result.publisher.value).toBe('华东师范大学出版社')
    expect(result.edition.value).toBe('2022年版')
    expect(result.warnings).toContain('AI 未返回完整教材信息，已根据文件名、目录和本地正文填充候选；请在确认页检查。')
    expect(result.overallConfidence).toBeLessThanOrEqual(0.72)
  })

  it('never overwrites a provider value with a local guess', () => {
    const recognition = parseTextbookRecognition(JSON.stringify({
      title: { value: '自定义标题', confidence: 0.9, evidence: 'AI' },
      subject: { value: '数学', confidence: 0.9, evidence: 'AI' },
      grade: emptyField, volume: emptyField, publisher: emptyField, edition: emptyField,
      chapters: [], overall_confidence: 0.9, warnings: [],
    }))
    const result = inferMissingTextbookRecognition(recognition, {
      sourceName: '数学八年级下册.pdf', outline: [], pages: [],
    })
    expect(result.title.value).toBe('自定义标题')
    expect(result.subject.value).toBe('数学')
  })
})

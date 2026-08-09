import { describe, expect, it } from 'vitest'
import {
  buildAutonomousTextbookResolutionPrompt,
  parseAutonomousTextbookResolution,
  textbookResolutionJSONSchema,
} from './textbookResolutionContract'

const input = {
  subject: '数学',
  problemText: '八年级下册一次函数求解析式',
  candidates: [
    {
      id: 'book-1', title: '数学八年级上册', grade: '八年级', volume: '上册',
      publisher: '人民教育出版社', edition: null, chapterFingerprints: ['一次函数'],
    },
    {
      id: 'book-2', title: '数学八年级下册', grade: '八年级', volume: '下册',
      publisher: '人民教育出版社', edition: null, chapterFingerprints: ['一次函数与反比例函数'],
    },
  ],
}

describe('autonomous textbook resolution contract', () => {
  it('constrains the model to one server-provided textbook id', () => {
    const prompt = buildAutonomousTextbookResolutionPrompt(input)
    expect(prompt).toContain('只能返回 candidates 中已有的 id')
    expect(prompt).toContain('book-1')
    expect(prompt).toContain('book-2')
    expect(textbookResolutionJSONSchema).toMatchObject({
      additionalProperties: false,
      required: ['selected_textbook_id'],
    })
  })

  it('parses a fenced structured selection and rejects a missing id', () => {
    expect(parseAutonomousTextbookResolution('```json\n{"selected_textbook_id":"book-2"}\n```'))
      .toEqual({ selectedTextbookId: 'book-2' })
    expect(() => parseAutonomousTextbookResolution('{"selected_textbook_id":""}'))
      .toThrow('selected_textbook_id')
  })
})

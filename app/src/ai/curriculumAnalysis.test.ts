import { describe, expect, it } from 'vitest'
import {
  buildCurriculumTagPrompt,
  chunkTextbookPages,
  parseCurriculumTags,
  reconcileCurriculumTagCandidates,
} from './curriculumAnalysis'

const recognition = {
  title: { value: '八年级数学', confidence: .9, evidence: '封面' },
  subject: { value: '数学', confidence: .9, evidence: '封面' },
  grade: { value: '八年级', confidence: .9, evidence: '封面' },
  volume: { value: null, confidence: 0, evidence: '' },
  publisher: { value: null, confidence: 0, evidence: '' },
  edition: { value: null, confidence: 0, evidence: '' },
  overallConfidence: .9, warnings: [],
}

describe('curriculum tag inference', () => {
  it('explicitly permits useful inferred methods and models without page evidence', () => {
    const prompt = buildCurriculumTagPrompt({ recognition, outline: [], pages: [], existingTags: [] })
    expect(prompt).toContain('倍长中线')
    expect(prompt).toContain('待定系数法')
    expect(prompt).toContain('一线三等角')
    expect(prompt).toContain('不要求页码或原文证据')
  })

  it('accepts an inferred method absent from textbook wording', () => {
    const result = parseCurriculumTags(JSON.stringify({ subject: '数学', tags: [{
      tag_type: 'method', canonical_name: '倍长中线', aliases: ['中线倍长法'],
      description: '构造全等三角形', origin: 'ai_inferred', knowledge_names: ['全等三角形'],
      page_numbers: [], evidence_text: null, confidence: .82,
    }], warnings: [] }), '数学')
    expect(result.candidates[0]).toMatchObject({ canonicalName: '倍长中线', origin: 'ai_inferred', pageNumbers: [] })
  })

  it('reuses a subject-scoped synonymous method instead of creating another', () => {
    const [candidate] = parseCurriculumTags(JSON.stringify({ subject: '数学', tags: [{
      tag_type: 'method', canonical_name: '中线倍长法', aliases: [], description: null,
      origin: 'ai_inferred', knowledge_names: ['全等三角形'], page_numbers: [],
      evidence_text: null, confidence: .8,
    }], warnings: [] }), '数学').candidates
    const result = reconcileCurriculumTagCandidates([candidate], [{
      id: 'existing', tagType: 'method', canonicalName: '倍长中线', aliases: ['中线倍长法'],
    }])
    expect(result[0]).toMatchObject({ canonicalName: '倍长中线', origin: 'existing_library', existingTagId: 'existing' })
  })

  it('rejects a response for another subject', () => {
    expect(() => parseCurriculumTags(JSON.stringify({ subject: '物理', tags: [], warnings: [] }), '数学'))
      .toThrow('科目不匹配')
  })

  it('splits oversized textbooks at chapter boundaries without dropping later pages', () => {
    const pages = Array.from({ length: 8 }, (_, index) => ({
      pageNumber: index + 1, evidenceText: `page-${index + 1}-` + '字'.repeat(20),
    }))
    const chunks = chunkTextbookPages(pages, [
      { level: 1, pageNumber: 1 }, { level: 1, pageNumber: 5 },
    ], 10_000)
    expect(chunks).toHaveLength(2)
    expect(chunks.flat().map((page) => page.pageNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })
})

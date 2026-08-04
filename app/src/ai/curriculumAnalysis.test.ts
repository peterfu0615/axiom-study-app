import { describe, expect, it } from 'vitest'
import {
  buildCurriculumTagPrompt,
  chunkTextbookPages,
  parseCurriculumTags,
  reconcileCurriculumTagCandidates,
} from './curriculumAnalysis'
import { buildTextbookRecognitionPrompt } from './textbookRecognitionContract'

const recognition = {
  title: { value: '八年级数学', confidence: .9, evidence: '封面' },
  subject: { value: '数学', confidence: .9, evidence: '封面' },
  grade: { value: '八年级', confidence: .9, evidence: '封面' },
  volume: { value: null, confidence: 0, evidence: '' },
  publisher: { value: null, confidence: 0, evidence: '' },
  edition: { value: null, confidence: 0, evidence: '' },
  chapters: [],
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

  it('keeps the AI knowledge candidate chapter reference without introducing a section level', () => {
    const result = parseCurriculumTags(JSON.stringify({ subject: '数学', tags: [{
      tag_type: 'knowledge', canonical_name: '相似三角形', aliases: [], description: '图形相似',
      origin: 'textbook_extracted', knowledge_names: [], chapter_name: '第二章 几何',
      page_numbers: [24], evidence_text: '教材原文', confidence: .9,
    }], warnings: [] }), '数学')
    expect(result.candidates[0]).toMatchObject({ chapterName: '第二章 几何' })
    const prompt = buildCurriculumTagPrompt({ recognition, outline: [], pages: [], existingTags: [] })
    expect(prompt).toContain('chapter_name')
    expect(prompt).toContain('不要生成 section 或根级知识点')
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

  it('merges cross-chunk candidates whose aliases would otherwise collide', () => {
    const result = reconcileCurriculumTagCandidates([
      {
        tagType: 'method', canonicalName: '待定系数法', aliases: ['设系数法'],
        description: null, origin: 'ai_inferred', knowledgeNames: ['一次函数'],
        pageNumbers: [], evidenceText: null, confidence: .7, existingTagId: null,
      },
      {
        tagType: 'method', canonicalName: '系数待定法', aliases: ['待定系数法'],
        description: '根据条件列方程确定参数', origin: 'ai_inferred', knowledgeNames: ['反比例函数'],
        pageNumbers: [66], evidenceText: null, confidence: .85, existingTagId: null,
      },
    ], [])
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ canonicalName: '待定系数法', confidence: .85 })
    expect(result[0].knowledgeNames).toEqual(['一次函数', '反比例函数'])
    expect(result[0].pageNumbers).toEqual([66])
    expect(result[0].aliases).not.toContain('待定系数法')
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

  it('does not create tiny AI chunks for chapter entries inside a table of contents', () => {
    const pages = [
      { pageNumber: 1, evidenceText: '目录\n第 1 章 代数 1' },
      { pageNumber: 2, evidenceText: '第 2 章 几何 20' },
      { pageNumber: 3, evidenceText: '第 1 章 代数 正文' },
      { pageNumber: 4, evidenceText: '代数正文' },
      { pageNumber: 5, evidenceText: '第 2 章 几何 正文' },
      { pageNumber: 6, evidenceText: '几何正文' },
    ]
    const chunks = chunkTextbookPages(pages, [
      { level: 1, pageNumber: 1 }, { level: 1, pageNumber: 2 },
      { level: 1, pageNumber: 3 }, { level: 1, pageNumber: 5 },
    ], 10_000)
    expect(chunks.map((chunk) => chunk.map((page) => page.pageNumber))).toEqual([
      [1, 2], [3, 4], [5, 6],
    ])
  })

  it('keeps failed extraction placeholders without breaking chunks or prompts', () => {
    // The Vision helper emits placeholder pages (empty evidenceText, extraction
    // method "failed") when a page cannot be rendered; downstream consumers
    // must tolerate them and keep page numbering contiguous.
    const pages = [
      { pageNumber: 1, evidenceText: '第 1 章 代数 正文内容' },
      { pageNumber: 2, evidenceText: '' },
      { pageNumber: 3, evidenceText: '第 2 章 几何 正文内容' },
    ]
    const chunks = chunkTextbookPages(pages, [], 10_000)
    expect(chunks.flat().map((page) => page.pageNumber)).toEqual([1, 2, 3])
    const prompt = buildTextbookRecognitionPrompt({
      sourceName: '数学八年级下册.pdf', pageCount: 3, outline: [], pages,
    })
    expect(prompt).toContain('"page_number":1')
    expect(prompt).toContain('"page_number":3')
    expect(prompt).not.toContain('"page_number":2')
  })
})
  it('keeps failed extraction placeholders without breaking chunks or prompts', () => {
    // The Vision helper emits placeholder pages (empty evidenceText, extraction
    // method "failed") when a page cannot be rendered; downstream consumers
    // must tolerate them and keep page numbering contiguous.
    const pages = [
      { pageNumber: 1, evidenceText: '第 1 章 代数 正文内容' },
      { pageNumber: 2, evidenceText: '' },
      { pageNumber: 3, evidenceText: '第 2 章 几何 正文内容' },
    ]
    const chunks = chunkTextbookPages(pages, [], 10_000)
    expect(chunks.flat().map((page) => page.pageNumber)).toEqual([1, 2, 3])
    const prompt = buildTextbookRecognitionPrompt({
      sourceName: '数学八年级下册.pdf', pageCount: 3, outline: [], pages,
    })
    expect(prompt).toContain('"page_number":1')
    expect(prompt).toContain('"page_number":3')
    expect(prompt).not.toContain('"page_number":2')
  })
})

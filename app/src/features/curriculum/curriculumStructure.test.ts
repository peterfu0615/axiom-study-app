import { describe, expect, it } from 'vitest'
import {
  normalizeTextbookStructure,
  UNCLASSIFIED_CHAPTER_TITLE,
} from './curriculumStructure'

describe('curriculum chapter/knowledge structure', () => {
  it('keeps nested AI output at exactly two levels and merges duplicate points', () => {
    const structure = normalizeTextbookStructure({
      chapters: [{
        title: '第一章 有理数', pageStart: 1, pageEnd: 20,
        knowledgePoints: [
          { name: '相反数', pageNumbers: [4], evidence: '教材依据', confidence: .7 },
          { name: '相反数', pageNumbers: [5], evidence: '', confidence: .9 },
        ],
      }],
    })
    expect(structure).toHaveLength(1)
    expect(structure[0].knowledgePoints).toHaveLength(1)
    expect(structure[0].knowledgePoints[0].pageNumbers).toEqual([4, 5])
    expect(structure.every((chapter) => chapter.knowledgePoints.every((point) => point.chapterName === chapter.title))).toBe(true)
  })

  it('maps legacy level two and three outline entries directly below their chapter', () => {
    const structure = normalizeTextbookStructure({ outline: [
      { title: '第一章 有理数', level: 1, pageNumber: 1, evidenceText: '', confidence: .9 },
      { title: '1.1 正数和负数', level: 2, pageNumber: 2, evidenceText: '', confidence: .8 },
      { title: '相反数', level: 3, pageNumber: 4, evidenceText: '', confidence: .8 },
    ] })
    expect(structure[0].title).toBe('第一章 有理数')
    expect(structure[0].knowledgePoints.map((point) => point.name)).toEqual(['1.1 正数和负数', '相反数'])
    expect(structure[0].knowledgePoints.every((point) => point.chapterName === '第一章 有理数')).toBe(true)
  })

  it('uses one unclassified chapter when a candidate has no reliable parent', () => {
    const structure = normalizeTextbookStructure({
      outline: [{ title: '第一章 有理数', level: 1, pageNumber: 1, evidenceText: '', confidence: .9 }],
      tagCandidates: [
        { tagType: 'knowledge', canonicalName: '无法归类一', knowledgeNames: [], pageNumbers: [300], confidence: .4 },
        { tagType: 'knowledge', canonicalName: '无法归类二', knowledgeNames: [], pageNumbers: [500], confidence: .4 },
      ],
    })
    const unclassified = structure.filter((chapter) => chapter.isUnclassified)
    expect(unclassified).toHaveLength(1)
    expect(unclassified[0].title).toBe(UNCLASSIFIED_CHAPTER_TITLE)
    expect(unclassified[0].knowledgePoints.map((point) => point.name)).toEqual(['无法归类一', '无法归类二'])
    expect(structure.flatMap((chapter) => chapter.knowledgePoints).every((point) => point.chapterName)).toBe(true)
  })

  it('resolves a knowledge candidate by explicit chapter name before page proximity', () => {
    const structure = normalizeTextbookStructure({
      chapters: [
        { title: '第一章 代数', pageStart: 1, pageEnd: 20, knowledgePoints: [] },
        { title: '第二章 几何', pageStart: 21, pageEnd: 40, knowledgePoints: [] },
      ],
      tagCandidates: [{
        tagType: 'knowledge', canonicalName: '相似三角形', chapterName: '第二章 几何',
        knowledgeNames: [], pageNumbers: [4], confidence: .9,
      }],
    })
    expect(structure[1].knowledgePoints.map((point) => point.name)).toEqual(['相似三角形'])
    expect(structure[0].knowledgePoints).toEqual([])
  })
})

import { describe, expect, it } from 'vitest'
import { findProblemDuplicateSuggestions } from './problemDuplicates'
import type { SavedProblem } from './models'

function problem(id: string, subject: string, stem: string, tag = '一次函数') {
  return {
    id,
    subject,
    stemMarkdown: stem,
    title: stem,
    sourceDocumentId: `source-${id}`,
    libraryMetadata: {
      tags: [{ id: `tag-${tag}`, name: tag, type: 'knowledge' }],
    },
  } as SavedProblem
}

describe('problem duplicate suggestions', () => {
  it('suggests same-subject structural duplicates across sources', () => {
    const current = problem('a', '数学', '已知一次函数 y=2x+1，求与坐标轴的交点。')
    const duplicate = problem('b', '数学', '已知一次函数 y = 2x + 1，求与坐标轴的交点！')
    const result = findProblemDuplicateSuggestions(current, [duplicate])
    expect(result[0]?.candidate.id).toBe('b')
    expect(result[0]?.score).toBeGreaterThan(0.9)
  })

  it('never links visually similar problems across subjects or after a decision', () => {
    const current = problem('a', '数学', '设函数图像经过点 A，求参数的值。')
    const otherSubject = problem('b', '物理', '设函数图像经过点 A，求参数的值。')
    const sameSubject = problem('c', '数学', '设函数图像经过点 A，求参数的值。')
    expect(findProblemDuplicateSuggestions(current, [otherSubject])).toEqual([])
    expect(findProblemDuplicateSuggestions(current, [sameSubject], new Set(['c']))).toEqual([])
  })
})

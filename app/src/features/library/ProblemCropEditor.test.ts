import { describe, expect, it } from 'vitest'
import type { ProblemRegion } from '../../domain/models'
import { changedRegionTypes } from '../../domain/problemRegions'

function region(
  id: string,
  type: ProblemRegion['type'],
  y = 0.1,
): ProblemRegion {
  return {
    id,
    problemId: 'problem-1',
    type,
    rect: { x: 0.1, y, width: 0.8, height: 0.2 },
    imagePath: `/old/${id}.jpg`,
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('changedRegionTypes', () => {
  it('ignores regenerated image paths when geometry is unchanged', () => {
    const before = [region('question-1', 'question')]
    const after = before.map((item) => ({
      ...item,
      imagePath: '/new/question-1.jpg',
      updatedAt: 2,
    }))
    expect(changedRegionTypes(before, after)).toEqual([])
  })

  it('detects answer movement without invalidating the question region', () => {
    const before = [
      region('question-1', 'question'),
      region('answer-1', 'answer', 0.3),
    ]
    const after = [
      region('question-1', 'question'),
      region('answer-1', 'answer', 0.45),
    ]
    expect(changedRegionTypes(before, after)).toEqual(['answer'])
  })

  it('detects added diagram regions', () => {
    const before = [region('question-1', 'question')]
    const after = [...before, region('diagram-1', 'diagram', 0.5)]
    expect(changedRegionTypes(before, after)).toEqual(['diagram'])
  })
})

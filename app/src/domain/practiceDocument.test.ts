import { describe, expect, it } from 'vitest'
import type { PracticeItem, PracticeSet } from './practice'
import { A4_POINTS, PRACTICE_LAYOUT_VERSION, buildPracticeDocument } from './practiceDocument'

const item = (index: number, difficulty: PracticeItem['difficulty'] = 'intermediate'): PracticeItem => ({
  id: `item-${index}`, practiceSetId: 'set-1', orderIndex: index, sourceType: 'existing_problem',
  sourceProblemId: `problem-${index}`, subject: '数学', targetSkillBundleId: 'bundle-1', targetTags: [], difficulty,
  statementMarkdown: `第 ${index + 1} 题：求方程 $x^2-${index + 1}=0$ 的解。`, options: null,
  canonicalAnswer: `x=±√${index + 1}`, solutionJson: '{"contentMarkdown":"移项后开平方。"}',
  gradingRubric: { criteria: ['答案正确'], maxScore: 100 }, diagramIds: [], questionImagePath: null,
  diagramImagePaths: [], generationMetadata: null, validationStatus: 'valid', createdAt: 1,
})
const set = (count: number): PracticeSet => ({
  id: 'set-1', subject: '数学', sourceType: 'review_unit', sourceRef: 'module-1', strategy: 'deterministic-v1', status: 'ready',
  targetSkills: [], generationMetadata: {}, createdAt: 1, updatedAt: 1,
  items: Array.from({ length: count }, (_, index) => item(index, index % 3 === 2 ? 'advanced' : 'intermediate')),
})

describe('PracticeDocument', () => {
  it('keeps stable A4 question numbering and page identity', () => {
    const left = buildPracticeDocument(set(8), { attemptId: 'attempt-1', documentType: 'questions', generatedAt: 10 })
    const right = buildPracticeDocument(set(8), { attemptId: 'attempt-1', documentType: 'questions', generatedAt: 10 })
    expect(left).toEqual(right)
    expect(left.layout).toMatchObject({ version: PRACTICE_LAYOUT_VERSION, pageSize: 'A4', widthPoints: A4_POINTS.width })
    expect(left.pages.flatMap((page) => page.questions.map((question) => question.displayNumber))).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(new Set(left.pages.map((page) => page.pageIdentity)).size).toBe(left.pages.length)
  })

  it('binds every normalized answer region to one practice item', () => {
    const document = buildPracticeDocument(set(6), { attemptId: 'attempt-answer', documentType: 'answer_sheet' })
    const regions = document.pages.flatMap((page) => page.answerRegions)
    expect(regions.map((region) => region.practiceItemId)).toEqual(set(6).items.map((practiceItem) => practiceItem.id))
    regions.forEach((region) => {
      expect(region.x + region.width).toBeLessThanOrEqual(1)
      expect(region.y + region.height).toBeLessThanOrEqual(1)
      expect(region.width * region.height).toBeGreaterThan(0)
    })
    expect(document.pages.every((page) => page.qrPayload.includes('attempt=attempt-answer'))).toBe(true)
  })
})

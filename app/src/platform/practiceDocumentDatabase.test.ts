import { describe, expect, it } from 'vitest'
import type { PracticeSet } from '../domain/practice'
import { buildPracticeDocument } from '../domain/practiceDocument'

describe('practice PDF identity', () => {
  it('uses one stable attempt and item identity in machine metadata', () => {
    const set = {
      id: 'set-pdf', subject: '数学', strategy: 'deterministic-v1', items: [{
        id: 'item-pdf', practiceSetId: 'set-pdf', orderIndex: 0, difficulty: 'basic',
        statementMarkdown: '求 x', options: null, canonicalAnswer: 'x=1', solutionJson: '{"contentMarkdown":"解"}',
        diagramIds: [], diagramImagePaths: [],
      }],
    } as unknown as PracticeSet
    const document = buildPracticeDocument(set, { attemptId: 'attempt-pdf', documentType: 'answer_sheet', generatedAt: 1 })
    expect(document.pages[0].qrPayload).toContain('set=set-pdf|attempt=attempt-pdf')
    expect(document.pages[0].answerRegions[0]).toMatchObject({ practiceItemId: 'item-pdf', regionIndex: 0 })
  })
})

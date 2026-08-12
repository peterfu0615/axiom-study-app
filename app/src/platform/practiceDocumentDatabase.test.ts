import { describe, expect, it } from 'vitest'
import type { PracticeSet } from '../domain/practice'
import { buildCompletePracticeDocument } from '../domain/practiceDocument'

describe('practice PDF identity', () => {
  it('uses one stable attempt and item identity in machine metadata', () => {
    const set = {
      id: 'set-pdf', subject: '数学', strategy: 'deterministic-v1', items: [{
        id: 'item-pdf', practiceSetId: 'set-pdf', orderIndex: 0, difficulty: 'basic',
        statementMarkdown: '求 x', options: null, canonicalAnswer: 'x=1', solutionJson: '{"contentMarkdown":"解"}',
        diagramIds: [], diagramImagePaths: [],
      }],
    } as unknown as PracticeSet
    const document = buildCompletePracticeDocument(set, { attemptId: 'attempt-pdf', generatedAt: 1 })
    const answerQuestion = document.sections
      .find((section) => section.kind === 'answer_sheet')
      ?.blocks.find((block) => block.kind === 'question')
    expect(document.id).toContain('set-pdf:attempt-pdf:complete')
    expect(answerQuestion).toMatchObject({
      kind: 'question',
      practiceItemId: 'item-pdf',
      content: [{ kind: 'answerSpace', practiceItemId: 'item-pdf' }],
    })
  })
})

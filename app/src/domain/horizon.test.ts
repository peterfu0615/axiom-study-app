import { describe, expect, it } from 'vitest'
import { mapCandidatesToControlledTags, type TagDefinition } from './horizon'

function definition(overrides: Partial<TagDefinition> = {}): TagDefinition {
  return {
    id: 'math-factoring',
    subject: '数学',
    tagType: 'knowledge',
    canonicalName: '因式分解',
    aliases: ['分解因式'],
    description: null,
    parentId: null,
    knowledgeNodeId: 'node-1',
    textbookId: 'math-book',
    source: 'textbook_extracted',
    taxonomyVersion: 1,
    verificationStatus: 'user_verified',
    lifecycleStatus: 'active',
    methodClass: null,
    mergedIntoId: null,
    archivedAt: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

const candidate = {
  name: '分解因式',
  role: 'primary' as const,
  confidence: 0.9,
  evidence: '需要将多项式分解',
  source: 'problem' as const,
}

describe('subject-scoped controlled tag mapping', () => {
  it('maps aliases only inside the active subject and textbook', () => {
    const result = mapCandidatesToControlledTags(
      '数学',
      'knowledge',
      [candidate],
      [
        definition(),
        definition({ id: 'physics-factoring', subject: '物理' }),
      ],
      'math-book',
    )
    expect(result[0].definition?.id).toBe('math-factoring')
    expect(result[0].mappingStatus).toBe('mapped')
  })

  it('never reuses an equal name from another subject', () => {
    const result = mapCandidatesToControlledTags(
      '数学',
      'knowledge',
      [candidate],
      [definition({ id: 'physics-factoring', subject: '物理' })],
      'math-book',
    )
    expect(result[0].definition).toBeNull()
    expect(result[0].mappingStatus).toBe('unmapped')
  })

  it('does not map knowledge from a different matched textbook', () => {
    const result = mapCandidatesToControlledTags(
      '数学',
      'knowledge',
      [candidate],
      [definition()],
      'other-book',
    )
    expect(result[0].mappingStatus).toBe('unmapped')
  })

  it('does not map knowledge when the problem has no matched textbook', () => {
    const result = mapCandidatesToControlledTags(
      '数学',
      'knowledge',
      [candidate],
      [definition({ textbookId: null })],
      null,
    )
    expect(result[0].definition).toBeNull()
    expect(result[0].mappingStatus).toBe('unmapped')
  })

  it('routes low-confidence matches to review without losing the stable id', () => {
    const result = mapCandidatesToControlledTags(
      '数学',
      'knowledge',
      [{ ...candidate, confidence: 0.4 }],
      [definition()],
      'math-book',
    )
    expect(result[0].definition?.id).toBe('math-factoring')
    expect(result[0].verificationStatus).toBe('needs_review')
  })
})

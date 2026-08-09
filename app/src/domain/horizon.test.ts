import { describe, expect, it } from 'vitest'
import {
  mapCandidatesToControlledTags,
  mergeKnowledgeCandidateOutputs,
  summarizeProblemTagOutcome,
  type ProblemTag,
  type TagDefinition,
} from './horizon'

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

  it('accepts a controlled id only when it belongs to the selected textbook', () => {
    const result = mapCandidatesToControlledTags(
      '数学', 'knowledge',
      [{ ...candidate, canonicalTagId: 'math-factoring', name: '模型返回的显示名' }],
      [definition()], 'math-book',
    )
    expect(result[0].definition?.id).toBe('math-factoring')
  })

  it('rejects a real controlled id from another textbook', () => {
    const result = mapCandidatesToControlledTags(
      '数学', 'knowledge',
      [{ ...candidate, canonicalTagId: 'other-book-tag' }],
      [definition({ id: 'other-book-tag', textbookId: 'other-book' })], 'math-book',
    )
    expect(result[0].definition).toBeNull()
    expect(result[0].mappingStatus).toBe('unmapped')
  })

  it('rejects hallucinated ids without silently falling back by name', () => {
    const result = mapCandidatesToControlledTags(
      '数学', 'knowledge',
      [{ ...candidate, canonicalTagId: 'hallucinated-id' }],
      [definition()], 'math-book',
    )
    expect(result[0].definition).toBeNull()
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

describe('problem tag outcome summary', () => {
  const tag = (overrides: Partial<ProblemTag> = {}): ProblemTag => ({
    id: 'pt-1', problemId: 'problem-1', subject: '数学', tagType: 'knowledge',
    tagId: 'math-factoring', canonicalName: '因式分解', role: 'primary',
    mappingStatus: 'mapped', confidence: .9, evidence: '题面', source: 'model',
    taxonomyVersion: 1, modelRunId: 'run-1', verificationStatus: 'ai_verified',
    isLocked: false, updatedAt: 1, ...overrides,
  })

  it('distinguishes unresolved review items from mapped items', () => {
    expect(summarizeProblemTagOutcome({
      tags: [tag({ tagId: null, mappingStatus: 'unmapped' })],
      definitions: [definition()], selectedTextbookId: 'math-book',
    }).code).toBe('unresolved')
    expect(summarizeProblemTagOutcome({
      tags: [tag()], definitions: [definition()], selectedTextbookId: 'math-book',
    }).code).toBe('needs_review')
  })

  it('explains no-textbook, no-definition, and no-candidate empty states', () => {
    expect(summarizeProblemTagOutcome({
      tags: [], definitions: [], selectedTextbookId: null,
    }).code).toBe('no_textbook')
    expect(summarizeProblemTagOutcome({
      tags: [], definitions: [], selectedTextbookId: 'math-book',
    }).code).toBe('no_active_definitions')
    expect(summarizeProblemTagOutcome({
      tags: [], definitions: [definition()], selectedTextbookId: 'math-book',
    }).code).toBe('no_candidate')
  })
})

describe('mergeKnowledgeCandidateOutputs', () => {
  it('connects unresolved model output without trusting an ID in that channel', () => {
    const result = mergeKnowledgeCandidateOutputs(
      [{ ...candidate, canonicalTagId: 'math-factoring' }],
      [{ ...candidate, name: '未知知识', canonicalTagId: 'invented-id' }],
    )
    expect(result).toHaveLength(2)
    expect(result[1]).toMatchObject({ name: '未知知识', canonicalTagId: null })
  })

  it('deduplicates repeated unresolved names', () => {
    expect(mergeKnowledgeCandidateOutputs([], [candidate, { ...candidate }])).toHaveLength(1)
  })
})

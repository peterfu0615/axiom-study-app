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
    subjectId: 'subject-math',
    subject: '数学',
    tagType: 'knowledge',
    canonicalName: '因式分解',
    aliases: ['分解因式'],
    description: null,
    parentId: null,
    knowledgeNodeId: 'node-1',
    textbookId: 'math-book',
    knowledgePath: '因式分解/提公因式法',
    knowledgeEvidence: null,
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
  evidence: '需要将多项式分解',
  source: 'problem' as const,
}

describe('subject-id-scoped controlled tag mapping', () => {
  it('maps aliases by stable subject id even when display name and code differ', () => {
    const result = mapCandidatesToControlledTags(
      'subject-math',
      'knowledge',
      [candidate],
      [
        definition(),
        definition({ id: 'physics-factoring', subjectId: 'subject-physics', subject: '物理' }),
      ],
    )
    expect(result[0].definition?.id).toBe('math-factoring')
    expect(result[0].mappingStatus).toBe('mapped')
  })

  it('never reuses an equal name from another subject', () => {
    const result = mapCandidatesToControlledTags(
      'subject-math',
      'knowledge',
      [candidate],
      [definition({ id: 'physics-factoring', subjectId: 'subject-physics', subject: '物理' })],
    )
    expect(result[0].definition).toBeNull()
    expect(result[0].mappingStatus).toBe('unmapped')
  })

  it('allows active knowledge from another textbook in the same subject', () => {
    const result = mapCandidatesToControlledTags(
      'subject-math',
      'knowledge',
      [candidate],
      [definition({ textbookId: 'other-math-book' })],
    )
    expect(result[0].mappingStatus).toBe('mapped')
  })

  it('accepts a controlled id only when it belongs to the subject', () => {
    const result = mapCandidatesToControlledTags(
      'subject-math', 'knowledge',
      [{ ...candidate, canonicalTagId: 'math-factoring', name: '模型返回的显示名' }],
      [definition()],
    )
    expect(result[0].definition?.id).toBe('math-factoring')
  })

  it('rejects a real controlled id from another subject', () => {
    const result = mapCandidatesToControlledTags(
      'subject-math', 'knowledge',
      [{ ...candidate, canonicalTagId: 'other-book-tag' }],
      [definition({ id: 'other-book-tag', subjectId: 'subject-physics', subject: '物理' })],
    )
    expect(result[0].definition).toBeNull()
    expect(result[0].mappingStatus).toBe('unmapped')
  })

  it('rejects hallucinated ids without silently falling back by name', () => {
    const result = mapCandidatesToControlledTags(
      'subject-math', 'knowledge',
      [{ ...candidate, canonicalTagId: 'hallucinated-id' }],
      [definition()],
    )
    expect(result[0].definition).toBeNull()
    expect(result[0].mappingStatus).toBe('unmapped')
  })

  it('maps knowledge without requiring a current or matched textbook', () => {
    const result = mapCandidatesToControlledTags(
      'subject-math',
      'knowledge',
      [candidate],
      [definition()],
    )
    expect(result[0].definition?.id).toBe('math-factoring')
    expect(result[0].mappingStatus).toBe('mapped')
  })

  it('routes model matches to review without a probability threshold', () => {
    const result = mapCandidatesToControlledTags(
      'subject-math',
      'knowledge',
      [candidate],
      [definition()],
    )
    expect(result[0].definition?.id).toBe('math-factoring')
    expect(result[0].verificationStatus).toBe('needs_review')
  })
})

describe('problem tag outcome summary', () => {
  const tag = (overrides: Partial<ProblemTag> = {}): ProblemTag => ({
    id: 'pt-1', problemId: 'problem-1', subjectId: 'subject-math', subject: '数学', tagType: 'knowledge',
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

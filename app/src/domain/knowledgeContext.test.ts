import { describe, expect, it } from 'vitest'
import type { CanonicalKnowledgeCandidate } from './models'
import {
  KNOWLEDGE_CONTEXT_CANDIDATE_LIMIT,
  rankCanonicalKnowledgeCandidates,
} from './knowledgeContext'

function candidate(id: string, name: string, aliases: string[] = []): CanonicalKnowledgeCandidate {
  return {
    canonicalTagId: id,
    canonicalName: name,
    aliases,
    knowledgeNodeId: `node-${id}`,
    chapter: '第十二章',
    hierarchyPath: `第十二章/${name}`,
    taxonomyVersion: 3,
    evidence: null,
  }
}

describe('rankCanonicalKnowledgeCandidates', () => {
  it('ranks canonical and alias lexical matches before unrelated nodes', () => {
    const result = rankCanonicalKnowledgeCandidates([
      candidate('unrelated', '勾股定理'),
      candidate('alias', '三角形全等的判定', ['全等判定']),
      candidate('exact', '全等三角形'),
    ], '证明两个三角形全等，并说明所用全等判定')
    expect(result.candidates.map((item) => item.canonicalTagId).slice(0, 2))
      .toEqual(['alias', 'exact'])
  })

  it('enforces both candidate and serialized character limits', () => {
    const source = Array.from({ length: 60 }, (_, index) =>
      candidate(String(index), `知识点${index}${'很长'.repeat(20)}`))
    const result = rankCanonicalKnowledgeCandidates(source, '', undefined, 700)
    expect(result.candidates.length).toBeLessThanOrEqual(KNOWLEDGE_CONTEXT_CANDIDATE_LIMIT)
    expect(result.contextCharacterCount).toBeLessThanOrEqual(700)
  })
})

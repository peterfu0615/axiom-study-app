import { describe, expect, it } from 'vitest'
import type { KnowledgeNode } from '../../domain/horizon'
import { buildKnowledgeTree, matchingKnowledgeNodeIds } from './curriculumTree'

function node(overrides: Partial<KnowledgeNode>): KnowledgeNode {
  return {
    id: 'node', textbookId: 'book', subject: '数学', canonicalName: '节点', nodeType: 'knowledge',
    parentId: null, path: '节点', sortOrder: 0, curriculumVersion: 1, description: null,
    sourcePageStart: null, sourcePageEnd: null, evidenceText: null, sourcePath: null,
    extractionMethod: 'manual', confidence: 1, verificationStatus: 'user_verified',
    mergedIntoId: null, archivedAt: null, createdAt: 1, updatedAt: 1, ...overrides,
  }
}

describe('curriculum knowledge tree', () => {
  const chapter = node({ id: 'chapter', canonicalName: '第一章', nodeType: 'chapter', path: '第一章' })
  const section = node({ id: 'section', canonicalName: '有理数', nodeType: 'section', parentId: 'chapter', path: '第一章/有理数' })
  const knowledge = node({ id: 'knowledge', canonicalName: '相反数', parentId: 'section', path: '第一章/有理数/相反数' })

  it('builds a sorted parent-child tree from stable node ids', () => {
    const tree = buildKnowledgeTree([knowledge, chapter, section])
    expect(tree).toHaveLength(1)
    expect(tree[0].children[0].children[0].node.id).toBe('knowledge')
  })

  it('keeps ancestors visible while searching a descendant', () => {
    expect([...matchingKnowledgeNodeIds([chapter, section, knowledge], '相反')]).toEqual([
      'knowledge', 'section', 'chapter',
    ])
  })
})

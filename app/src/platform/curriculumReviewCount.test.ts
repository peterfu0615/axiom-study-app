import { beforeEach, describe, expect, it, vi } from 'vitest'
import horizonDatabaseSource from './horizonDatabase.ts?raw'
import type { TagDefinition } from '../domain/horizon'

// 待确认计数口径验证（checkpoint 4）：getCurriculumReviewCount 的谓词必须与
// 单项批准（reviewTagDefinition / confirmProblemTag）和一键批准
// （Rust bulk_review_curriculum_tags）写入的终态互为补集，批准后计数递减到 0。
// 假数据库按 horizonDatabase.ts / horizon.rs 的同名谓词在 JS 中求值，
// 使「计数 → 批准 → 计数」全链路可在无 Tauri 环境下验证。

interface FakeDefinition {
  id: string
  subject: string
  tag_type: string
  knowledge_node_id: string | null
  lifecycle_status: string
  verification_status: string
  archived_at: number | null
}

interface FakeProblemTag {
  id: string
  problem_id: string
  subject: string
  tag_type: string
  tag_id: string | null
  mapping_status: string
  verification_status: string
  is_locked: number
  superseded_at: number | null
}

const fake = vi.hoisted(() => {
  return {
    definitions: [] as FakeDefinition[],
    problemTags: [] as FakeProblemTag[],
    nodes: [] as Array<{ id: string; textbook_id: string; archived_at: number | null }>,
    problems: [] as Array<{ id: string; matched_textbook_id: string | null }>,
  }
})

function nodeOf(knowledgeNodeId: string | null) {
  return fake.nodes.find((node) => node.id === knowledgeNodeId) ?? null
}

// 与 getCurriculumReviewCount 的 SQL 谓词逐条对应
function pendingDefinitions(subject: string, textbookId: string) {
  return fake.definitions.filter((td) => {
    if (td.subject !== subject) return false
    if (['archived', 'merged', 'rejected'].includes(td.lifecycle_status)) return false
    if (['user_verified', 'rejected'].includes(td.verification_status)) return false
    if (!(td.lifecycle_status === 'candidate' || td.verification_status === 'needs_review')) return false
    if (td.tag_type === 'knowledge') {
      if (textbookId === '') return false
      const node = nodeOf(td.knowledge_node_id)
      if (!node || node.textbook_id !== textbookId || node.archived_at !== null) return false
    }
    return true
  })
}

function pendingProblemTags(subject: string, textbookId: string) {
  return fake.problemTags.filter((pt) => {
    if (pt.subject !== subject || pt.superseded_at !== null || pt.is_locked !== 0) return false
    if (['user_verified', 'rejected'].includes(pt.verification_status)) return false
    const reviewable =
      ['unmapped', 'candidate'].includes(pt.mapping_status) ||
      ['needs_review', 'ai_verified'].includes(pt.verification_status)
    if (!reviewable) return false
    if (pt.tag_type === 'knowledge') {
      if (textbookId === '') return false
      const problem = fake.problems.find((item) => item.id === pt.problem_id)
      if (!problem || problem.matched_textbook_id !== textbookId) return false
    }
    return true
  })
}

const ok = { rowsAffected: 1, lastInsertId: 0 }

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (command: string, args?: { sql?: string; params?: unknown[] }) => {
    const sql = (args?.sql ?? '').trim()
    const params = (args?.params ?? []) as unknown[]
    if (command === 'db_select') {
      if (sql.startsWith('SELECT count(*) AS count FROM (')) {
        const [subject, textbookId] = params as [string, string]
        return [{
          count: pendingDefinitions(subject, textbookId).length +
            pendingProblemTags(subject, textbookId).length,
        }]
      }
      if (sql.startsWith('SELECT version FROM taxonomy_versions')) return [{ version: 1 }]
      return []
    }
    if (command !== 'db_execute') throw new Error(`unexpected invoke: ${command}`)
    if (sql === 'BEGIN IMMEDIATE' || sql === 'COMMIT' || sql === 'ROLLBACK') return ok
    // reviewTagDefinition 的单项批准/驳回写入
    if (sql.startsWith('UPDATE tag_definitions SET lifecycle_status = $1')) {
      const [lifecycle, verification, archivedAt, , , id, subject] = params
      const definition = fake.definitions.find((td) => td.id === id && td.subject === subject)
      if (definition) {
        definition.lifecycle_status = String(lifecycle)
        definition.verification_status = String(verification)
        definition.archived_at = archivedAt == null ? null : Number(archivedAt)
      }
      return ok
    }
    return ok
  }),
}))

// 一键批准走 Rust bulk_review_curriculum_tags；此处按 horizon.rs
// bulk_review_curriculum_tags_in_transaction 的 approve 语义对假数据库求值。
vi.mock('./native', () => ({
  bulkReviewCurriculumTags: vi.fn(async (request: {
    subject: string
    tagType: string
    textbookId: string | null
    definitionIds: string[]
    problemTagIds: string[]
    decision: string
  }) => {
    const textbookId = request.textbookId?.trim() || null
    let approvedDefinitions = 0
    let approvedProblemTags = 0
    if (request.decision === 'approve') {
      for (const td of fake.definitions) {
        if (td.subject !== request.subject || td.tag_type !== request.tagType) continue
        if (!request.definitionIds.includes(td.id)) continue
        if (['archived', 'merged', 'rejected'].includes(td.lifecycle_status)) continue
        if (['user_verified', 'rejected'].includes(td.verification_status)) continue
        if (!(td.lifecycle_status === 'candidate' || td.verification_status === 'needs_review')) continue
        if (td.tag_type === 'knowledge') {
          const node = nodeOf(td.knowledge_node_id)
          if (!textbookId || !node || node.textbook_id !== textbookId || node.archived_at !== null) continue
        }
        td.lifecycle_status = 'active'
        td.verification_status = 'user_verified'
        approvedDefinitions += 1
      }
      for (const pt of fake.problemTags) {
        if (pt.subject !== request.subject || pt.tag_type !== request.tagType) continue
        if (!request.problemTagIds.includes(pt.id)) continue
        if (pt.superseded_at !== null || pt.is_locked !== 0) continue
        if (['user_verified', 'rejected'].includes(pt.verification_status)) continue
        if (pt.mapping_status !== 'mapped' || !pt.tag_id) continue
        const definition = fake.definitions.find((td) => td.id === pt.tag_id)
        if (!definition || definition.subject !== pt.subject || definition.tag_type !== pt.tag_type) continue
        if (definition.lifecycle_status !== 'active' || definition.verification_status === 'rejected') continue
        if (pt.tag_type === 'knowledge') {
          const node = nodeOf(definition.knowledge_node_id)
          if (!textbookId || !node || node.textbook_id !== textbookId || node.archived_at !== null) continue
          const problem = fake.problems.find((item) => item.id === pt.problem_id)
          if (!problem || problem.matched_textbook_id !== textbookId) continue
        }
        pt.verification_status = 'user_verified'
        pt.is_locked = 1
        approvedProblemTags += 1
      }
    }
    return {
      approvedDefinitions,
      rejectedDefinitions: 0,
      approvedProblemTags,
      rejectedProblemTags: 0,
      skippedUnmapped: 0,
      skippedLocked: 0,
      skippedInvalid: 0,
    }
  }),
  completeCurriculumImportAttempt: vi.fn(),
  bindRelabelBatchItemModelRun: vi.fn(),
  claimRelabelBatchItem: vi.fn(),
  createCurriculumImportAttempt: vi.fn(),
  failCurriculumImportAttempt: vi.fn(),
  updateCurriculumImportProgress: vi.fn(),
  importTextbookSource: vi.fn(),
  cleanupTextbookImportTemp: vi.fn(),
  mergeKnowledgeNodes: vi.fn(),
  mergeTagDefinitions: vi.fn(),
  promoteTextbookSource: vi.fn(),
  recoverRelabelBatchItems: vi.fn(),
  removeTextbookSource: vi.fn(),
  verifyTextbookSource: vi.fn(),
}))

import {
  bulkReviewTagScope,
  getCurriculumReviewCount,
  reviewTagDefinition,
} from './horizonDatabase'

function seed() {
  fake.nodes = [{ id: 'node-1', textbook_id: 'book-1', archived_at: null }]
  fake.problems = [
    { id: 'p-1', matched_textbook_id: 'book-1' },
    { id: 'p-2', matched_textbook_id: 'book-1' },
  ]
  fake.definitions = [
    {
      id: 'td-knowledge', subject: '数学', tag_type: 'knowledge',
      knowledge_node_id: 'node-1', lifecycle_status: 'candidate',
      verification_status: 'needs_review', archived_at: null,
    },
    {
      id: 'td-method', subject: '数学', tag_type: 'method',
      knowledge_node_id: null, lifecycle_status: 'candidate',
      verification_status: 'needs_review', archived_at: null,
    },
  ]
  fake.problemTags = [
    {
      id: 'pt-knowledge', problem_id: 'p-1', subject: '数学', tag_type: 'knowledge',
      tag_id: 'td-knowledge', mapping_status: 'mapped',
      verification_status: 'needs_review', is_locked: 0, superseded_at: null,
    },
    {
      id: 'pt-method', problem_id: 'p-2', subject: '数学', tag_type: 'method',
      tag_id: 'td-method', mapping_status: 'mapped',
      verification_status: 'needs_review', is_locked: 0, superseded_at: null,
    },
  ]
}

const asTagDefinition = (id: string): TagDefinition => {
  const definition = fake.definitions.find((td) => td.id === id)
  if (!definition) throw new Error(`missing ${id}`)
  return {
    id: definition.id,
    subject: definition.subject,
    tagType: definition.tag_type as TagDefinition['tagType'],
    canonicalName: id,
    aliases: [],
    description: null,
    parentId: null,
    knowledgeNodeId: definition.knowledge_node_id,
    textbookId: 'book-1',
    source: 'ai_inferred',
    taxonomyVersion: 1,
    verificationStatus: definition.verification_status as TagDefinition['verificationStatus'],
    lifecycleStatus: definition.lifecycle_status as TagDefinition['lifecycleStatus'],
    methodClass: null,
    mergedIntoId: null,
    archivedAt: definition.archived_at,
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('curriculum review count', () => {
  beforeEach(seed)

  it('counts tag definitions and problem tags pending review for the scoped textbook', async () => {
    expect(await getCurriculumReviewCount('数学', 'book-1')).toBe(4)
    // 其他科目不计入
    expect(await getCurriculumReviewCount('英语', 'book-1')).toBe(0)
  })

  it('decrements on single approval and reaches zero after bulk approve-all', async () => {
    expect(await getCurriculumReviewCount('数学', 'book-1')).toBe(4)

    // 单项批准一个标签定义
    await reviewTagDefinition(asTagDefinition('td-method'), 'approve')
    expect(await getCurriculumReviewCount('数学', 'book-1')).toBe(3)

    // 一键批准：knowledge 维度（定义 + 题目映射）
    await bulkReviewTagScope({
      subject: '数学', tagType: 'knowledge', textbookId: 'book-1',
      definitionIds: ['td-knowledge'], problemTagIds: ['pt-knowledge'], decision: 'approve',
    })
    expect(await getCurriculumReviewCount('数学', 'book-1')).toBe(1)

    // 一键批准：method 维度剩余的题目标签
    await bulkReviewTagScope({
      subject: '数学', tagType: 'method', textbookId: null,
      definitionIds: [], problemTagIds: ['pt-method'], decision: 'approve',
    })
    expect(await getCurriculumReviewCount('数学', 'book-1')).toBe(0)
  })

  it('keeps the count predicate aligned with approval writes', () => {
    const source = horizonDatabaseSource
    // 计数排除批准写入的终态
    expect(source).toContain("td.verification_status NOT IN ('user_verified', 'rejected')")
    expect(source).toContain("td.lifecycle_status NOT IN ('archived', 'merged', 'rejected')")
    expect(source).toContain("pt.verification_status NOT IN ('user_verified', 'rejected')")
    expect(source).toContain('pt.is_locked = 0')
    // knowledge 维度按教材限定
    expect(source).toContain('kn.textbook_id = $2 AND kn.archived_at IS NULL')
    expect(source).toContain('p.matched_textbook_id = $2')
  })
})

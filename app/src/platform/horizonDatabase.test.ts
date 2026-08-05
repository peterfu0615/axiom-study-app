import { beforeEach, describe, expect, it, vi } from 'vitest'
// @ts-expect-error Vitest executes this contract in Node, while the app tsconfig is browser-only.
import { readFileSync } from 'node:fs'

// Records every statement funneled through db_execute / db_select so the
// cancel contract can be asserted on the exact SQL sequence.  Overrides let
// individual tests simulate affected-row counts and query results.
const recorded = vi.hoisted(() => {
  const calls: Array<{ sql: string; params: unknown[] }> = []
  const executeOverrides: Array<{ match: RegExp; rowsAffected: number }> = []
  const selectOverrides: Array<{ match: RegExp; rows: unknown[] }> = []
  return { calls, executeOverrides, selectOverrides }
})

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (command: string, args?: { sql?: string; params?: unknown[] }) => {
    if (command === 'db_execute' || command === 'db_select') {
      const sql = (args?.sql ?? '').trim()
      recorded.calls.push({ sql, params: args?.params ?? [] })
      if (command === 'db_select') {
        return recorded.selectOverrides.find((entry) => entry.match.test(sql))?.rows ?? []
      }
      return {
        rowsAffected: recorded.executeOverrides.find((entry) => entry.match.test(sql))?.rowsAffected ?? 0,
        lastInsertId: 0,
      }
    }
    throw new Error(`unexpected invoke: ${command}`)
  }),
}))

vi.mock('./native', () => ({
  completeCurriculumImportAttempt: vi.fn(),
  bindRelabelBatchItemModelRun: vi.fn(),
  claimRelabelBatchItem: vi.fn(),
  createCurriculumImportAttempt: vi.fn(),
  bulkReviewCurriculumTags: vi.fn(),
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
  archiveTextbook,
  cancelRelabelBatch,
  getTextbookDeletionImpact,
  listHorizonSubjects,
  listTextbooks,
} from './horizonDatabase'

describe('cancelRelabelBatch', () => {
  beforeEach(() => {
    recorded.calls.length = 0
  })

  const statements = () => recorded.calls.map((call) => call.sql)

  it('runs every statement inside one immediate transaction', async () => {
    await cancelRelabelBatch('batch-1')
    const sequence = statements()
    expect(sequence[0]).toBe('BEGIN IMMEDIATE')
    expect(sequence.at(-1)).toBe('COMMIT')
    expect(sequence.filter((sql) => sql === 'BEGIN IMMEDIATE')).toHaveLength(1)
  })

  it('cancels only pending/processing relabel model runs', async () => {
    await cancelRelabelBatch('batch-1')
    const runUpdate = recorded.calls.find(
      (call) => call.sql.startsWith('UPDATE model_runs') && call.sql.includes("'cancelled'"),
    )
    expect(runUpdate).toBeDefined()
    expect(runUpdate!.sql).toContain("status IN ('pending', 'processing')")
    expect(runUpdate!.sql).toContain('SELECT model_run_id FROM tag_relabel_items WHERE batch_id = $1')
    expect(runUpdate!.params).toEqual(['batch-1'])
  })

  it('restores problems.ai_status from the last completed run instead of marking it failed', async () => {
    await cancelRelabelBatch('batch-1')
    const problemUpdate = recorded.calls.find((call) => call.sql.startsWith('UPDATE problems'))
    expect(problemUpdate).toBeDefined()
    const sql = problemUpdate!.sql
    // 取消 relabel 绝不能把主管线状态污染为 failed
    expect(sql).not.toContain("'failed'")
    // 有已完成 run → completed；否则回到 not_started
    expect(sql).toContain("THEN 'completed'")
    expect(sql).toContain("ELSE 'not_started' END")
    expect(sql).toContain("AND run.status = 'completed'")
    // 活跃 run 指回最近一条已完成的分析 run（无则 NULL），保持展示/重跑链路一致
    expect(sql).toContain("run.task_type = 'analyze_problem_image'")
    expect(sql).toContain('ORDER BY run.created_at DESC, run.id DESC')
    // 只撤回 relabel 引入的 pending/processing 状态，真正的失败保留
    expect(sql).toContain("ai_status IN ('pending', 'processing')")
    expect(sql).toContain('WHERE batch_id = $2 AND model_run_id IS NOT NULL')
    expect(problemUpdate!.params).toEqual([expect.any(Number), 'batch-1'])
  })

  it('cancels the model runs before restoring problem state', async () => {
    await cancelRelabelBatch('batch-1')
    const sequence = statements()
    const runCancelIndex = sequence.findIndex(
      (sql) => sql.startsWith('UPDATE model_runs') && sql.includes("'cancelled'"),
    )
    const problemRestoreIndex = sequence.findIndex((sql) => sql.startsWith('UPDATE problems'))
    expect(runCancelIndex).toBeGreaterThan(0)
    expect(problemRestoreIndex).toBeGreaterThan(runCancelIndex)
  })

  it('cancels remaining items and the batch itself', async () => {
    await cancelRelabelBatch('batch-1')
    const sequence = statements()
    expect(
      sequence.some(
        (sql) =>
          sql.startsWith('UPDATE tag_relabel_items') &&
          sql.includes("status = 'cancelled'") &&
          sql.includes("status IN ('pending', 'queued', 'processing')"),
      ),
    ).toBe(true)
    expect(
      sequence.some(
        (sql) =>
          sql.startsWith('UPDATE tag_relabel_batches') &&
          sql.includes("status = 'cancelled'") &&
          sql.includes('paused_at = NULL'),
      ),
    ).toBe(true)
  })
})
describe('knowledge node import dedupe contract', () => {
  it('preloads active siblings once and reuses them instead of inserting duplicates', () => {
    const source = readFileSync(new URL('./horizonDatabase.ts', import.meta.url), 'utf8')
    // 一次往返装载整本教材的活跃节点，而不是每节点一次 SELECT
    expect(source).toContain('loadActiveKnowledgeSiblings')
    expect(source).toContain('SELECT id, parent_id, canonical_name, created_at FROM knowledge_nodes')
    expect(source).toContain('AND archived_at IS NULL AND merged_into_id IS NULL')
    // JS 端键与 migration 0028 部分唯一索引的 lower(trim()) 口径一致
    expect(source).toContain("canonicalName.trim().toLowerCase()")
    // 章节与知识点都从 sibling 映射中解析复用节点
    expect(source).toContain('siblingKey(null, chapter.title)')
    expect(source).toContain('siblingKey(chapterId, point.name)')
    // 节点与页都走多行批量插入，减少 IPC 往返
    expect(source).toContain('executeBatchedInsert')
    expect(source).toContain('INSERT_BATCH_ROWS')
    expect(source).not.toContain('findActiveSiblingNodeId')
  })
})

describe('archiveTextbook soft delete', () => {
  beforeEach(() => {
    recorded.calls.length = 0
    recorded.executeOverrides.length = 0
    recorded.selectOverrides.length = 0
  })

  const statements = () => recorded.calls.map((call) => call.sql)

  it('archives the textbook and clears only unlocked problem matches in one transaction', async () => {
    recorded.executeOverrides.push({ match: /UPDATE textbooks SET archived_at/, rowsAffected: 1 })
    await expect(archiveTextbook('book-1')).resolves.toBe(true)
    const sequence = statements()
    expect(sequence[0]).toBe('BEGIN IMMEDIATE')
    expect(sequence.at(-1)).toBe('COMMIT')
    expect(sequence.filter((sql) => sql === 'BEGIN IMMEDIATE')).toHaveLength(1)
    const textbookUpdate = recorded.calls.find((call) => call.sql.startsWith('UPDATE textbooks'))!
    expect(textbookUpdate.sql).toContain('archived_at = $1')
    expect(textbookUpdate.sql).toContain('is_current = 0')
    // 软删除只作用于活跃教材，重复归档天然幂等
    expect(textbookUpdate.sql).toContain('AND archived_at IS NULL')
    expect(textbookUpdate.params).toEqual([expect.any(Number), 'book-1'])
    const problemUpdate = recorded.calls.find((call) => call.sql.startsWith('UPDATE problems'))!
    expect(problemUpdate.sql).toContain('matched_textbook_id = NULL')
    expect(problemUpdate.sql).toContain("textbook_match_source = 'unresolved'")
    expect(problemUpdate.sql).toContain('textbook_match_locked = 0')
    // 已锁定的匹配是用户的显式选择，删课后必须保留
    expect(problemUpdate.sql).toContain('WHERE matched_textbook_id = $2 AND textbook_match_locked = 0')
    expect(problemUpdate.params).toEqual([expect.any(Number), 'book-1'])
  })

  it('is idempotent: re-archiving reports no deletion and skips match cleanup', async () => {
    // 默认 rowsAffected = 0 → 教材已归档，二次调用返回未删除
    await expect(archiveTextbook('book-1')).resolves.toBe(false)
    expect(statements().some((sql) => sql.startsWith('UPDATE problems'))).toBe(false)
  })

  it('list queries keep hiding archived textbooks afterwards', async () => {
    await listTextbooks('数学')
    await listHorizonSubjects()
    const textbookList = recorded.calls.find((call) => call.sql.includes('SELECT * FROM textbooks'))!
    expect(textbookList.sql).toContain('archived_at IS NULL')
    const subjectList = recorded.calls.find((call) => call.sql.startsWith('SELECT subject FROM textbooks'))!
    expect(subjectList.sql).toContain('archived_at IS NULL')
  })
})

describe('getTextbookDeletionImpact', () => {
  beforeEach(() => {
    recorded.calls.length = 0
    recorded.executeOverrides.length = 0
    recorded.selectOverrides.length = 0
  })

  it('counts chapters, knowledge points, pages and matched problems', async () => {
    recorded.selectOverrides.push(
      {
        match: /FROM knowledge_nodes/,
        rows: [
          { node_type: 'chapter', count: 3 },
          { node_type: 'knowledge', count: 5 },
          { node_type: 'formula', count: 2 },
          { node_type: 'section', count: 1 },
        ],
      },
      { match: /FROM textbook_pages/, rows: [{ count: 12 }] },
      { match: /FROM problems/, rows: [{ count: 4 }] },
    )
    await expect(getTextbookDeletionImpact('book-1')).resolves.toEqual({
      chapterCount: 3,
      knowledgeCount: 7,
      pageCount: 12,
      matchedProblemCount: 4,
    })
    const nodeQuery = recorded.calls.find((call) => call.sql.includes('FROM knowledge_nodes'))!
    // 已归档节点不计入删除影响
    expect(nodeQuery.sql).toContain('AND archived_at IS NULL')
    const problemQuery = recorded.calls.find((call) => call.sql.includes('FROM problems'))!
    expect(problemQuery.sql).toContain('matched_textbook_id = $1')
    expect(problemQuery.sql).toContain('deleted_at IS NULL')
  })
})

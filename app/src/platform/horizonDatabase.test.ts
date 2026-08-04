import { beforeEach, describe, expect, it, vi } from 'vitest'
// @ts-expect-error Vitest executes this contract in Node, while the app tsconfig is browser-only.
import { readFileSync } from 'node:fs'

// Records every statement funneled through db_execute / db_select so the
// cancel contract can be asserted on the exact SQL sequence.
const recorded = vi.hoisted(() => {
  const calls: Array<{ sql: string; params: unknown[] }> = []
  return { calls }
})

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (command: string, args?: { sql?: string; params?: unknown[] }) => {
    if (command === 'db_execute' || command === 'db_select') {
      recorded.calls.push({ sql: (args?.sql ?? '').trim(), params: args?.params ?? [] })
      return command === 'db_select' ? [] : { rowsAffected: 0, lastInsertId: 0 }
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

import { cancelRelabelBatch } from './horizonDatabase'

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
  it('checks for an active sibling before inserting so re-imports merge instead of failing', () => {
    const source = readFileSync(new URL('./horizonDatabase.ts', import.meta.url), 'utf8')
    expect(source).toContain('findActiveSiblingNodeId')
    expect(source).toContain('lower(trim(canonical_name)) = lower(trim($3))')
    expect(source).toContain('AND archived_at IS NULL AND merged_into_id IS NULL')
    // 章节与知识点都必须先查重再插入
    expect(source).toContain('findActiveSiblingNodeId(input.textbookId, null, chapter.title)')
    expect(source).toContain('findActiveSiblingNodeId(input.textbookId, chapterId, point.name)')
  })
})

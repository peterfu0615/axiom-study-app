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
  getCurriculumImportJob,
  getTextbookDeletionImpact,
  listHorizonSubjects,
  listTextbooks,
  resolveProblemTextbookBeforeAnalysis,
  resolveProblemTextbookContextBeforeAnalysis,
  runCurriculumImportJob,
  writeControlledProblemAnalysis,
} from './horizonDatabase'
import { verifyTextbookSource } from './native'

const textbookRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'book-1', subject: '数学', title: '数学八年级下册', grade: '八年级',
  volume: '下册', publisher: '人民教育出版社', edition: '2022年版',
  source_type: 'pdf', source_path: null, content_hash: null,
  extraction_status: 'completed', extraction_method: 'pdf_text', is_current: 0,
  archived_at: null, created_at: 1, updated_at: 1, ...overrides,
})

const curriculumJobRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'job-1', original_source_path: '/tmp/math.pdf', source_path: '/tmp/math.pdf',
  source_name: 'math.pdf', source_type: 'pdf', content_hash: 'hash',
  status: 'ai_analyzing_structure', resume_stage: 'ai_analyzing_structure',
  page_count: 1, extraction_method: 'pdf_text', extraction_json: '{"pageCount":1,"extractionMethod":"pdf_text","pages":[],"outline":[],"warnings":[]}',
  metadata_json: null, provider: 'provider-1', model: 'model-1',
  prompt_version: 'v1', schema_version: 'v1', input_hash: 'input', raw_output: null,
  error_message: null, error_code: null, error_json: null, provider_task_id: null,
  structure_json: null, tags_json: null, audit_json: null,
  progress_current: 0, progress_total: 1, progress_fraction: 0, progress_label: '',
  created_at: 1, updated_at: 1, ...overrides,
})

describe('curriculum structured failure compatibility', () => {
  beforeEach(() => {
    recorded.calls.length = 0
    recorded.executeOverrides.length = 0
    recorded.selectOverrides.length = 0
    vi.mocked(verifyTextbookSource).mockReset()
  })

  it('hydrates a persisted envelope and classifies a legacy error message', async () => {
    const envelope = {
      code: 'RATE_LIMIT_ERROR', title: '模型服务繁忙', userMessage: '请稍后重试。',
      retryable: true, fallbackAllowed: true, providerId: 'provider-1', model: 'model-1',
      httpStatus: 429, runId: null, attemptId: 'attempt-1', detailSafe: 'status=429', occurredAt: 1,
    }
    recorded.selectOverrides.push({
      match: /SELECT \* FROM curriculum_import_jobs WHERE id = \$1/,
      rows: [curriculumJobRow({ error_message: '旧版 timeout', error_json: JSON.stringify(envelope) })],
    })
    await expect(getCurriculumImportJob('job-1')).resolves.toMatchObject({ error: envelope })

    recorded.selectOverrides[0].rows = [curriculumJobRow({ error_message: '旧版 timeout' })]
    await expect(getCurriculumImportJob('job-1')).resolves.toMatchObject({
      error: { code: 'TIMEOUT_ERROR', retryable: true },
    })
  })

  it('persists source verification failures as machine-readable errors', async () => {
    recorded.selectOverrides.push({
      match: /SELECT \* FROM curriculum_import_jobs WHERE id = \$1/,
      rows: [curriculumJobRow()],
    })
    vi.mocked(verifyTextbookSource).mockRejectedValueOnce(new Error('network connection failed'))

    await runCurriculumImportJob('job-1')

    const update = recorded.calls.find((call) =>
      call.sql.startsWith("UPDATE curriculum_import_jobs SET status = 'ai_failed_recoverable'"),
    )
    expect(update?.sql).toContain('error_code = $3, error_json = $4')
    expect(update?.params[2]).toBe('NETWORK_ERROR')
    expect(JSON.parse(String(update?.params[3]))).toMatchObject({
      code: 'NETWORK_ERROR', providerId: 'provider-1', model: 'model-1',
    })
  })
})

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

describe('resolveProblemTextbookBeforeAnalysis', () => {
  beforeEach(() => {
    recorded.calls.length = 0
    recorded.executeOverrides.length = 0
    recorded.selectOverrides.length = 0
  })

  function seed(problem: Record<string, unknown>, books: Array<Record<string, unknown>>) {
    recorded.selectOverrides.push(
      { match: /COALESCE\(NULLIF\(user_title/, rows: [{
        effective_subject: '数学', title: '八年级下册一次函数', stem_markdown: '求解析式',
        matched_textbook_id: null, textbook_match_locked: 0, ...problem,
      }] },
      { match: /SELECT \* FROM textbooks WHERE subject = \$1 ORDER BY/, rows: books },
      { match: /SELECT p\.id, trim/, rows: [{
        id: 'problem-1', effective_subject: '数学', matched_textbook_id: books[0]?.id ?? null,
        textbook_match_confidence: books.length === 1 ? .95 : 0,
        textbook_match_reason: books.length === 1 ? '当前科目只有一本未归档教材' : '教材元数据不足以安全匹配',
        textbook_match_source: books.length === 1 ? 'single_subject_textbook' : 'unresolved',
        textbook_match_locked: Number(problem.textbook_match_locked ?? 0),
        textbook_resolver_version: 'problem-textbook-resolver-v1',
        textbook_candidate_count: books.length, textbook_decision_json: '{}',
        textbook_id: books[0]?.id ?? null, textbook_subject: books[0]?.subject,
        textbook_title: books[0]?.title, textbook_grade: books[0]?.grade,
        textbook_volume: books[0]?.volume, textbook_publisher: books[0]?.publisher,
        textbook_edition: books[0]?.edition, textbook_source_type: books[0]?.source_type,
        textbook_source_path: null, textbook_content_hash: null,
        textbook_extraction_status: books[0]?.extraction_status,
        textbook_extraction_method: books[0]?.extraction_method,
        textbook_is_current: 0, textbook_archived_at: null,
        textbook_created_at: 1, textbook_updated_at: 1,
      }] },
      { match: /archived_at IS NULL\s+AND extraction_status/, rows: books },
    )
  }

  it('auto-selects the only eligible textbook before provider dispatch', async () => {
    seed({}, [textbookRow()])
    await expect(resolveProblemTextbookBeforeAnalysis('problem-1')).resolves.toMatchObject({
      textbook: { id: 'book-1' }, source: 'single_subject_textbook',
    })
    const update = recorded.calls.find((call) => call.sql.includes('textbook_resolver_version = $6'))!
    expect(update.params).toEqual([
      'book-1', .95, '当前科目只有一本未归档教材', 'single_subject_textbook',
      expect.any(Number), 'problem-textbook-resolver-v1', 1, expect.any(String), 'problem-1',
    ])
  })

  it('preserves a user lock while refreshing resolver audit metadata', async () => {
    seed({ matched_textbook_id: 'book-1', textbook_match_locked: 1 }, [textbookRow()])
    await resolveProblemTextbookBeforeAnalysis('problem-1')
    expect(recorded.calls.some((call) => call.sql.includes('textbook_resolver_version = $1'))).toBe(true)
    expect(recorded.calls.some((call) => call.sql.includes('matched_textbook_id = $1'))).toBe(false)
  })

  it('rejects a locked textbook that is outside the effective subject candidates', async () => {
    seed({ matched_textbook_id: 'other-subject-book', textbook_match_locked: 1 }, [textbookRow()])
    await expect(resolveProblemTextbookBeforeAnalysis('problem-1'))
      .rejects.toThrow('锁定教材与题目科目不一致')
    expect(recorded.calls.some((call) => call.sql.includes('UPDATE problems SET'))).toBe(false)
  })

  it('records unresolved without inventing a textbook when no eligible book exists', async () => {
    seed({}, [])
    await resolveProblemTextbookBeforeAnalysis('problem-1')
    const update = recorded.calls.find((call) => call.sql.includes('textbook_resolver_version = $6'))!
    expect(update.params[0]).toBeNull()
    expect(update.params[3]).toBe('unresolved')
    expect(update.params[6]).toBe(0)
  })

  it('retrieves a bounded canonical context only from the selected textbook', async () => {
    seed({}, [textbookRow()])
    recorded.selectOverrides.push(
      { match: /AS problem_text/, rows: [{ problem_text: '利用全等判定证明三角形全等' }] },
      { match: /td\.id AS canonical_tag_id/, rows: [{
        canonical_tag_id: 'tag-1', canonical_name: '三角形全等的判定', taxonomy_version: 4,
        knowledge_node_id: 'node-1', path: '第十二章/三角形全等的判定',
        evidence_text: '教材第十二章', aliases: `全等判定${String.fromCharCode(31)}判定全等`,
      }] },
    )
    const result = await resolveProblemTextbookContextBeforeAnalysis('problem-1')
    expect(result.context).toMatchObject({
      textbookId: 'book-1', subject: '数学', taxonomyVersion: 4,
      totalKnowledgeCount: 1, candidateLimit: 30,
      candidates: [{ canonicalTagId: 'tag-1', knowledgeNodeId: 'node-1' }],
    })
    const query = recorded.calls.find((call) => call.sql.includes('td.id AS canonical_tag_id'))!
    expect(query.params).toEqual(['数学', 'book-1'])
    expect(query.sql).toContain("td.lifecycle_status = 'active'")
    expect(query.sql).toContain('kn.textbook_id = $2')
  })

  it('does not query or fabricate canonical knowledge when resolution is unresolved', async () => {
    seed({}, [])
    const result = await resolveProblemTextbookContextBeforeAnalysis('problem-1')
    expect(result.context).toBeNull()
    expect(recorded.calls.some((call) => call.sql.includes('canonical_tag_id'))).toBe(false)
  })
})

describe('writeControlledProblemAnalysis', () => {
  beforeEach(() => {
    recorded.calls.length = 0
    recorded.executeOverrides.length = 0
    recorded.selectOverrides.length = 0
    recorded.selectOverrides.push(
      { match: /SELECT textbook_match_locked FROM problems/, rows: [{ textbook_match_locked: 0 }] },
      { match: /SELECT version FROM taxonomy_versions/, rows: [{ version: 5 }] },
      { match: /SELECT id FROM problem_difficulties/, rows: [] },
    )
  })

  it('persists unknown knowledge as an unresolved ProblemTag without minting a fake definition', async () => {
    await writeControlledProblemAnalysis({
      problemId: 'problem-1', modelRunId: 'run-1', subject: '数学', now: 100,
      textbookMatch: { textbook: textbookRow() as never, confidence: .9, reason: '单本教材', source: 'single_subject_textbook' },
      definitions: [],
      candidateGroups: [['knowledge', [{
        canonicalTagId: null, name: '候选中不存在的知识', role: 'primary', confidence: .7,
        evidence: '题面证据', source: 'problem',
      }]]],
      difficulty: null,
    })
    expect(recorded.calls.some((call) => call.sql.startsWith('INSERT OR IGNORE INTO tag_definitions')))
      .toBe(false)
    const insert = recorded.calls.find((call) => call.sql.startsWith('INSERT OR IGNORE INTO problem_tags'))!
    expect(insert.params[4]).toBeNull()
    expect(insert.params[5]).toBe('候选中不存在的知识')
    expect(insert.params[7]).toBe('unmapped')
  })

  it('supersedes only unlocked unconfirmed model tags during re-analysis', async () => {
    await writeControlledProblemAnalysis({
      problemId: 'problem-1', modelRunId: 'run-2', subject: '数学', now: 200,
      textbookMatch: { textbook: null, confidence: 0, reason: '未匹配', source: 'unresolved' },
      definitions: [], candidateGroups: [], difficulty: null,
    })
    const supersede = recorded.calls.find((call) =>
      call.sql.startsWith('UPDATE problem_tags SET superseded_at'))!
    expect(supersede.sql).toContain("source = 'model'")
    expect(supersede.sql).toContain('is_locked = 0')
    expect(supersede.sql).toContain("verification_status != 'user_verified'")
  })

  it('does not replace a locked or user-confirmed difficulty during re-analysis', async () => {
    const difficultyRows = recorded.selectOverrides.find((entry) =>
      entry.match.test('SELECT id FROM problem_difficulties'))!
    difficultyRows.rows = [{ id: 'difficulty-user' }]
    await writeControlledProblemAnalysis({
      problemId: 'problem-1', modelRunId: 'run-2', subject: '数学', now: 300,
      textbookMatch: { textbook: null, confidence: 0, reason: '未匹配', source: 'unresolved' },
      definitions: [], candidateGroups: [],
      difficulty: { level: 'advanced', score: .9, reason: '综合题', confidence: .95 },
    })
    expect(recorded.calls.some((call) => call.sql.startsWith('INSERT INTO problem_difficulties')))
      .toBe(false)
    expect(recorded.calls.some((call) => call.sql.startsWith('UPDATE problem_difficulties SET superseded_at')))
      .toBe(false)
  })
})

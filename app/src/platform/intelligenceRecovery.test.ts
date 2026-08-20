import { beforeEach, describe, expect, it, vi } from 'vitest'

// Stateful fake for the single sqlx connection: interprets every statement
// that recoverIntelligenceTasks / queueStudentAttempt / queueReasoningAnalysis
// emit, so the tests assert final database state, not just SQL text. Any
// unrecognized statement throws, which pins the statement contract.

const STUDENT = 'extract_student_attempt'
const REASONING = 'analyze_student_reasoning'
const EXPLAIN = 'explain_selection'

interface RunRow {
  id: string
  problem_id: string
  task_type: string
  status: string
  error_message: string | null
  output_json: string | null
}

interface AttemptRow {
  id: string
  problem_id: string
  status: string
  active_model_run_id: string | null
  error_message: string | null
  raw_markdown: string
  steps_json: string
  answer_region_ids_json: string
  created_at: number
  updated_at: number
}

interface AnalysisRow {
  id: string
  problem_id: string
  student_attempt_id: string
  solution_id: string | null
  status: string
  active_model_run_id: string | null
  error_message: string | null
  approach: string | null
  step_evaluations_json: string | null
  first_wrong_step: number | null
  error_type: string | null
  reason: string | null
  knowledge_gaps_json: string | null
  suggestion: string | null
  created_at: number
  updated_at: number
}

const state = vi.hoisted(() => {
  return {
    runs: new Map<string, RunRow>(),
    attempts: new Map<string, AttemptRow>(),
    analyses: new Map<string, AnalysisRow>(),
    problems: new Map<string, Record<string, unknown>>(),
    regions: new Map<string, Array<Record<string, unknown>>>(),
    statements: [] as string[],
  }
})

function resetState() {
  state.runs.clear()
  state.attempts.clear()
  state.analyses.clear()
  state.problems.clear()
  state.regions.clear()
  state.statements.length = 0
}

function addRun(partial: Partial<RunRow> & Pick<RunRow, 'id' | 'task_type'>): RunRow {
  const row: RunRow = {
    problem_id: 'problem-1',
    status: 'pending',
    error_message: null,
    output_json: null,
    ...partial,
  }
  state.runs.set(row.id, row)
  return row
}

function addAttempt(partial: Partial<AttemptRow> & Pick<AttemptRow, 'id' | 'problem_id'>): AttemptRow {
  const row: AttemptRow = {
    status: 'pending',
    active_model_run_id: null,
    error_message: null,
    raw_markdown: '',
    steps_json: '[]',
    answer_region_ids_json: '[]',
    created_at: 1,
    updated_at: 1,
    ...partial,
  }
  state.attempts.set(row.problem_id, row)
  return row
}

function addAnalysis(partial: Partial<AnalysisRow> & Pick<AnalysisRow, 'id' | 'problem_id' | 'student_attempt_id'>): AnalysisRow {
  const row: AnalysisRow = {
    solution_id: null,
    status: 'pending',
    active_model_run_id: null,
    error_message: null,
    approach: null,
    step_evaluations_json: null,
    first_wrong_step: null,
    error_type: null,
    reason: null,
    knowledge_gaps_json: null,
    suggestion: null,
    created_at: 1,
    updated_at: 1,
    ...partial,
  }
  state.analyses.set(row.student_attempt_id, row)
  return row
}

function attemptByRun(runId: string) {
  return [...state.attempts.values()].find((attempt) => attempt.active_model_run_id === runId)
}

function analysisByRun(runId: string) {
  return [...state.analyses.values()].find((analysis) => analysis.active_model_run_id === runId)
}

function runSelect(sql: string, params: unknown[]): unknown[] {
  if (sql.includes('SELECT attempt.id AS attempt_id')) {
    return [...state.attempts.values()]
      .filter((attempt) => {
        const run = attempt.active_model_run_id ? state.runs.get(attempt.active_model_run_id) : null
        return Boolean(
          run &&
          (attempt.status === 'pending' || attempt.status === 'processing') &&
          run.task_type === params[0] &&
          run.status === 'completed',
        )
      })
      .map((attempt) => ({
        attempt_id: attempt.id,
        output_json: state.runs.get(attempt.active_model_run_id!)?.output_json ?? null,
      }))
  }
  if (sql.includes('SELECT analysis.id AS analysis_id')) {
    return [...state.analyses.values()]
      .filter((analysis) => {
        const run = analysis.active_model_run_id ? state.runs.get(analysis.active_model_run_id) : null
        return Boolean(
          run &&
          (analysis.status === 'pending' || analysis.status === 'processing') &&
          run.task_type === params[0] &&
          run.status === 'completed',
        )
      })
      .map((analysis) => ({
        analysis_id: analysis.id,
        output_json: state.runs.get(analysis.active_model_run_id!)?.output_json ?? null,
      }))
  }
  if (sql.includes('FROM problem_regions WHERE problem_id')) {
    return state.regions.get(String(params[0])) ?? []
  }
  if (sql.includes('FROM student_attempts WHERE problem_id')) {
    const row = state.attempts.get(String(params[0]))
    return row ? [row] : []
  }
  if (sql.includes('FROM reasoning_analyses WHERE problem_id')) {
    const row = [...state.analyses.values()].find((analysis) => analysis.problem_id === String(params[0]))
    return row ? [row] : []
  }
  if (sql.includes('FROM problems p') && sql.includes('WHERE p.id = $1')) {
    const row = state.problems.get(String(params[0]))
    return row ? [row] : []
  }
  if (sql.includes('FROM problem_solutions')) {
    return []
  }
  return []
}

function runExecute(sql: string, params: unknown[]): { rowsAffected: number; lastInsertId: number } {
  const ok = { rowsAffected: 1, lastInsertId: 0 }
  if (sql === 'BEGIN' || sql === 'BEGIN IMMEDIATE' || sql === 'COMMIT' || sql === 'ROLLBACK') {
    return { rowsAffected: 0, lastInsertId: 0 }
  }
  if (sql.startsWith('INSERT INTO model_runs')) {
    addRun({
      id: String(params[0]),
      problem_id: String(params[1]),
      task_type: String(params[2]),
      status: 'pending',
    })
    return ok
  }
  if (sql.startsWith('INSERT INTO student_attempts')) {
    const [attemptId, problemId, regionIdsJson, runId, now] = params as [string, string, string, string, number]
    const existing = state.attempts.get(problemId)
    if (existing) {
      existing.answer_region_ids_json = regionIdsJson
      existing.status = 'pending'
      existing.active_model_run_id = runId
      existing.raw_markdown = ''
      existing.steps_json = '[]'
      existing.error_message = null
      existing.updated_at = now
    } else {
      state.attempts.set(problemId, {
        id: attemptId,
        problem_id: problemId,
        status: 'pending',
        active_model_run_id: runId,
        error_message: null,
        raw_markdown: '',
        steps_json: '[]',
        answer_region_ids_json: regionIdsJson,
        created_at: now,
        updated_at: now,
      })
    }
    return ok
  }
  if (sql.startsWith('INSERT INTO reasoning_analyses')) {
    const [analysisId, problemId, attemptId, solutionId, runId, now] = params as [
      string, string, string, string | null, string, number,
    ]
    const existing = state.analyses.get(attemptId)
    if (existing) {
      existing.solution_id = solutionId
      existing.status = 'pending'
      existing.active_model_run_id = runId
      existing.error_message = null
      existing.updated_at = now
    } else {
      state.analyses.set(attemptId, {
        id: analysisId,
        problem_id: problemId,
        student_attempt_id: attemptId,
        solution_id: solutionId,
        status: 'pending',
        active_model_run_id: runId,
        error_message: null,
        approach: null,
        step_evaluations_json: null,
        first_wrong_step: null,
        error_type: null,
        reason: null,
        knowledge_gaps_json: null,
        suggestion: null,
        created_at: now,
        updated_at: now,
      })
    }
    return ok
  }
  if (sql.includes("UPDATE student_attempts SET status = 'completed'")) {
    const attempt = [...state.attempts.values()].find((item) => item.id === String(params[3]))
    if (!attempt) return { rowsAffected: 0, lastInsertId: 0 }
    attempt.status = 'completed'
    attempt.raw_markdown = String(params[0])
    attempt.steps_json = String(params[1])
    attempt.error_message = null
    attempt.updated_at = Number(params[2])
    return ok
  }
  if (sql.includes("UPDATE reasoning_analyses SET status = 'completed'")) {
    const analysis = [...state.analyses.values()].find((item) => item.id === String(params[8]))
    if (!analysis) return { rowsAffected: 0, lastInsertId: 0 }
    analysis.status = 'completed'
    analysis.approach = params[0] == null ? null : String(params[0])
    analysis.step_evaluations_json = String(params[1])
    analysis.first_wrong_step = params[2] == null ? null : Number(params[2])
    analysis.error_type = params[3] == null ? null : String(params[3])
    analysis.reason = params[4] == null ? null : String(params[4])
    analysis.knowledge_gaps_json = String(params[5])
    analysis.suggestion = params[6] == null ? null : String(params[6])
    analysis.error_message = null
    analysis.updated_at = Number(params[7])
    return ok
  }
  if (sql.includes('UPDATE student_attempts') && sql.includes("SET status = 'failed'")) {
    for (const attempt of state.attempts.values()) {
      if (attempt.status !== 'pending' && attempt.status !== 'processing') continue
      const run = attempt.active_model_run_id ? state.runs.get(attempt.active_model_run_id) : null
      if (run && run.task_type === String(params[1]) && run.status === 'failed') {
        attempt.status = 'failed'
        attempt.error_message = run.error_message ?? '用户解答任务在上次运行时失败'
        attempt.updated_at = Number(params[0])
      }
    }
    return ok
  }
  if (sql.includes('UPDATE reasoning_analyses') && sql.includes("SET status = 'failed'")) {
    for (const analysis of state.analyses.values()) {
      if (analysis.status !== 'pending' && analysis.status !== 'processing') continue
      const run = analysis.active_model_run_id ? state.runs.get(analysis.active_model_run_id) : null
      if (run && run.task_type === String(params[1]) && run.status === 'failed') {
        analysis.status = 'failed'
        analysis.error_message = run.error_message ?? '推理分析任务在上次运行时失败'
        analysis.updated_at = Number(params[0])
      }
    }
    return ok
  }
  if (sql.startsWith('UPDATE model_runs') && sql.includes("SET status = 'completed'")) {
    const table = sql.includes('student_attempts') ? 'attempt' : 'analysis'
    for (const run of state.runs.values()) {
      if (run.status !== 'pending' && run.status !== 'processing') continue
      if (run.task_type !== String(params[0])) continue
      const owner = table === 'attempt' ? attemptByRun(run.id) : analysisByRun(run.id)
      if (owner?.status === 'completed') {
        run.status = 'completed'
        run.error_message = null
      }
    }
    return ok
  }
  if (sql.startsWith('UPDATE model_runs') && sql.includes("SET status = 'pending'")) {
    const table = sql.includes('student_attempts') ? 'attempt' : 'analysis'
    for (const run of state.runs.values()) {
      if (run.status !== 'pending' && run.status !== 'processing') continue
      if (run.task_type !== String(params[0])) continue
      const owner = table === 'attempt' ? attemptByRun(run.id) : analysisByRun(run.id)
      if (owner && (owner.status === 'pending' || owner.status === 'processing')) {
        run.status = 'pending'
        run.error_message = null
      }
    }
    return ok
  }
  if (sql.includes('UPDATE student_attempts') && sql.includes("SET status = 'pending'")) {
    for (const attempt of state.attempts.values()) {
      if (attempt.status === 'processing') {
        attempt.status = 'pending'
        attempt.error_message = null
      }
    }
    return ok
  }
  if (sql.includes('UPDATE reasoning_analyses') && sql.includes("SET status = 'pending'")) {
    for (const analysis of state.analyses.values()) {
      if (analysis.status === 'processing') {
        analysis.status = 'pending'
        analysis.error_message = null
      }
    }
    return ok
  }
  if (sql.startsWith('UPDATE model_runs') && sql.includes("SET status = 'failed'")) {
    if (sql.includes('NOT EXISTS')) {
      // Orphan sweep: superseded runs with no owning attempt/analysis row.
      for (const run of state.runs.values()) {
        if (run.status !== 'pending' && run.status !== 'processing') continue
        if (run.task_type !== String(params[1]) && run.task_type !== String(params[2])) continue
        if (attemptByRun(run.id) || analysisByRun(run.id)) continue
        run.status = 'failed'
        run.error_message = String(params[0])
      }
    } else {
      // Explain force-fail on restart: the overlay is gone, so resuming the
      // answer is impossible by design.
      for (const run of state.runs.values()) {
        if (run.status !== 'pending' && run.status !== 'processing') continue
        if (run.task_type !== String(params[1])) continue
        run.status = 'failed'
        run.error_message = String(params[0])
      }
    }
    return ok
  }
  throw new Error(`unexpected statement: ${sql.slice(0, 120)}`)
}

vi.mock('@tauri-apps/plugin-sql', () => ({
  default: {
    load: vi.fn(async () => ({
      execute: vi.fn(async () => ({ rowsAffected: 0, lastInsertId: 0 })),
      select: vi.fn(async () => [{ name: 'main', file: '/app/axiom.db' }]),
    })),
  },
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (command: string, args?: { sql?: string; params?: unknown[] }) => {
    const sql = (args?.sql ?? '').trim()
    const params = args?.params ?? []
    state.statements.push(sql)
    if (command === 'db_select') return runSelect(sql, params)
    if (command === 'db_execute') return runExecute(sql, params)
    throw new Error(`unexpected invoke: ${command}`)
  }),
}))

vi.mock('./native', () => ({
  canonicalizePath: vi.fn(async (path: string) => path),
  cropProblemImage: vi.fn(),
  deleteAIProviderApiKey: vi.fn(async () => undefined),
  deleteMediaFile: vi.fn(async () => undefined),
  getDatabasePath: vi.fn(async () => '/app/axiom.db'),
  isDesktopRuntime: () => true,
  listMediaDirectory: vi.fn(async () => []),
  migrateDatabase: vi.fn(async () => undefined),
  persistAIProviderProfiles: vi.fn(async () => undefined),
  recoverLegacyProviderApiKeys: vi.fn(async () => undefined),
  removeProblemImage: vi.fn(async () => undefined),
}))

vi.mock('../ai/provider', () => ({
  getAIProvider: vi.fn(),
  getExplainProvidersForRun: vi.fn(() => {
    throw new Error('no explain provider')
  }),
  getReasoningProvidersForRun: vi.fn(() => [{ id: 'test', model: 'test-v1' }]),
  getSolutionProvider: vi.fn(),
  getStudentAttemptProvidersForRun: vi.fn(() => [{ id: 'test', model: 'test-v1' }]),
  getVisionProvidersForRun: vi.fn(() => []),
}))

import {
  queueReasoningAnalysis,
  queueStudentAttempt,
  recoverIntelligenceTasks,
} from './database'

const RESTART_EXPLAIN_MESSAGE = '应用重启时解释浮层已关闭，请重新选择文字'
const SUPERSEDED_MESSAGE = '任务已被更新的运行取代'

function seedSavedProblem(problemId: string) {
  state.problems.set(problemId, {
    id: problemId,
    source_document_id: 'doc-1',
    title: '测试题',
    status: 'saved',
    crop_image_path: '/tmp/crop.jpg',
    original_image_path: '/tmp/original.jpg',
    corrected_image_path: null,
    created_at: 1,
    updated_at: 1,
  })
}

function seedAnswerRegion(problemId: string) {
  state.regions.set(problemId, [
    {
      id: 'region-answer',
      problem_id: problemId,
      region_type: 'answer',
      x: 0, y: 0.5, width: 1, height: 0.5,
      image_path: '/tmp/answer.jpg',
      created_at: 1,
      updated_at: 1,
    },
  ])
}

beforeEach(resetState)

describe('recoverIntelligenceTasks', () => {
  it('replays completed runs into student_attempts and reasoning_analyses', async () => {
    addRun({
      id: 'run-student',
      task_type: STUDENT,
      status: 'completed',
      output_json: JSON.stringify({
        raw_markdown: '第一步',
        steps: [{ index: 1, content_markdown: '第一步', confidence: 0.9 }],
      }),
    })
    const attempt = addAttempt({
      id: 'attempt-1',
      problem_id: 'problem-1',
      status: 'pending',
      active_model_run_id: 'run-student',
    })
    addRun({
      id: 'run-reasoning',
      task_type: REASONING,
      status: 'completed',
      output_json: JSON.stringify({
        approach: '数形结合',
        step_evaluations: [{ student_step_index: 1, status: 'correct', comment: '无误' }],
        first_wrong_step: null,
        error_type: null,
        reason: null,
        knowledge_gaps: ['分式运算'],
        suggestion: '巩固通分',
      }),
    })
    const analysis = addAnalysis({
      id: 'analysis-1',
      problem_id: 'problem-1',
      student_attempt_id: 'attempt-1',
      status: 'processing',
      active_model_run_id: 'run-reasoning',
    })

    await recoverIntelligenceTasks()

    expect(attempt.status).toBe('completed')
    expect(attempt.raw_markdown).toBe('第一步')
    expect(JSON.parse(attempt.steps_json)).toEqual([
      { index: 1, contentMarkdown: '第一步' },
    ])
    expect(attempt.error_message).toBeNull()
    expect(analysis.status).toBe('completed')
    expect(analysis.approach).toBe('数形结合')
    expect(JSON.parse(analysis.step_evaluations_json ?? '[]')).toEqual([
      { studentStepIndex: 1, status: 'correct', comment: '无误' },
    ])
    expect(JSON.parse(analysis.knowledge_gaps_json ?? '[]')).toEqual(['分式运算'])
    expect(analysis.error_message).toBeNull()
  })

  it('marks tasks failed when their active run failed before the restart', async () => {
    addRun({
      id: 'run-student',
      task_type: STUDENT,
      status: 'failed',
      error_message: 'provider 超时',
    })
    const attempt = addAttempt({
      id: 'attempt-1',
      problem_id: 'problem-1',
      status: 'processing',
      active_model_run_id: 'run-student',
    })
    addRun({
      id: 'run-reasoning',
      task_type: REASONING,
      status: 'failed',
      error_message: null,
    })
    const analysis = addAnalysis({
      id: 'analysis-1',
      problem_id: 'problem-1',
      student_attempt_id: 'attempt-1',
      status: 'pending',
      active_model_run_id: 'run-reasoning',
    })

    await recoverIntelligenceTasks()

    expect(attempt.status).toBe('failed')
    expect(attempt.error_message).toBe('provider 超时')
    expect(analysis.status).toBe('failed')
    // run 没有错误信息时落到可读的兜底文案，而不是 NULL
    expect(analysis.error_message).toBe('推理分析任务在上次运行时失败')
  })

  it('resets in-flight tasks to pending so the worker can replay them', async () => {
    const run = addRun({ id: 'run-student', task_type: STUDENT, status: 'processing' })
    const attempt = addAttempt({
      id: 'attempt-1',
      problem_id: 'problem-1',
      status: 'processing',
      active_model_run_id: 'run-student',
    })

    await recoverIntelligenceTasks()

    expect(run.status).toBe('pending')
    expect(run.error_message).toBeNull()
    expect(attempt.status).toBe('pending')
    expect(attempt.error_message).toBeNull()
  })

  it('fails orphan runs that no attempt or analysis references', async () => {
    const orphan = addRun({ id: 'run-orphan', task_type: STUDENT, status: 'processing' })
    const kept = addRun({ id: 'run-kept', task_type: REASONING, status: 'pending' })
    addAnalysis({
      id: 'analysis-1',
      problem_id: 'problem-1',
      student_attempt_id: 'attempt-1',
      status: 'pending',
      active_model_run_id: 'run-kept',
    })
    addAttempt({
      id: 'attempt-1',
      problem_id: 'problem-1',
      status: 'pending',
      active_model_run_id: null,
    })

    await recoverIntelligenceTasks()

    expect(orphan.status).toBe('failed')
    expect(orphan.error_message).toBe(SUPERSEDED_MESSAGE)
    // 仍被引用的 run 不受 orphan 清扫影响，保持可执行
    expect(kept.status).toBe('pending')
  })

  it('force-fails pending and processing explain runs on restart by design', async () => {
    const pendingExplain = addRun({ id: 'explain-1', task_type: EXPLAIN, status: 'pending' })
    const processingExplain = addRun({ id: 'explain-2', task_type: EXPLAIN, status: 'processing' })
    const completedExplain = addRun({ id: 'explain-3', task_type: EXPLAIN, status: 'completed' })

    await recoverIntelligenceTasks()

    expect(pendingExplain.status).toBe('failed')
    expect(pendingExplain.error_message).toBe(RESTART_EXPLAIN_MESSAGE)
    expect(processingExplain.status).toBe('failed')
    expect(processingExplain.error_message).toBe(RESTART_EXPLAIN_MESSAGE)
    // 重启前已完成的解释不受影响
    expect(completedExplain.status).toBe('completed')
  })
})

describe('single-stage precise re-queue', () => {
  it('re-queuing a student attempt upserts the single attempt row and supersedes the old run', async () => {
    seedSavedProblem('problem-1')
    seedAnswerRegion('problem-1')

    const first = await queueStudentAttempt('problem-1')
    expect(first.status).toBe('pending')
    const firstRunId = first.activeModelRunId
    expect(firstRunId).not.toBeNull()

    const second = await queueStudentAttempt('problem-1')

    // upsert：永远只有一行 student_attempts，绝不产生重复记录
    expect(state.attempts.size).toBe(1)
    const attempt = state.attempts.get('problem-1')!
    expect(attempt.active_model_run_id).toBe(second.activeModelRunId)
    expect(attempt.active_model_run_id).not.toBe(firstRunId)
    // 两次排队各自留下一条 model_run（旧 run 由 orphan 清扫标记失败）
    expect(state.runs.size).toBe(2)

    await recoverIntelligenceTasks()
    const superseded = state.runs.get(firstRunId!)!
    expect(superseded.status).toBe('failed')
    expect(superseded.error_message).toBe(SUPERSEDED_MESSAGE)
    const active = state.runs.get(second.activeModelRunId!)!
    expect(active.status).toBe('pending')
  })

  it('re-queuing reasoning analysis upserts on the attempt row without duplicating analyses', async () => {
    seedSavedProblem('problem-1')
    addAttempt({
      id: 'attempt-1',
      problem_id: 'problem-1',
      status: 'completed',
      active_model_run_id: 'run-done',
      raw_markdown: '学生作答',
      steps_json: JSON.stringify([{ index: 1, contentMarkdown: '学生作答', confidence: 0.8 }]),
    })
    addRun({ id: 'run-done', task_type: STUDENT, status: 'completed' })

    const first = await queueReasoningAnalysis('problem-1')
    expect(first.status).toBe('pending')
    const firstRunId = first.activeModelRunId
    expect(firstRunId).not.toBeNull()

    const second = await queueReasoningAnalysis('problem-1')

    // upsert on student_attempt_id：同一 attempt 永远只对应一行推理分析
    expect(state.analyses.size).toBe(1)
    const analysis = state.analyses.get('attempt-1')!
    expect(analysis.active_model_run_id).toBe(second.activeModelRunId)
    expect(analysis.active_model_run_id).not.toBe(firstRunId)
    // 新增的只有两条 reasoning run（run-done 属于 student attempt 任务）
    const reasoningRuns = [...state.runs.values()].filter((run) => run.task_type === REASONING)
    expect(reasoningRuns).toHaveLength(2)

    await recoverIntelligenceTasks()
    const superseded = state.runs.get(firstRunId!)!
    expect(superseded.status).toBe('failed')
    expect(superseded.error_message).toBe(SUPERSEDED_MESSAGE)
    const active = state.runs.get(second.activeModelRunId!)!
    expect(active.status).toBe('pending')
    // attempt 本身不被推理重排队触碰
    expect(state.attempts.get('problem-1')!.status).toBe('completed')
  })

  it('explain runs are created on demand and never by the recovery sweep', async () => {
    // explain 是按需创建：恢复流程只会把残留 explain run 置为 failed，
    // 绝不会凭空补建任何 explain run。
    await recoverIntelligenceTasks()
    const explainRuns = [...state.runs.values()].filter((run) => run.task_type === EXPLAIN)
    expect(explainRuns).toHaveLength(0)
  })
})

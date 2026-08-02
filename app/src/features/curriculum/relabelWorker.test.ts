import { describe, expect, it, vi } from 'vitest'
// @ts-expect-error Vitest executes this contract in Node, while the app tsconfig is browser-only.
import { readFileSync } from 'node:fs'

const mocks = vi.hoisted(() => ({
  runProblemAIWorker: vi.fn(async () => undefined),
  queueProblemAI: vi.fn(async () => ({ aiActiveModelRunId: 'run-1' })),
  refreshRelabelBatch: vi.fn(),
  nextPendingRelabelItem: vi.fn(),
  markRelabelItemQueued: vi.fn(async () => undefined),
  getRelabelModelRunSummary: vi.fn(async () => ({ id: 'run-1', problemId: 'problem-1', provider: 'gemini', model: 'vision', repairStrategy: 'normalize-missing-difficulty-score', errorMessage: null, status: 'completed' })),
  recordRelabelModelRunFailure: vi.fn(async () => undefined),
  failRelabelItem: vi.fn(async () => undefined),
}))

vi.mock('../../ai/pipeline', () => ({ runProblemAIWorker: mocks.runProblemAIWorker }))
vi.mock('../../platform/database', () => ({ queueProblemAI: mocks.queueProblemAI }))
vi.mock('../../platform/horizonDatabase', () => ({
  refreshRelabelBatch: mocks.refreshRelabelBatch,
  nextPendingRelabelItem: mocks.nextPendingRelabelItem,
  markRelabelItemQueued: mocks.markRelabelItemQueued,
  getRelabelModelRunSummary: mocks.getRelabelModelRunSummary,
  recordRelabelModelRunFailure: mocks.recordRelabelModelRunFailure,
  failRelabelItem: mocks.failRelabelItem,
}))

import { startRelabelBatchWorker } from './relabelWorker'

const running = {
  id: 'batch-1', subject: '数学', status: 'processing' as const, totalCount: 1,
  completedCount: 0, failedCount: 0, needsReviewCount: 0, pausedAt: null, createdAt: 1, updatedAt: 1,
}
const completed = { ...running, status: 'completed' as const, completedCount: 1 }

describe('relabel worker contract', () => {
  it('uses the ordinary problem AI pipeline and completes one item', async () => {
    mocks.refreshRelabelBatch.mockReset().mockResolvedValueOnce(running).mockResolvedValueOnce(completed)
    mocks.nextPendingRelabelItem.mockReset().mockResolvedValueOnce('problem-1').mockResolvedValueOnce(null)
    await startRelabelBatchWorker('batch-1')
    expect(mocks.queueProblemAI).toHaveBeenCalledWith('problem-1')
    expect(mocks.markRelabelItemQueued).toHaveBeenCalledWith('batch-1', 'problem-1', 'run-1')
    expect(mocks.runProblemAIWorker).toHaveBeenCalledTimes(1)
    expect(mocks.recordRelabelModelRunFailure).not.toHaveBeenCalled()
  })

  it('keeps failed-only retry, completed protection, and locked-tag protection in the DB contract', () => {
    const source = readFileSync(new URL('../../platform/horizonDatabase.ts', import.meta.url), 'utf8')
    expect(source).toContain("WHERE batch_id = $2 AND status = 'failed'")
    expect(source).toContain("SET status = 'pending', model_run_id = NULL, error_message = NULL")
    expect(source).toContain("status IN ('pending', 'queued', 'processing')")
    expect(readFileSync(new URL('../../platform/horizonDatabase.ts', import.meta.url), 'utf8')).toContain("is_locked = 0 AND verification_status != 'user_verified'")
  })
})

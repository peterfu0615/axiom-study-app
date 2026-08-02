import { beforeEach, describe, expect, it, vi } from 'vitest'
// @ts-expect-error Vitest executes this contract in Node, while the app tsconfig is browser-only.
import { readFileSync } from 'node:fs'

const mocks = vi.hoisted(() => ({
  runProblemAIWorker: vi.fn(async () => undefined),
  queueProblemAIWithRun: vi.fn(async () => ({ problem: { aiActiveModelRunId: 'run-1' }, modelRunId: 'run-1', created: true })),
  cancelUnboundProblemAIModelRun: vi.fn(async () => undefined),
  refreshRelabelBatch: vi.fn(),
  claimRelabelItem: vi.fn(),
  bindRelabelItemModelRun: vi.fn(async () => true),
  getRelabelModelRunSummary: vi.fn(async () => ({ id: 'run-1', problemId: 'problem-1', provider: 'gemini', model: 'vision', repairStrategy: 'normalize-missing-difficulty-score', errorMessage: null, status: 'completed' })),
  recordRelabelModelRunFailure: vi.fn(async () => undefined),
  releaseRelabelItemClaim: vi.fn(async () => true),
  failRelabelItem: vi.fn(async () => undefined),
}))

vi.mock('../../ai/pipeline', () => ({ runProblemAIWorker: mocks.runProblemAIWorker }))
vi.mock('../../platform/database', () => ({
  cancelUnboundProblemAIModelRun: mocks.cancelUnboundProblemAIModelRun,
  queueProblemAIWithRun: mocks.queueProblemAIWithRun,
}))
vi.mock('../../platform/horizonDatabase', () => ({
  bindRelabelItemModelRun: mocks.bindRelabelItemModelRun,
  claimRelabelItem: mocks.claimRelabelItem,
  refreshRelabelBatch: mocks.refreshRelabelBatch,
  getRelabelModelRunSummary: mocks.getRelabelModelRunSummary,
  recordRelabelModelRunFailure: mocks.recordRelabelModelRunFailure,
  releaseRelabelItemClaim: mocks.releaseRelabelItemClaim,
  failRelabelItem: mocks.failRelabelItem,
}))

import { startRelabelBatchWorker } from './relabelWorker'

const running = {
  id: 'batch-1', subject: '数学', status: 'processing' as const, totalCount: 1,
  completedCount: 0, failedCount: 0, needsReviewCount: 0, pausedAt: null, createdAt: 1, updatedAt: 1,
}
const completed = { ...running, status: 'completed' as const, completedCount: 1 }

describe('relabel worker contract', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset())
    mocks.runProblemAIWorker.mockResolvedValue(undefined)
    mocks.queueProblemAIWithRun.mockResolvedValue({ problem: { aiActiveModelRunId: 'run-1' }, modelRunId: 'run-1', created: true })
    mocks.cancelUnboundProblemAIModelRun.mockResolvedValue(undefined)
    mocks.bindRelabelItemModelRun.mockResolvedValue(true)
    mocks.getRelabelModelRunSummary.mockResolvedValue({ id: 'run-1', problemId: 'problem-1', provider: 'gemini', model: 'vision', repairStrategy: 'normalize-missing-difficulty-score', errorMessage: null, status: 'completed' })
    mocks.recordRelabelModelRunFailure.mockResolvedValue(undefined)
    mocks.releaseRelabelItemClaim.mockResolvedValue(true)
    mocks.failRelabelItem.mockResolvedValue(undefined)
  })

  it('uses the ordinary problem AI pipeline and completes one item', async () => {
    mocks.refreshRelabelBatch.mockReset().mockResolvedValueOnce(running).mockResolvedValueOnce(completed)
    mocks.claimRelabelItem.mockReset().mockResolvedValueOnce({ problemId: 'problem-1', modelRunId: null, claimToken: 'claim-1' }).mockResolvedValueOnce(null)
    await startRelabelBatchWorker('batch-1')
    expect(mocks.queueProblemAIWithRun).toHaveBeenCalledWith('problem-1')
    expect(mocks.bindRelabelItemModelRun).toHaveBeenCalledWith(expect.objectContaining({ batchId: 'batch-1', problemId: 'problem-1', modelRunId: 'run-1' }))
    expect(mocks.runProblemAIWorker).toHaveBeenCalledTimes(1)
    expect(mocks.recordRelabelModelRunFailure).not.toHaveBeenCalled()
  })

  it('does not create a ModelRun when pause wins before the atomic claim', async () => {
    mocks.refreshRelabelBatch.mockResolvedValueOnce({ ...running, status: 'paused', pausedAt: 10 })
    await startRelabelBatchWorker('batch-1')
    expect(mocks.claimRelabelItem).not.toHaveBeenCalled()
    expect(mocks.queueProblemAIWithRun).not.toHaveBeenCalled()
    expect(mocks.runProblemAIWorker).not.toHaveBeenCalled()
  })

  it('does not run an unbound ModelRun when binding loses the claim', async () => {
    mocks.refreshRelabelBatch.mockResolvedValueOnce(running).mockResolvedValueOnce(completed)
    mocks.claimRelabelItem.mockResolvedValueOnce({ problemId: 'problem-1', modelRunId: null, claimToken: 'claim-1' }).mockResolvedValueOnce(null)
    mocks.bindRelabelItemModelRun.mockResolvedValueOnce(false)
    await startRelabelBatchWorker('batch-1')
    expect(mocks.cancelUnboundProblemAIModelRun).toHaveBeenCalledWith('problem-1', 'run-1')
    expect(mocks.runProblemAIWorker).not.toHaveBeenCalled()
    expect(mocks.releaseRelabelItemClaim).toHaveBeenCalledWith(expect.objectContaining({ batchId: 'batch-1', problemId: 'problem-1', modelRunId: null }))
    expect(mocks.failRelabelItem).not.toHaveBeenCalled()
  })

  it('resumes an existing active ModelRun without queueing a duplicate', async () => {
    mocks.refreshRelabelBatch.mockResolvedValueOnce(running).mockResolvedValueOnce(completed)
    mocks.claimRelabelItem.mockResolvedValueOnce({ problemId: 'problem-1', modelRunId: 'run-1', claimToken: 'claim-1' }).mockResolvedValueOnce(null)
    await startRelabelBatchWorker('batch-1')
    expect(mocks.queueProblemAIWithRun).not.toHaveBeenCalled()
    expect(mocks.bindRelabelItemModelRun).not.toHaveBeenCalled()
    expect(mocks.runProblemAIWorker).toHaveBeenCalledTimes(1)
  })

  it('binds a shared active ModelRun before running an unbound item', async () => {
    mocks.refreshRelabelBatch.mockReset().mockResolvedValueOnce(running).mockResolvedValueOnce(completed)
    mocks.claimRelabelItem.mockReset().mockResolvedValueOnce({ problemId: 'problem-1', modelRunId: null, claimToken: 'claim-1' }).mockResolvedValueOnce(null)
    mocks.queueProblemAIWithRun.mockResolvedValueOnce({ problem: { aiActiveModelRunId: 'run-1' }, modelRunId: 'run-1', created: false })
    await startRelabelBatchWorker('batch-1')
    expect(mocks.bindRelabelItemModelRun).toHaveBeenCalledWith(expect.objectContaining({ modelRunId: 'run-1' }))
    expect(mocks.cancelUnboundProblemAIModelRun).not.toHaveBeenCalled()
    expect(mocks.runProblemAIWorker).toHaveBeenCalledTimes(1)
  })

  it('keeps failed-only retry, completed protection, and locked-tag protection in the DB contract', () => {
    const source = readFileSync(new URL('../../platform/horizonDatabase.ts', import.meta.url), 'utf8')
    expect(source).toContain("WHERE batch_id = $2 AND status = 'failed'")
    expect(source).toContain("SET status = 'pending', model_run_id = NULL, error_message = NULL")
    expect(source).toContain("status IN ('pending', 'queued', 'processing')")
    expect(readFileSync(new URL('../../platform/horizonDatabase.ts', import.meta.url), 'utf8')).toContain("is_locked = 0 AND verification_status != 'user_verified'")
  })
})

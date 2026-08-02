import { runProblemAIWorker } from '../../ai/pipeline'
import { queueProblemAI } from '../../platform/database'
import {
  failRelabelItem,
  getRelabelModelRunSummary,
  markRelabelItemQueued,
  nextPendingRelabelItem,
  recordRelabelModelRunFailure,
  refreshRelabelBatch,
} from '../../platform/horizonDatabase'

const activeBatches = new Set<string>()

export async function startRelabelBatchWorker(batchId: string) {
  if (activeBatches.has(batchId)) return
  activeBatches.add(batchId)
  try {
    while (true) {
      const batch = await refreshRelabelBatch(batchId)
      if (!batch || ['paused', 'completed', 'cancelled', 'failed'].includes(batch.status)) return
      const problemId = await nextPendingRelabelItem(batchId)
      if (!problemId) {
        await refreshRelabelBatch(batchId)
        return
      }
      let modelRunId: string | null = null
      try {
        const problem = await queueProblemAI(problemId)
        if (!problem.aiActiveModelRunId) {
          throw new Error('题目没有创建可处理的解析任务')
        }
        modelRunId = problem.aiActiveModelRunId
        await markRelabelItemQueued(batchId, problemId, modelRunId)
        await runProblemAIWorker()
        const summary = await getRelabelModelRunSummary(modelRunId)
        if (summary?.status === 'failed') {
          await recordRelabelModelRunFailure(batchId, problemId, summary)
        }
      } catch (error) {
        const summary = modelRunId ? await getRelabelModelRunSummary(modelRunId) : null
        if (summary?.status === 'failed') await recordRelabelModelRunFailure(batchId, problemId, summary)
        else await failRelabelItem(batchId, problemId, error)
      }
    }
  } finally {
    activeBatches.delete(batchId)
  }
}

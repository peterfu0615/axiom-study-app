import { runProblemAIWorker } from '../../ai/pipeline'
import {
  cancelUnboundProblemAIModelRun,
  queueProblemAIWithRun,
} from '../../platform/database'
import {
  bindRelabelItemModelRun,
  claimRelabelItem,
  failRelabelItem,
  getRelabelModelRunSummary,
  recordRelabelModelRunFailure,
  releaseRelabelItemClaim,
  refreshRelabelBatch,
} from '../../platform/horizonDatabase'

const activeBatches = new Set<string>()

export async function startRelabelBatchWorker(batchId: string) {
  if (activeBatches.has(batchId)) return
  activeBatches.add(batchId)
  const claimToken = crypto.randomUUID()
  try {
    while (true) {
      const batch = await refreshRelabelBatch(batchId)
      if (!batch || ['paused', 'completed', 'cancelled', 'failed'].includes(batch.status)) return
      const claim = await claimRelabelItem(batchId, claimToken)
      if (!claim) {
        await refreshRelabelBatch(batchId)
        return
      }
      const problemId = claim.problemId
      let modelRunId: string | null = null
      let createdModelRun = false
      let itemAlreadyBound = claim.modelRunId !== null
      try {
        modelRunId = claim.modelRunId
        if (!modelRunId) {
          const queued = await queueProblemAIWithRun(problemId)
          modelRunId = queued.modelRunId
          createdModelRun = queued.created
        }
        // A run returned by the atomic claim is already durably attached to
        // this item (typically after app restart).  A run found by the shared
        // ordinary queue is not attached yet, even when it was created by a
        // different caller, so it must pass the same pause-sensitive bind.
        if (!itemAlreadyBound) {
          const bound = await bindRelabelItemModelRun({
            batchId,
            problemId,
            claimToken,
            modelRunId,
          })
          if (!bound) {
            if (createdModelRun) await cancelUnboundProblemAIModelRun(problemId, modelRunId)
            await releaseRelabelItemClaim({
              batchId,
              problemId,
              claimToken,
              modelRunId: null,
            })
            continue
          }
          itemAlreadyBound = true
        }
        await runProblemAIWorker()
        const summary = await getRelabelModelRunSummary(modelRunId)
        if (summary?.status === 'failed') {
          await recordRelabelModelRunFailure(batchId, problemId, summary)
        }
      } catch (error) {
        let summary = null
        if (modelRunId) {
          try {
            summary = await getRelabelModelRunSummary(modelRunId)
          } catch {
            // Keep the item-level failure path alive even if diagnostics are
            // temporarily unavailable; the summary is best-effort metadata.
          }
        }
        if (summary?.status === 'failed') await recordRelabelModelRunFailure(batchId, problemId, summary)
        else {
          if (modelRunId) await cancelUnboundProblemAIModelRun(problemId, modelRunId)
          await failRelabelItem(batchId, problemId, error, claimToken)
        }
      }
    }
  } finally {
    activeBatches.delete(batchId)
  }
}

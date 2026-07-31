import type {
  ExplainSelectionInput,
  ExplainResult,
  ReasoningModelRun,
  StudentAttemptModelRun,
} from '../domain/models'
import {
  beginExplainModelRun,
  claimNextReasoningModelRun,
  claimNextStudentAttemptModelRun,
  completeExplainModelRun,
  completeReasoningModelRun,
  completeStudentAttemptModelRun,
  createExplainModelRun,
  failExplainModelRun,
  failReasoningModelRun,
  failStudentAttemptModelRun,
  queueReasoningAnalysis,
  recoverIntelligenceTasks,
  recordProcessingModelRunOutput,
  updateProcessingModelRunProvider,
} from '../platform/database'
import {
  AIProviderFailure,
  getExplainProvidersForRun,
  getReasoningProvidersForRun,
  getStudentAttemptProvidersForRun,
} from './provider'

export const INTELLIGENCE_STATUS_EVENT = 'axiom:intelligence-status'
/** 流式输出事件：推理分析过程中实时推送累积文本 */
export const REASONING_STREAM_EVENT = 'axiom:reasoning-stream'
/** 流式输出事件：向我解释过程中实时推送累积文本 */
export const EXPLAIN_STREAM_EVENT = 'axiom:explain-stream'

function notifyIntelligenceStatus(problemId: string) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent(INTELLIGENCE_STATUS_EVENT, { detail: { problemId } }),
  )
}

function notifyReasoningStream(problemId: string, runId: string, accumulated: string) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent(REASONING_STREAM_EVENT, {
      detail: { problemId, runId, accumulated },
    }),
  )
}

function notifyExplainStream(runId: string, accumulated: string) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent(EXPLAIN_STREAM_EVENT, {
      detail: { runId, accumulated },
    }),
  )
}

let activeWorker: Promise<void> | null = null
let workerRequested = false

async function drainPendingIntelligence() {
  while (true) {
    const before = await claimNextStudentAttemptModelRun()
    if (before) {
      let activeRun: StudentAttemptModelRun = before
      const errors: string[] = []
      let completed = false
      try {
        const providers = getStudentAttemptProvidersForRun(before.provider, before.model)
        for (const provider of providers) {
          try {
            if (activeRun.provider !== provider.id || activeRun.model !== provider.model) {
              activeRun = await updateProcessingModelRunProvider(activeRun, provider.id, provider.model)
            }
            const result = await provider.extractStudentAttempt(activeRun.input)
            await recordProcessingModelRunOutput(activeRun, result.rawOutput, result.repairStrategy)
            await completeStudentAttemptModelRun(activeRun, result.attempt)
            completed = true
            errors.length = 0
            break
          } catch (error) {
            if (error instanceof AIProviderFailure) {
              await recordProcessingModelRunOutput(
                activeRun,
                error.rawOutput,
                error.repairStrategy,
                String(error),
              )
            } else {
              await recordProcessingModelRunOutput(
                activeRun,
                '',
                null,
                String(error),
              )
            }
            errors.push(`${provider.id}/${provider.model}：${String(error)}`)
          }
        }
        if (errors.length) throw new Error(`所有用户解答 Provider 均失败：${errors.join('；')}`)
      } catch (error) {
        try {
          await failStudentAttemptModelRun(activeRun, error)
        } catch (innerError) {
          console.error('[Intelligence] failStudentAttemptModelRun 抛错', innerError)
        }
      }
      if (completed) {
        try {
          await queueReasoningAnalysis(before.problemId)
        } catch (error) {
          console.error('用户解答已完成，但推理分析排队失败', error)
        }
      }
      notifyIntelligenceStatus(before.problemId)
      continue
    }
    const reasoning = await claimNextReasoningModelRun()
    if (!reasoning) return
    let activeRun: ReasoningModelRun = reasoning
    const errors: string[] = []
    try {
      const providers = getReasoningProvidersForRun(reasoning.provider, reasoning.model)
      for (const provider of providers) {
        try {
          if (activeRun.provider !== provider.id || activeRun.model !== provider.model) {
            activeRun = await updateProcessingModelRunProvider(activeRun, provider.id, provider.model)
          }
          const result = await provider.analyzeStudentReasoning(
            activeRun.input,
            (chunk) => notifyReasoningStream(reasoning.problemId, activeRun.id, chunk.accumulated),
          )
          await recordProcessingModelRunOutput(activeRun, result.rawOutput, result.repairStrategy)
          await completeReasoningModelRun(activeRun, result.analysis)
          errors.length = 0
          break
        } catch (error) {
          if (error instanceof AIProviderFailure) {
            await recordProcessingModelRunOutput(
              activeRun,
              error.rawOutput,
              error.repairStrategy,
              String(error),
            )
          } else {
            await recordProcessingModelRunOutput(
              activeRun,
              '',
              null,
              String(error),
            )
          }
          errors.push(`${provider.id}/${provider.model}：${String(error)}`)
        }
      }
      if (errors.length) throw new Error(`所有推理分析 Provider 均失败：${errors.join('；')}`)
    } catch (error) {
      try {
        await failReasoningModelRun(activeRun, error)
      } catch (innerError) {
        console.error('[Intelligence] failReasoningModelRun 抛错', innerError)
      }
    }
    notifyIntelligenceStatus(reasoning.problemId)
  }
}

export function runIntelligenceWorker(): Promise<void> {
  workerRequested = true
  activeWorker ??= (async () => {
    while (workerRequested) {
      workerRequested = false
      try {
        await drainPendingIntelligence()
      } catch (error) {
        console.error('[Intelligence] drain 异常，将继续重试', error)
        workerRequested = true
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }
    }
  })().finally(() => {
    activeWorker = null
  })
  return activeWorker
}

export async function resumeIntelligencePipeline() {
  await recoverIntelligenceTasks()
  await runIntelligenceWorker()
}

export async function explainSelection(
  input: ExplainSelectionInput,
): Promise<ExplainResult> {
  const created = await createExplainModelRun(input)
  let activeRun = await beginExplainModelRun(created)
  const errors: string[] = []
  try {
    const providers = getExplainProvidersForRun(activeRun.provider, activeRun.model)
    for (const provider of providers) {
      try {
        if (activeRun.provider !== provider.id || activeRun.model !== provider.model) {
          activeRun = await updateProcessingModelRunProvider(activeRun, provider.id, provider.model)
        }
        const response = await provider.explainSelection(
          activeRun.input,
          (chunk) => notifyExplainStream(activeRun.id, chunk.accumulated),
        )
        await recordProcessingModelRunOutput(activeRun, response.rawOutput, response.repairStrategy)
        await completeExplainModelRun(activeRun, response.result)
        return response.result
      } catch (error) {
        if (error instanceof AIProviderFailure) {
          await recordProcessingModelRunOutput(
            activeRun,
            error.rawOutput,
            error.repairStrategy,
            String(error),
          )
        } else {
          await recordProcessingModelRunOutput(
            activeRun,
            '',
            null,
            String(error),
          )
        }
        errors.push(`${provider.id}/${provider.model}：${String(error)}`)
      }
    }
    throw new Error(`所有解释 Provider 均失败：${errors.join('；')}`)
  } catch (error) {
    await failExplainModelRun(activeRun, error)
    throw error
  }
}

import {
  claimNextSolutionModelRun,
  completeSolutionModelRun,
  failSolutionModelRun,
  recordProcessingModelRunOutput,
  recoverSolutionTasks,
  updateProcessingModelRunProvider,
} from '../platform/database'
import {
  AIProviderFailure,
  getSolutionProvidersForRun,
} from './provider'
import { runWithAIBackoff } from './retryPolicy'
import { coordinateGeometryScene } from '../platform/geometrySceneDatabase'

export const SOLUTION_STATUS_EVENT = 'axiom:solution-status'
/** 流式输出事件：正解生成过程中实时推送累积文本 */
export const SOLUTION_STREAM_EVENT = 'axiom:solution-stream'

function notifySolutionStatus(problemId: string) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent(SOLUTION_STATUS_EVENT, { detail: { problemId } }),
  )
}

function notifySolutionStream(problemId: string, runId: string, accumulated: string) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent(SOLUTION_STREAM_EVENT, {
      detail: { problemId, runId, accumulated },
    }),
  )
}

let activeWorker: Promise<void> | null = null
let workerRequested = false

async function drainPendingSolutions() {
  while (true) {
    const run = await claimNextSolutionModelRun()
    if (!run) return
    notifySolutionStatus(run.problemId)

    let activeRun = run
    const errors: string[] = []
    let lastProviderError: unknown = null
    try {
      const providers = getSolutionProvidersForRun(
        run.provider,
        run.model,
      )
      for (const provider of providers) {
        try {
          if (
            activeRun.provider !== provider.id ||
            activeRun.model !== provider.model
          ) {
            activeRun = await updateProcessingModelRunProvider(
              activeRun,
              provider.id,
              provider.model,
            )
          }
          const providerResult = await runWithAIBackoff({
            context: { providerId: provider.id, model: provider.model, runId: activeRun.id },
            operation: () => provider.generateSolution(
              activeRun.input,
              (chunk) => notifySolutionStream(run.problemId, activeRun.id, chunk.accumulated),
            ),
            onFailure: async (error, envelope) => {
              if (error instanceof AIProviderFailure && error.usage) {
                await recordProcessingModelRunOutput(
                  activeRun, error.rawOutput, error.repairStrategy, envelope, error.usage,
                )
              } else {
                await recordProcessingModelRunOutput(
                  activeRun,
                  error instanceof AIProviderFailure ? error.rawOutput : '',
                  error instanceof AIProviderFailure ? error.repairStrategy : null,
                  envelope,
                )
              }
            },
          })
          if (providerResult.usage) {
            await recordProcessingModelRunOutput(
              activeRun, providerResult.rawOutput, providerResult.repairStrategy,
              null, providerResult.usage,
            )
          } else {
            await recordProcessingModelRunOutput(
              activeRun, providerResult.rawOutput, providerResult.repairStrategy,
            )
          }
          await completeSolutionModelRun(
            activeRun,
            providerResult.solution,
          )
          try {
            await coordinateGeometryScene(activeRun.problemId)
          } catch (error) {
            console.error('[Solution] 几何图任务排队失败，正解仍保持完成', error)
          }
          errors.length = 0
          break
        } catch (error) {
          lastProviderError = error
          errors.push(
            `${provider.id}/${provider.model}：${String(error)}`,
          )
        }
      }
      if (errors.length) {
        throw lastProviderError ?? new Error(`所有 Solution Provider 均失败：${errors.join('；')}`)
      }
    } catch (error) {
      try {
        await failSolutionModelRun(activeRun, error)
      } catch (innerError) {
        console.error('[Solution] failSolutionModelRun 抛错', innerError)
      }
    }
    notifySolutionStatus(run.problemId)
  }
}

export function runSolutionWorker(): Promise<void> {
  workerRequested = true
  activeWorker ??= (async () => {
    while (workerRequested) {
      workerRequested = false
      try {
        await drainPendingSolutions()
      } catch (error) {
        console.error('[Solution] drain 异常，将继续重试', error)
        workerRequested = true
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }
    }
  })().finally(() => {
    activeWorker = null
  })
  return activeWorker
}

export async function resumeSolutionPipeline() {
  await recoverSolutionTasks()
  await runSolutionWorker()
}

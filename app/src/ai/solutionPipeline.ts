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
          const providerResult = await provider.generateSolution(
            activeRun.input,
            (chunk) => notifySolutionStream(run.problemId, activeRun.id, chunk.accumulated),
          )
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
          errors.length = 0
          break
        } catch (error) {
          if (error instanceof AIProviderFailure) {
            if (error.usage) {
              await recordProcessingModelRunOutput(
                activeRun, error.rawOutput, error.repairStrategy, String(error), error.usage,
              )
            } else {
              await recordProcessingModelRunOutput(
                activeRun, error.rawOutput, error.repairStrategy, String(error),
              )
            }
          } else {
            await recordProcessingModelRunOutput(
              activeRun,
              '',
              null,
              String(error),
            )
          }
          errors.push(
            `${provider.id}/${provider.model}：${String(error)}`,
          )
        }
      }
      if (errors.length) {
        throw new Error(`所有 Solution Provider 均失败：${errors.join('；')}`)
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

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

function notifySolutionStatus(problemId: string) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent(SOLUTION_STATUS_EVENT, { detail: { problemId } }),
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
          )
          await recordProcessingModelRunOutput(
            activeRun,
            providerResult.rawOutput,
            providerResult.repairStrategy,
          )
          await completeSolutionModelRun(
            activeRun,
            providerResult.solution,
          )
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
          errors.push(
            `${provider.id}/${provider.model}：${String(error)}`,
          )
        }
      }
      if (errors.length) {
        throw new Error(`所有 Solution Provider 均失败：${errors.join('；')}`)
      }
    } catch (error) {
      await failSolutionModelRun(activeRun, error)
    }
    notifySolutionStatus(run.problemId)
  }
}

export function runSolutionWorker(): Promise<void> {
  workerRequested = true
  activeWorker ??= (async () => {
    while (workerRequested) {
      workerRequested = false
      await drainPendingSolutions()
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

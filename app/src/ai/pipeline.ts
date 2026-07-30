import {
  claimNextProblemAIModelRun,
  completeProblemAIModelRun,
  failProblemAIModelRun,
  markProblemSolutionFailed,
  queueProblemSolution,
  queueStudentAttempt,
  getProblemRegions,
  recordProcessingModelRunOutput,
  recoverProblemAITasks,
  updateProcessingModelRunProvider,
} from '../platform/database'
import { normalizeAIProblemAnalysis } from '../domain/ai'
import {
  cropProblemDiagram,
  removeProblemDiagram,
} from '../platform/native'
import {
  AIProviderFailure,
  getVisionProvidersForRun,
} from './provider'
import { runSolutionWorker } from './solutionPipeline'
import { runIntelligenceWorker } from './intelligencePipeline'

export const AI_STATUS_EVENT = 'axiom:problem-ai-status'

function notifyProblemAIStatus(problemId: string) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent(AI_STATUS_EVENT, { detail: { problemId } }),
  )
}

let activeWorker: Promise<void> | null = null
let workerRequested = false

function hasUsableDiagramBounds(
  rect: { width: number; height: number },
) {
  return rect.width > 0.001 && rect.height > 0.001
}

async function drainPendingProblemAI() {
  while (true) {
    const run = await claimNextProblemAIModelRun()
    if (!run) return
    notifyProblemAIStatus(run.problemId)

    let activeRun = run
    const errors: string[] = []
    try {
      const providers = getVisionProvidersForRun(run.provider, run.model)
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
          const providerResult = provider.analyzeProblem
            ? await (async () => {
                const regions = await getProblemRegions(activeRun.problemId)
                const questionRegion = regions.find((region) => region.type === 'question')
                return provider.analyzeProblem!({
                ...activeRun.input,
                questionImagePath:
                  questionRegion?.imagePath ?? activeRun.input.cropImagePath,
                diagramImagePaths: regions
                  .filter((region) => region.type === 'diagram' && region.imagePath)
                  .map((region) => region.imagePath as string),
                answerImagePaths: regions
                  .filter((region) => region.type === 'answer' && region.imagePath)
                  .map((region) => region.imagePath as string),
                regionIds: regions.map((region) => region.id),
              })
              })()
            : await provider.analyzeProblemImage(activeRun.input)
          await recordProcessingModelRunOutput(
            activeRun,
            providerResult.rawOutput,
            providerResult.repairStrategy,
          )
          let result = normalizeAIProblemAnalysis(providerResult.analysis)
          let diagramImagePath: string | null = null
          if (
            result.hasDiagram &&
            hasUsableDiagramBounds(result.diagramBBox)
          ) {
            try {
              const diagram = await cropProblemDiagram(
                activeRun.problemId,
                activeRun.input.cropImagePath,
                result.diagramBBox,
              )
              diagramImagePath = diagram.path
            } catch (error) {
              result = {
                ...result,
                warnings: [
                  ...result.warnings,
                  `已识别图形边界，但独立抠图失败：${String(error)}`,
                ],
              }
            }
          }
          const previousDiagramImagePath =
            await completeProblemAIModelRun(
              activeRun,
              result,
              diagramImagePath,
            )
          if (
            previousDiagramImagePath &&
            previousDiagramImagePath !== diagramImagePath
          ) {
            removeProblemDiagram(previousDiagramImagePath).catch(() => {})
          }
          try {
            await queueProblemSolution(activeRun.problemId)
            void runSolutionWorker()
          } catch (error) {
            await markProblemSolutionFailed(activeRun.problemId, error)
          }
          try {
            await queueStudentAttempt(activeRun.problemId)
            void runIntelligenceWorker()
          } catch (error) {
            // 用户答案区域是可选能力；题目解析成功不应被它阻塞。
            console.error('用户解答识别任务排队失败', error)
          }
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
        throw new Error(`所有视觉 Provider 均失败：${errors.join('；')}`)
      }
    } catch (error) {
      try {
        await failProblemAIModelRun(activeRun, error)
      } catch (innerError) {
        // failProblemAIModelRun 自身抛出（如 DB 错误）不应杀死 worker
        console.error('[ProblemAI] failProblemAIModelRun 抛错', innerError)
      }
    }
    notifyProblemAIStatus(run.problemId)
  }
}

export function runProblemAIWorker(): Promise<void> {
  workerRequested = true
  activeWorker ??= (async () => {
    while (workerRequested) {
      workerRequested = false
      try {
        await drainPendingProblemAI()
      } catch (error) {
        // 单次 drain 异常不能杀死 worker：记录后短暂退避再继续
        console.error('[ProblemAI] drain 异常，将继续重试', error)
        workerRequested = true
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }
    }
  })().finally(() => {
    activeWorker = null
  })
  return activeWorker
}

export async function resumeProblemAIPipeline() {
  await recoverProblemAITasks()
  await runProblemAIWorker()
}

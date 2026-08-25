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
import { preferredRegions } from '../domain/problemRegions'
import { resolveProblemTextbookContextBeforeAnalysis } from '../platform/horizonDatabase'
import { normalizeAIProblemAnalysis } from '../domain/ai'
import type { ResolvedTextbookContext } from '../domain/models'
import {
  cropProblemDiagram,
  removeProblemDiagram,
} from '../platform/native'
import {
  AIProviderFailure,
  getVisionProvidersForRun,
  resolveTextbookCandidateWithProvider,
  type AIProvider,
  type AIProviderResult,
} from './provider'
import {
  AIExecutionError,
  classifyAIError,
  createAIError,
  type AIErrorEnvelope,
} from '../domain/aiError'
import { runSolutionWorker } from './solutionPipeline'
import { runIntelligenceWorker } from './intelligencePipeline'
import { runWithAIBackoff } from './retryPolicy'
import { coordinateGeometryScene, markGeometryDiagramsStale } from '../platform/geometrySceneDatabase'

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

/**
 * 在分析开始前解析题目的教材，并在成功选中教材时返回其元数据。
 * 用户锁定始终优先；读取或解析失败不阻断无教材模式下的分析流程。
 */
async function getResolvedTextbookMetadata(
  problemId: string,
  modelRunId: string,
  providers: AIProvider[],
): Promise<ResolvedTextbookContext | null> {
  try {
    const resolverProvider = providers.find((provider) =>
      provider.supportsText && typeof provider.analyzeCurriculumStage === 'function')
    return (await (resolverProvider
      ? resolveProblemTextbookContextBeforeAnalysis(
          problemId,
          async (input) => ({
            ...await resolveTextbookCandidateWithProvider(resolverProvider, input),
            runId: modelRunId,
          }),
        )
      : resolveProblemTextbookContextBeforeAnalysis(problemId))).context
  } catch (error) {
    console.error('[ProblemAI] 分析前教材解析失败，将按无教材上下文继续', error)
    return null
  }
}

async function drainPendingProblemAI() {
  while (true) {
    const run = await claimNextProblemAIModelRun()
    if (!run) return
    notifyProblemAIStatus(run.problemId)

    let activeRun = run
    const errors: AIErrorEnvelope[] = []
    try {
      const providers = getVisionProvidersForRun(run.provider, run.model)
      const resolvedTextbookContext = await getResolvedTextbookMetadata(
        run.problemId,
        run.id,
        providers,
      )
      let completedProviderResult: AIProviderResult | null = null
      for (const provider of providers) {
        if (activeRun.provider !== provider.id || activeRun.model !== provider.model) {
          activeRun = await updateProcessingModelRunProvider(activeRun, provider.id, provider.model)
        }
        try {
          const providerResult = await runWithAIBackoff({
            context: { providerId: provider.id, model: provider.model, runId: activeRun.id },
            operation: async () => provider.analyzeProblem
              ? await (async () => {
                  const regions = await getProblemRegions(activeRun.problemId)
                  const questionRegion = regions.find((region) => region.type === 'question')
                  const diagrams = preferredRegions(regions, 'diagram')
                  return provider.analyzeProblem!({
                    ...activeRun.input,
                    questionImagePath: questionRegion?.imagePath ?? activeRun.input.cropImagePath,
                    diagramImagePaths: diagrams.filter((region) => region.imagePath).map((region) => region.imagePath as string),
                    answerImagePaths: regions.filter((region) => region.type === 'answer' && region.imagePath).map((region) => region.imagePath as string),
                    regionIds: regions.map((region) => region.id),
                    ...(resolvedTextbookContext ? { resolvedTextbookContext } : {}),
                  })
                })()
              : provider.analyzeProblemImage(activeRun.input),
            onFailure: async (error, envelope) => {
              const rawOutput = error instanceof AIProviderFailure ? error.rawOutput : ''
              const repairStrategy = error instanceof AIProviderFailure ? error.repairStrategy : null
              if (error instanceof AIProviderFailure && error.usage) {
                await recordProcessingModelRunOutput(
                  activeRun, rawOutput, repairStrategy, envelope, error.usage,
                )
              } else {
                await recordProcessingModelRunOutput(
                  activeRun, rawOutput, repairStrategy, envelope,
                )
              }
              errors.push(envelope)
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
          completedProviderResult = providerResult
          errors.length = 0
        } catch (error) {
          const envelope = error instanceof AIExecutionError
            ? error.envelope
            : classifyAIError(error, { providerId: provider.id, model: provider.model, runId: activeRun.id })
          if (!envelope.fallbackAllowed) throw new AIExecutionError(envelope)
        }
        if (completedProviderResult) break
        const lastError = errors.at(-1)
        if (lastError && !lastError.fallbackAllowed) throw new AIExecutionError(lastError)
      }
      if (!completedProviderResult) {
        throw new AIExecutionError(errors.at(-1) ?? createAIError('PROVIDER_ERROR', { runId: activeRun.id }))
      }

      let result = normalizeAIProblemAnalysis(completedProviderResult.analysis)
      let diagramImagePath: string | null = null
      const manualDiagram = preferredRegions(await getProblemRegions(activeRun.problemId), 'diagram')
        .find((region) => region.source === 'manual')
      if (!manualDiagram && result.hasDiagram && hasUsableDiagramBounds(result.diagramBBox)) {
        try {
          const diagram = await cropProblemDiagram(activeRun.problemId, activeRun.input.cropImagePath, result.diagramBBox)
          diagramImagePath = diagram.path
        } catch (error) {
          result = { ...result, warnings: [...result.warnings, `已识别图形边界，但独立抠图失败：${String(error)}`] }
        }
      }
      let previousDiagramImagePath: string | null
      try {
        previousDiagramImagePath = await completeProblemAIModelRun(activeRun, result, diagramImagePath)
      } catch (error) {
        const classified = classifyAIError(error, { runId: activeRun.id })
        throw new AIExecutionError(classified.code === 'MAPPING_ERROR'
          ? classified
          : createAIError('PERSISTENCE_ERROR', { runId: activeRun.id, detailSafe: classified.detailSafe }))
      }
      if (previousDiagramImagePath && previousDiagramImagePath !== diagramImagePath) {
        removeProblemDiagram(previousDiagramImagePath).catch(() => {})
      }
      try {
        await markGeometryDiagramsStale(activeRun.problemId)
      } catch (error) {
        console.error('[ProblemAI] 旧 TikZ 过期标记失败，保留原图', error)
      }
      try {
        await queueProblemSolution(activeRun.problemId)
        void runSolutionWorker()
      } catch (error) {
        await markProblemSolutionFailed(activeRun.problemId, error)
      }
      if (result.hasDiagram && result.diagramKind === 'geometry') {
        try {
          await coordinateGeometryScene(activeRun.problemId)
        } catch (error) {
          // The solution is pending here; this check deliberately waits. TikZ
          // never rolls back the successfully persisted problem analysis.
          console.error('[ProblemAI] 几何图协调检查失败，保留原图', error)
        }
      }
      try {
        await queueStudentAttempt(activeRun.problemId)
        void runIntelligenceWorker()
      } catch (error) {
        console.error('用户解答识别任务排队失败', error)
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

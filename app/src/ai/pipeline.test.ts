import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AIProblemAnalysis,
  ModelRun,
} from '../domain/models'

const {
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
  cropProblemDiagram,
  removeProblemDiagram,
} = vi.hoisted(() => ({
  claimNextProblemAIModelRun: vi.fn(),
  completeProblemAIModelRun: vi.fn(),
  failProblemAIModelRun: vi.fn(),
  markProblemSolutionFailed: vi.fn(),
  queueProblemSolution: vi.fn(),
  queueStudentAttempt: vi.fn(),
  getProblemRegions: vi.fn(),
  recordProcessingModelRunOutput: vi.fn(),
  recoverProblemAITasks: vi.fn(),
  updateProcessingModelRunProvider: vi.fn(),
  cropProblemDiagram: vi.fn(),
  removeProblemDiagram: vi.fn(),
}))

vi.mock('../platform/database', () => ({
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
}))

vi.mock('./solutionPipeline', () => ({
  runSolutionWorker: vi.fn(),
}))

vi.mock('../platform/native', () => ({
  analyzeProblemWithOpenAICompatible: vi.fn(),
  cropProblemDiagram,
  removeProblemDiagram,
}))

import { runProblemAIWorker } from './pipeline'
import { setAIProviderForTests } from './provider'

const run: ModelRun = {
  id: 'run-1',
  problemId: 'problem-1',
  taskType: 'analyze_problem_image',
  provider: 'test',
  model: 'test-v1',
  input: {
    problemId: 'problem-1',
    cropImagePath: '/tmp/problem.jpg',
    sourceDocumentCorrectedImagePath: '/tmp/page.jpg',
    cropRect: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
  },
  output: null,
  rawOutput: '',
  repairStrategy: null,
  status: 'processing',
  errorMessage: null,
  createdAt: 1,
}

const analysis: AIProblemAnalysis = {
  title: '数学-选择题',
  subject: '数学',
  problemType: '选择题',
  stemMarkdown: '题干',
  choices: [],
  subQuestions: [],
  hasDiagram: false,
  diagramKind: 'unknown',
  diagramBBox: { x: 0, y: 0, width: 0, height: 0 },
  knowledgePoints: [],
  knowledgeTags: [],
  methodTags: [],
  modelTags: [],
  difficulty: null,
  errorCategories: [],
  confidence: 0.8,
  warnings: [],
}

describe('problem AI worker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    completeProblemAIModelRun.mockResolvedValue(null)
    queueProblemSolution.mockResolvedValue(undefined)
    queueStudentAttempt.mockResolvedValue(undefined)
    getProblemRegions.mockResolvedValue([])
    cropProblemDiagram.mockResolvedValue({
      path: '/tmp/diagram.jpg',
      created: true,
    })
    removeProblemDiagram.mockResolvedValue(undefined)
    setAIProviderForTests({
      id: 'test',
      model: 'test-v1',
      supportsVision: true,
      supportsText: true,
      analyzeProblemImage: vi.fn().mockResolvedValue({
        analysis,
        rawOutput: '{"title":"数学 · 选择题"}',
        repairStrategy: null,
      }),
    })
  })

  it('completes a claimed image analysis task', async () => {
    claimNextProblemAIModelRun
      .mockResolvedValueOnce(run)
      .mockResolvedValueOnce(null)

    await runProblemAIWorker()

    expect(completeProblemAIModelRun).toHaveBeenCalledWith(
      run,
      analysis,
      null,
    )
    expect(recordProcessingModelRunOutput).toHaveBeenCalledWith(
      run,
      '{"title":"数学 · 选择题"}',
      null,
    )
    expect(failProblemAIModelRun).not.toHaveBeenCalled()
    expect(queueProblemSolution).toHaveBeenCalledWith(run.problemId)
  })

  it('crops a detected diagram and removes the superseded crop', async () => {
    const diagramAnalysis: AIProblemAnalysis = {
      ...analysis,
      hasDiagram: true,
      diagramKind: 'geometry',
      diagramBBox: { x: 0.4, y: 0.2, width: 0.5, height: 0.6 },
    }
    completeProblemAIModelRun.mockResolvedValue('/tmp/old-diagram.jpg')
    setAIProviderForTests({
      id: 'test',
      model: 'test-v1',
      supportsVision: true,
      supportsText: true,
      analyzeProblemImage: vi.fn().mockResolvedValue({
        analysis: diagramAnalysis,
        rawOutput: '{}',
        repairStrategy: null,
      }),
    })
    claimNextProblemAIModelRun
      .mockResolvedValueOnce(run)
      .mockResolvedValueOnce(null)

    await runProblemAIWorker()

    expect(cropProblemDiagram).toHaveBeenCalledWith(
      run.problemId,
      run.input.cropImagePath,
      expect.objectContaining({
        x: expect.closeTo(0.38),
        y: expect.closeTo(0.18),
        width: expect.closeTo(0.54),
        height: expect.closeTo(0.64),
      }),
    )
    expect(completeProblemAIModelRun).toHaveBeenCalledWith(
      run,
      expect.objectContaining({
        hasDiagram: true,
        diagramKind: 'geometry',
      }),
      '/tmp/diagram.jpg',
    )
    expect(removeProblemDiagram).toHaveBeenCalledWith(
      '/tmp/old-diagram.jpg',
    )
  })

  it('records provider failures without throwing out of the worker', async () => {
    const error = new Error('provider unavailable')
    setAIProviderForTests({
      id: 'test',
      model: 'test-v1',
      supportsVision: true,
      supportsText: true,
      analyzeProblemImage: vi.fn().mockRejectedValue(error),
    })
    claimNextProblemAIModelRun
      .mockResolvedValueOnce(run)
      .mockResolvedValueOnce(null)

    await runProblemAIWorker()

    expect(failProblemAIModelRun).toHaveBeenCalledWith(
      run,
      expect.objectContaining({
        message: expect.stringContaining('provider unavailable'),
      }),
    )
    expect(completeProblemAIModelRun).not.toHaveBeenCalled()
  })

  it('drains a task queued while the worker is finishing', async () => {
    let releaseFirstClaim: (value: null) => void = () => undefined
    claimNextProblemAIModelRun
      .mockImplementationOnce(
        () =>
          new Promise<null>((resolve) => {
            releaseFirstClaim = resolve
          }),
      )
      .mockResolvedValueOnce(run)
      .mockResolvedValueOnce(null)

    const firstDrain = runProblemAIWorker()
    const secondDrain = runProblemAIWorker()
    releaseFirstClaim(null)
    await Promise.all([firstDrain, secondDrain])

    expect(completeProblemAIModelRun).toHaveBeenCalledWith(
      run,
      analysis,
      null,
    )
    expect(claimNextProblemAIModelRun).toHaveBeenCalledTimes(3)
  })
})

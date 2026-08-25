import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SolutionModelRun } from '../domain/models'

const {
  claimNextSolutionModelRun,
  completeSolutionModelRun,
  failSolutionModelRun,
  recordProcessingModelRunOutput,
  recoverSolutionTasks,
  updateProcessingModelRunProvider,
} = vi.hoisted(() => ({
  claimNextSolutionModelRun: vi.fn(),
  completeSolutionModelRun: vi.fn(),
  failSolutionModelRun: vi.fn(),
  recordProcessingModelRunOutput: vi.fn(),
  recoverSolutionTasks: vi.fn(),
  updateProcessingModelRunProvider: vi.fn(),
}))
const coordinateGeometryScene = vi.hoisted(() => vi.fn())

vi.mock('../platform/database', () => ({
  claimNextSolutionModelRun,
  completeSolutionModelRun,
  failSolutionModelRun,
  recordProcessingModelRunOutput,
  recoverSolutionTasks,
  updateProcessingModelRunProvider,
}))

vi.mock('../platform/native', () => ({
  analyzeProblemWithAntigravityCLI: vi.fn(),
  analyzeProblemWithOpenAICompatible: vi.fn(),
}))
vi.mock('../platform/geometrySceneDatabase', () => ({ coordinateGeometryScene }))

import {
  resumeSolutionPipeline,
  runSolutionWorker,
} from './solutionPipeline'
import { setAIProviderForTests } from './provider'

const run: SolutionModelRun = {
  id: 'solution-run-1',
  problemId: 'problem-1',
  taskType: 'generate_solution',
  provider: 'solution-test',
  model: 'solution-v1',
  input: {
    problemId: 'problem-1',
    cropImagePath: '/tmp/problem.jpg',
    subject: '数学',
    problemType: '函数题',
    stemMarkdown: '求函数最值。',
    choices: [],
    subQuestions: [],
    hasDiagram: false,
    diagramKind: 'unknown',
    knowledgePoints: ['二次函数'],
  },
  output: null,
  rawOutput: '',
  repairStrategy: null,
  status: 'processing',
  errorMessage: null,
  createdAt: 1,
}

const generated = {
  contentMarkdown: String.raw`$$y=(x-1)^2-1\Rightarrow y_{\min}=-1$$`,
  steps: [
    {
      index: 1,
      title: '配方',
      contentMarkdown: String.raw`$$y=(x-1)^2-1$$`,
    },
  ],
  keyMethod: '配方法',
  usedFormulas: [String.raw`y=a(x-h)^2+k`],
  knowledgePoints: ['二次函数最值'],
}

describe('solution worker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setAIProviderForTests({
      id: 'solution-test',
      model: 'solution-v1',
      supportsVision: true,
      supportsText: true,
      analyzeProblemImage: vi.fn(),
      generateSolution: vi.fn().mockResolvedValue({
        solution: generated,
        rawOutput: '{"content_markdown":"solution"}',
        repairStrategy: null,
      }),
    })
  })

  it('persists a completed generated solution', async () => {
    claimNextSolutionModelRun
      .mockResolvedValueOnce(run)
      .mockResolvedValueOnce(null)

    await runSolutionWorker()

    expect(recordProcessingModelRunOutput).toHaveBeenCalledWith(
      run,
      '{"content_markdown":"solution"}',
      null,
    )
    expect(completeSolutionModelRun).toHaveBeenCalledWith(run, generated)
    expect(coordinateGeometryScene).toHaveBeenCalledWith(run.problemId)
    expect(completeSolutionModelRun.mock.invocationCallOrder[0])
      .toBeLessThan(coordinateGeometryScene.mock.invocationCallOrder[0])
    expect(failSolutionModelRun).not.toHaveBeenCalled()
  })

  it('records a clear failure without escaping the worker', async () => {
    setAIProviderForTests({
      id: 'solution-test',
      model: 'solution-v1',
      supportsVision: true,
      supportsText: true,
      analyzeProblemImage: vi.fn(),
      generateSolution: vi.fn().mockRejectedValue(
        new Error('Gemini CLI unavailable'),
      ),
    })
    claimNextSolutionModelRun
      .mockResolvedValueOnce(run)
      .mockResolvedValueOnce(null)

    await runSolutionWorker()

    expect(failSolutionModelRun).toHaveBeenCalledWith(
      run,
      expect.objectContaining({
        envelope: expect.objectContaining({
          code: 'PROVIDER_ERROR',
          detailSafe: 'Gemini CLI unavailable',
        }),
      }),
    )
  })

  it('recovers interrupted work before draining pending tasks', async () => {
    claimNextSolutionModelRun.mockResolvedValueOnce(null)
    await resumeSolutionPipeline()
    expect(recoverSolutionTasks).toHaveBeenCalledOnce()
    expect(claimNextSolutionModelRun).toHaveBeenCalledOnce()
  })
})

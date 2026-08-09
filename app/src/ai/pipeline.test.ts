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

const { resolveProblemTextbookContextBeforeAnalysis } = vi.hoisted(() => ({
  resolveProblemTextbookContextBeforeAnalysis: vi.fn(),
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

vi.mock('../platform/horizonDatabase', () => ({
  resolveProblemTextbookContextBeforeAnalysis,
}))

import { resumeProblemAIPipeline, runProblemAIWorker } from './pipeline'
import { AIProviderFailure, setAIProviderForTests } from './provider'
import { createAIError } from '../domain/aiError'

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
  textbookHint: null,
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
    resolveProblemTextbookContextBeforeAnalysis.mockResolvedValue({ match: null, context: null })
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

  it('recovers interrupted runs before claiming resumed work', async () => {
    const order: string[] = []
    recoverProblemAITasks.mockImplementationOnce(async () => {
      order.push('recover')
    })
    claimNextProblemAIModelRun.mockImplementationOnce(async () => {
      order.push('claim')
      return null
    })

    await resumeProblemAIPipeline()

    expect(order).toEqual(['recover', 'claim'])
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
        envelope: expect.objectContaining({
          code: 'PROVIDER_ERROR',
          detailSafe: 'provider unavailable',
        }),
      }),
    )
    expect(completeProblemAIModelRun).not.toHaveBeenCalled()
  })

  it('does not retry or fallback authentication failures', async () => {
    const analyze = vi.fn().mockRejectedValue(new AIProviderFailure(
      createAIError('AUTHENTICATION_ERROR', { httpStatus: 401 }),
    ))
    setAIProviderForTests({
      id: 'test', model: 'test-v1', supportsVision: true, supportsText: true,
      analyzeProblemImage: analyze,
    })
    claimNextProblemAIModelRun.mockResolvedValueOnce(run).mockResolvedValueOnce(null)

    await runProblemAIWorker()

    expect(analyze).toHaveBeenCalledTimes(1)
    expect(failProblemAIModelRun).toHaveBeenCalledWith(run, expect.objectContaining({
      envelope: expect.objectContaining({ code: 'AUTHENTICATION_ERROR', fallbackAllowed: false }),
    }))
  })

  it('retries a rate limit failure once before completing', async () => {
    const analyze = vi.fn()
      .mockRejectedValueOnce(new AIProviderFailure(createAIError('RATE_LIMIT_ERROR', { httpStatus: 429 })))
      .mockResolvedValueOnce({ analysis, rawOutput: '{}', repairStrategy: null })
    setAIProviderForTests({
      id: 'test', model: 'test-v1', supportsVision: true, supportsText: true,
      analyzeProblemImage: analyze,
    })
    claimNextProblemAIModelRun.mockResolvedValueOnce(run).mockResolvedValueOnce(null)

    await runProblemAIWorker()

    expect(analyze).toHaveBeenCalledTimes(2)
    expect(completeProblemAIModelRun).toHaveBeenCalled()
    expect(failProblemAIModelRun).not.toHaveBeenCalled()
  })

  it.each([
    ['canonical tag mapping failed', 'MAPPING_ERROR'],
    ['SQLite transaction failed', 'PERSISTENCE_ERROR'],
  ])('records completion failure %s separately from provider failure', async (message, code) => {
    completeProblemAIModelRun.mockRejectedValueOnce(new Error(message))
    claimNextProblemAIModelRun.mockResolvedValueOnce(run).mockResolvedValueOnce(null)

    await runProblemAIWorker()

    expect(failProblemAIModelRun).toHaveBeenCalledWith(run, expect.objectContaining({
      envelope: expect.objectContaining({ code }),
    }))
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

const lockedTextbook = {
  id: 'textbook-1',
  subject: '数学',
  title: '义务教育教科书·数学八年级下册',
  grade: '八年级',
  volume: '下册',
  publisher: '人民教育出版社',
  edition: null,
}

describe('locked textbook context injection', () => {
  function setupAnalyzeProblemProvider() {
    const analyzeProblem = vi.fn().mockResolvedValue({
      analysis,
      rawOutput: '{"title":"数学 · 选择题"}',
      repairStrategy: null,
    })
    setAIProviderForTests({
      id: 'test',
      model: 'test-v1',
      supportsVision: true,
      supportsText: true,
      analyzeProblem,
      analyzeProblemImage: vi.fn(),
    })
    return analyzeProblem
  }

  beforeEach(() => {
    vi.clearAllMocks()
    completeProblemAIModelRun.mockResolvedValue(null)
    queueProblemSolution.mockResolvedValue(undefined)
    queueStudentAttempt.mockResolvedValue(undefined)
    getProblemRegions.mockResolvedValue([])
    resolveProblemTextbookContextBeforeAnalysis.mockResolvedValue({ match: null, context: null })
  })

  it('injects textbook context when the problem match is user-locked', async () => {
    const analyzeProblem = setupAnalyzeProblemProvider()
    resolveProblemTextbookContextBeforeAnalysis.mockResolvedValue({
      match: { textbook: lockedTextbook, source: 'user' },
      context: {
        textbookId: lockedTextbook.id,
        title: lockedTextbook.title,
        subject: lockedTextbook.subject,
        grade: lockedTextbook.grade,
        volume: lockedTextbook.volume,
        publisher: lockedTextbook.publisher,
        edition: lockedTextbook.edition,
        taxonomyVersion: 2,
        candidates: [],
        totalKnowledgeCount: 0,
        candidateLimit: 30,
        contextCharacterCount: 2,
      },
    })
    claimNextProblemAIModelRun
      .mockResolvedValueOnce(run)
      .mockResolvedValueOnce(null)

    await runProblemAIWorker()

    expect(resolveProblemTextbookContextBeforeAnalysis).toHaveBeenCalledWith(run.problemId)
    expect(analyzeProblem).toHaveBeenCalledWith(
      expect.objectContaining({
        resolvedTextbookContext: expect.objectContaining({
          textbookId: lockedTextbook.id,
          title: '义务教育教科书·数学八年级下册',
          subject: '数学',
          grade: '八年级',
          volume: '下册',
          publisher: '人民教育出版社',
          edition: null,
        }),
      }),
    )
  })

  it('injects a deterministically resolved textbook even when it is not user locked', async () => {
    const analyzeProblem = setupAnalyzeProblemProvider()
    resolveProblemTextbookContextBeforeAnalysis.mockResolvedValue({
      match: { textbook: lockedTextbook, source: 'metadata_match' },
      context: {
        textbookId: lockedTextbook.id,
        title: lockedTextbook.title,
        subject: lockedTextbook.subject,
        grade: lockedTextbook.grade,
        volume: lockedTextbook.volume,
        publisher: lockedTextbook.publisher,
        edition: lockedTextbook.edition,
        taxonomyVersion: 2,
        candidates: [],
        totalKnowledgeCount: 0,
        candidateLimit: 30,
        contextCharacterCount: 2,
      },
    })
    claimNextProblemAIModelRun
      .mockResolvedValueOnce(run)
      .mockResolvedValueOnce(null)

    await runProblemAIWorker()

    expect(analyzeProblem).toHaveBeenCalledTimes(1)
    expect(analyzeProblem.mock.calls[0][0].resolvedTextbookContext).toEqual(
      expect.objectContaining({ textbookId: lockedTextbook.id, subject: '数学' }),
    )
  })

  it('continues without injection when the textbook lookup fails', async () => {
    const analyzeProblem = setupAnalyzeProblemProvider()
    resolveProblemTextbookContextBeforeAnalysis.mockRejectedValue(new Error('db unavailable'))
    claimNextProblemAIModelRun
      .mockResolvedValueOnce(run)
      .mockResolvedValueOnce(null)

    await runProblemAIWorker()

    expect(analyzeProblem).toHaveBeenCalledTimes(1)
    expect(analyzeProblem.mock.calls[0][0].resolvedTextbookContext).toBeUndefined()
    expect(completeProblemAIModelRun).toHaveBeenCalled()
  })
})

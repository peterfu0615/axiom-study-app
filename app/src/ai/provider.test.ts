import { describe, expect, it, vi } from 'vitest'

const analyzeProblemWithOpenAICompatible = vi.hoisted(() => vi.fn())
const analyzeProblemWithAntigravityCLI = vi.hoisted(() => vi.fn())

vi.mock('../platform/native', () => ({
  analyzeProblemWithAntigravityCLI,
  analyzeProblemWithOpenAICompatible,
}))

import {
  AntigravityCLIProvider,
  configureAIProviders,
  getSolutionProvidersForRun,
  getVisionProvidersForRun,
  MockAIProvider,
  OpenAICompatibleProvider,
  SOLUTION_PROVIDER_REQUIRED,
  VISION_PROVIDER_REQUIRED,
} from './provider'

describe('MockAIProvider', () => {
  it('provides a confirmation-safe textbook recognition fallback', async () => {
    const result = await new MockAIProvider(0).recognizeTextbook({
      sourceName: '七年级数学上册.pdf',
      pageCount: 120,
      outline: [],
      pages: [],
    })
    expect(result.recognition.title.value).toBe('七年级数学上册')
    expect(result.recognition.subject.value).toBeNull()
    expect(result.recognition.subject.confidence).toBeLessThan(0.5)
  })
  it('returns the problem-understanding schema from image input only', async () => {
    const result = await new MockAIProvider(0).analyzeProblemImage({
      problemId: 'problem-1',
      cropImagePath: '/tmp/problem.jpg',
      sourceDocumentCorrectedImagePath: '/tmp/page.jpg',
      cropRect: { x: 0.1, y: 0.2, width: 0.8, height: 0.3 },
    })

    expect(result.analysis.subject).toBe('数学')
    expect(result.analysis.title).toContain('数学')
    expect(result.analysis.problemType).toContain('Mock')
    expect(result.analysis.confidence).toBeGreaterThan(0)
    expect(result.analysis.warnings).toHaveLength(1)
    expect(result.rawOutput).toContain('stem_markdown')
  })

  it('fails without a crop image', async () => {
    await expect(
      new MockAIProvider(0).analyzeProblemImage({
        problemId: 'problem-1',
        cropImagePath: '',
        sourceDocumentCorrectedImagePath: null,
        cropRect: { x: 0, y: 0, width: 1, height: 1 },
      }),
    ).rejects.toThrow('题块图片')
  })

  it('calls the native OpenAI-compatible multimodal adapter', async () => {
    analyzeProblemWithOpenAICompatible.mockResolvedValueOnce({
      rawOutput: JSON.stringify({
        title: '数学 · 几何证明 · 辅助线法',
        subject: '数学',
        problem_type: '几何证明',
        stem_markdown: '证明题',
        choices: [],
        sub_questions: [],
        diagram: {
          exists: true,
          kind: 'geometry',
          bbox: { x: 0.5, y: 0, width: 0.5, height: 1 },
        },
        knowledge_points: ['平行线'],
        confidence: 0.9,
        warnings: [],
      }),
      errorMessage: null,
    })
    const provider = new OpenAICompatibleProvider({
      id: 'provider-1',
      name: 'Vision Provider',
      provider: 'openai_compatible',
      baseUrl: 'https://example.com/v1',
      model: 'vision-model',
      apiKey: '',
      hasApiKey: true,
      apiKeySuffix: 'test',
      credentialRef: 'provider-1',
      commandPath: '',
      supportsVision: true,
      supportsText: true,
      enabled: true,
      sortOrder: 0,
      createdAt: 1,
      updatedAt: 1,
    })

    const result = await provider.analyzeProblemImage({
      problemId: 'problem-1',
      cropImagePath: '/tmp/problem.jpg',
      sourceDocumentCorrectedImagePath: null,
      cropRect: { x: 0, y: 0, width: 1, height: 1 },
    })

    expect(analyzeProblemWithOpenAICompatible).toHaveBeenCalledWith({
      baseUrl: 'https://example.com/v1',
      model: 'vision-model',
      providerId: 'provider-1',
      cropImagePath: '/tmp/problem.jpg',
      prompt: expect.stringContaining('只返回一个符合 JSON Schema'),
      jsonSchema: expect.any(String),
    })
    expect(result.analysis.title).toBe('数学-几何证明-辅助线法')
  })

  it('calls the local Antigravity CLI adapter with model and schema', async () => {
    analyzeProblemWithAntigravityCLI.mockResolvedValueOnce({
      rawOutput: JSON.stringify({
        title: '函数-图像题-单调性',
        subject: '数学',
        problem_type: '函数图像题',
        stem_markdown: '观察函数图像。',
        choices: [],
        sub_questions: [],
        diagram: {
          exists: true,
          kind: 'function',
          bbox: { x: 0.2, y: 0.2, width: 0.6, height: 0.6 },
        },
        knowledge_points: ['函数图像'],
        confidence: 0.92,
        warnings: [],
      }),
      errorMessage: null,
    })
    const provider = new AntigravityCLIProvider({
      id: 'antigravity-1',
      name: 'Gemini CLI',
      provider: 'antigravity_cli',
      baseUrl: '',
      apiKey: '',
      hasApiKey: false,
      apiKeySuffix: '',
      credentialRef: '',
      commandPath: '/Users/example/.local/bin/agy',
      model: 'gemini-3.6-flash-high',
      supportsVision: true,
      supportsText: true,
      enabled: true,
      sortOrder: 0,
      createdAt: 1,
      updatedAt: 1,
    })

    const result = await provider.analyzeProblemImage({
      problemId: 'problem-1',
      cropImagePath: '/tmp/problem.jpg',
      sourceDocumentCorrectedImagePath: null,
      cropRect: { x: 0, y: 0, width: 1, height: 1 },
    })

    expect(analyzeProblemWithAntigravityCLI).toHaveBeenCalledWith({
      commandPath: '/Users/example/.local/bin/agy',
      model: 'gemini-3.6-flash-high',
      cropImagePath: '/tmp/problem.jpg',
      prompt: expect.stringContaining('只返回一个符合 JSON Schema'),
      jsonSchema: expect.stringContaining('"diagram"'),
    })
    expect(result.analysis.diagramKind).toBe('function')
  })

  it('generates a structured solution through the configured Antigravity model', async () => {
    analyzeProblemWithAntigravityCLI.mockResolvedValueOnce({
      rawOutput: JSON.stringify({
        content_markdown: String.raw`$$\because AB=AC\therefore \angle B=\angle C$$`,
        steps: [
          {
            index: 1,
            title: '等腰三角形性质',
            content_markdown: String.raw`$$\therefore \angle B=\angle C$$`,
          },
        ],
        key_method: '等腰三角形性质',
        used_formulas: [String.raw`\angle B=\angle C`],
        knowledge_points: ['等腰三角形'],
      }),
      errorMessage: null,
    })
    const provider = new AntigravityCLIProvider({
      id: 'antigravity-solution',
      name: 'Gemini CLI',
      provider: 'antigravity_cli',
      baseUrl: '',
      apiKey: '',
      hasApiKey: false,
      apiKeySuffix: '',
      credentialRef: '',
      commandPath: '/Users/example/.local/bin/agy',
      model: 'gemini-custom-model',
      supportsVision: true,
      supportsText: true,
      enabled: true,
      sortOrder: 0,
      createdAt: 1,
      updatedAt: 1,
    })

    const result = await provider.generateSolution({
      problemId: 'problem-1',
      cropImagePath: '/tmp/problem.jpg',
      subject: '数学',
      problemType: '几何证明',
      stemMarkdown: '已知 $AB=AC$，证明两底角相等。',
      choices: [],
      subQuestions: [],
      hasDiagram: true,
      diagramKind: 'geometry',
      knowledgePoints: ['等腰三角形'],
    })

    expect(analyzeProblemWithAntigravityCLI).toHaveBeenLastCalledWith({
      commandPath: '/Users/example/.local/bin/agy',
      model: 'gemini-custom-model',
      cropImagePath: '/tmp/problem.jpg',
      prompt: expect.stringContaining('<problem_json>'),
      jsonSchema: expect.stringContaining('"content_markdown"'),
    })
    expect(result.solution.steps[0].title).toBe('等腰三角形性质')
  })

  it('extracts student work and explains a selected fragment with multiple image paths', async () => {
    analyzeProblemWithAntigravityCLI
      .mockResolvedValueOnce({
        rawOutput: JSON.stringify({
          raw_markdown: String.raw`设 $x=1$。`,
          steps: [
            { index: 1, content_markdown: String.raw`$x=1$`, confidence: 0.88 },
          ],
        }),
        errorMessage: null,
      })
      .mockResolvedValueOnce({
        rawOutput: JSON.stringify({
          explanation_markdown: String.raw`这里使用了 $x=1$。`,
          key_point: '代入',
          related_knowledge_points: ['方程'],
        }),
        errorMessage: null,
      })
    const provider = new AntigravityCLIProvider({
      id: 'antigravity-intelligence',
      name: 'Gemini CLI',
      provider: 'antigravity_cli',
      baseUrl: '',
      apiKey: '',
      hasApiKey: false,
      apiKeySuffix: '',
      credentialRef: '',
      commandPath: '/Users/example/.local/bin/agy',
      model: 'gemini-configured',
      supportsVision: true,
      supportsText: true,
      enabled: true,
      sortOrder: 0,
      createdAt: 1,
      updatedAt: 1,
    })
    const attempt = await provider.extractStudentAttempt({
      problemId: 'problem-1',
      answerImagePaths: ['/tmp/answer-1.jpg', '/tmp/answer-2.jpg'],
      questionImagePath: '/tmp/problem.jpg',
      subject: '数学',
      problemContext: '解方程',
      choices: [],
      subQuestions: [],
    })
    expect(attempt.attempt.steps).toHaveLength(1)
    expect(analyzeProblemWithAntigravityCLI).toHaveBeenLastCalledWith(
      expect.objectContaining({ imagePaths: ['/tmp/answer-1.jpg', '/tmp/answer-2.jpg'] }),
    )
    const explanation = await provider.explainSelection({
      problemId: 'problem-1',
      cropImagePath: '/tmp/problem.jpg',
      source: 'solution',
      selectedText: 'x=1',
      problemContext: '解方程 $x=1$',
      currentStep: null,
      solutionContext: '$x=1$',
      studentAttemptContext: '',
      knowledgePoints: ['方程'],
    })
    expect(explanation.result.keyPoint).toBe('代入')
  })
})

describe('Provider routing', () => {
  it('uses only enabled VLM profiles and preserves fallback order', () => {
    const base = {
      provider: 'openai_compatible' as const,
      baseUrl: 'https://example.com/v1',
      apiKey: 'sk-test',
      hasApiKey: true,
      apiKeySuffix: 'test',
      credentialRef: 'test-cred',
      commandPath: '',
      supportsText: true,
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
    }
    configureAIProviders([
      {
        ...base,
        id: 'text-only',
        name: 'Text',
        model: 'llm',
        supportsVision: false,
        sortOrder: 0,
      },
      {
        ...base,
        id: 'vlm-primary',
        name: 'VLM 1',
        model: 'vlm-1',
        supportsVision: true,
        sortOrder: 1,
      },
      {
        ...base,
        id: 'vlm-fallback',
        name: 'VLM 2',
        model: 'vlm-2',
        supportsVision: true,
        sortOrder: 2,
      },
    ])
    expect(
      getVisionProvidersForRun('vlm-primary', 'vlm-1').map(
        (provider) => provider.id,
      ),
    ).toEqual(['vlm-primary', 'vlm-fallback'])
  })

  it('reports a clear error when no enabled model accepts images', () => {
    configureAIProviders([
      {
        id: 'text-only',
        name: 'Text',
        provider: 'openai_compatible',
        baseUrl: 'https://example.com/v1',
        apiKey: 'sk-test',
        hasApiKey: true,
        apiKeySuffix: 'test',
        credentialRef: 'test-cred',
        commandPath: '',
        model: 'llm',
        supportsVision: false,
        supportsText: true,
        enabled: true,
        sortOrder: 0,
        createdAt: 1,
        updatedAt: 1,
      },
    ])
    expect(() =>
      getVisionProvidersForRun('text-only', 'llm'),
    ).toThrow(VISION_PROVIDER_REQUIRED)
  })

  it('routes Solution to all text-capable providers with requested provider first', () => {
    configureAIProviders([
      {
        id: 'openai',
        name: 'OpenAI',
        provider: 'openai_compatible',
        baseUrl: 'https://example.com/v1',
        apiKey: 'sk-test',
        hasApiKey: true,
        apiKeySuffix: 'test',
        credentialRef: 'test-cred',
        commandPath: '',
        model: 'text-model',
        supportsVision: true,
        supportsText: true,
        enabled: true,
        sortOrder: 0,
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'antigravity',
        name: 'Gemini',
        provider: 'antigravity_cli',
        baseUrl: '',
        apiKey: '',
        hasApiKey: false,
        apiKeySuffix: '',
        credentialRef: '',
        commandPath: '/usr/local/bin/agy',
        model: 'gemini-configured',
        supportsVision: true,
        supportsText: true,
        enabled: true,
        sortOrder: 1,
        createdAt: 1,
        updatedAt: 1,
      },
    ])
    // 正解生成为文字任务：所有 supportsText 的 Provider 均可承担，
    // 请求的 Provider 排在首位，其余按 sortOrder 顺序作为 Fallback。
    expect(
      getSolutionProvidersForRun('antigravity', 'gemini-configured').map(
        (provider) => provider.id,
      ),
    ).toEqual(['antigravity', 'openai'])

    configureAIProviders([])
    expect(() =>
      getSolutionProvidersForRun('missing', 'missing'),
    ).toThrow(SOLUTION_PROVIDER_REQUIRED)
  })
})

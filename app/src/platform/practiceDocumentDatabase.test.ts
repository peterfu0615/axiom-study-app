import { describe, expect, it, vi } from 'vitest'
import type { PracticeSet } from '../domain/practice'
import { buildCompletePracticeDocument } from '../domain/practiceDocument'
import { PracticeDocumentError, practiceDocumentDiagnostic, preparePracticeDocument } from './practiceDocumentDatabase'

describe('practice PDF identity', () => {
  it('uses one stable attempt and item identity in machine metadata', () => {
    const set = {
      id: 'set-pdf', subject: '数学', strategy: 'deterministic-v1', items: [{
        id: 'item-pdf', practiceSetId: 'set-pdf', orderIndex: 0, difficulty: 'basic',
        statementMarkdown: '求 x', options: null, canonicalAnswer: 'x=1', solutionJson: '{"contentMarkdown":"解"}',
        diagramIds: [], diagramImagePaths: [],
      }],
    } as unknown as PracticeSet
    const document = buildCompletePracticeDocument(set, { attemptId: 'attempt-pdf', generatedAt: 1 })
    const answerQuestion = document.sections
      .find((section) => section.kind === 'exercise')
      ?.blocks.find((block) => block.kind === 'question')
    expect(document.id).toContain('set-pdf:attempt-pdf:complete')
    expect(answerQuestion).toMatchObject({ kind: 'question', practiceItemId: 'item-pdf' })
    expect(answerQuestion?.kind === 'question' && answerQuestion.content
      .some((block) => block.kind === 'answerSpace' && block.practiceItemId === 'item-pdf')).toBe(true)
  })

  it('reuses a ready cache without rendering', async () => {
    const cached = { id: 'cached-document' } as never
    const readReady = vi.fn(async () => cached)
    const exportPdf = vi.fn()
    await expect(preparePracticeDocument({ id: 'set-cache' } as never, { readReady, exportPdf })).resolves.toBe(cached)
    expect(exportPdf).not.toHaveBeenCalled()
  })

  it('surfaces failure and allows a later retry to recover', async () => {
    const generated = { id: 'generated-document' } as never
    const readReady = vi.fn(async () => null)
    const exportPdf = vi.fn()
      .mockRejectedValueOnce(new PracticeDocumentError({
        stage: 'render_pdf', code: 'renderer_failed', message: '练习 PDF 排版失败',
        practiceSetId: 'set-retry', rendererContract: 'axiom-typst-v2',
      }))
      .mockResolvedValueOnce(generated)
    const practiceSet = { id: 'set-retry' } as never

    await expect(preparePracticeDocument(practiceSet, { readReady, exportPdf })).rejects.toMatchObject({
      diagnostic: { stage: 'render_pdf', code: 'renderer_failed', practiceSetId: 'set-retry' },
    })
    await expect(preparePracticeDocument(practiceSet, { readReady, exportPdf })).resolves.toBe(generated)
    expect(exportPdf).toHaveBeenCalledTimes(2)
  })

  it('keeps safe renderer diagnostics when Tauri serializes the command error', () => {
    const diagnostic = practiceDocumentDiagnostic(JSON.stringify({
      stage: 'render_pdf', code: 'renderer_unavailable', message: '排版引擎不可用',
      practiceSetId: 'set-safe', rendererContract: 'axiom-typst-v2', rendererVersion: '0.14.2',
    }), 'set-fallback')
    expect(diagnostic).toEqual({
      stage: 'render_pdf', code: 'renderer_unavailable', message: '排版引擎不可用',
      practiceSetId: 'set-safe', rendererContract: 'axiom-typst-v2', rendererVersion: '0.14.2',
    })
  })
})

import { describe, expect, it } from 'vitest'
import type { DocumentProcessingResult } from '../../domain/models'
import {
  isDocumentAutoProcessingCompleted,
  shareDocumentAutoProcessing,
} from './documentAutoProcessing'

function makeResult(documentId: string): DocumentProcessingResult {
  return {
    processingRunId: `run-${documentId}`,
    correctedPath: `/tmp/corrected-${documentId}.jpg`,
    width: 1200,
    height: 1600,
    pageDetected: true,
    corners: {},
    textLines: [],
    blocks: [],
    enhancementMode: 'color',
    warnings: [],
    durationMs: 42,
  }
}

describe('document auto-processing guard', () => {
  it('runs processing once and shares the in-flight promise across remounts', async () => {
    let runs = 0
    let release!: (result: DocumentProcessingResult) => void
    const pending = new Promise<DocumentProcessingResult>((resolve) => {
      release = resolve
    })
    const runner = () => {
      runs += 1
      return pending
    }

    const first = shareDocumentAutoProcessing('doc-inflight', runner)
    const second = shareDocumentAutoProcessing('doc-inflight', runner)
    expect(runs).toBe(1)

    release(makeResult('doc-inflight'))
    await expect(first).resolves.toMatchObject({
      correctedPath: '/tmp/corrected-doc-inflight.jpg',
    })
    await expect(second).resolves.toMatchObject({
      correctedPath: '/tmp/corrected-doc-inflight.jpg',
    })
    expect(runs).toBe(1)
  })

  it('never auto-processes a document again after it completed in this session', async () => {
    const runner = () => Promise.resolve(makeResult('doc-done'))
    await shareDocumentAutoProcessing('doc-done', runner)
    expect(isDocumentAutoProcessingCompleted('doc-done')).toBe(true)

    let reruns = 0
    const next = await shareDocumentAutoProcessing('doc-done', () => {
      reruns += 1
      return Promise.resolve(makeResult('doc-done'))
    })
    expect(next).toBeNull()
    expect(reruns).toBe(0)
  })

  it('releases the claim when processing fails so the next open can retry', async () => {
    let attempts = 0
    const failing = shareDocumentAutoProcessing('doc-fail', () => {
      attempts += 1
      return Promise.reject(new Error('native processing failed'))
    })
    await expect(failing).rejects.toThrow('native processing failed')
    expect(isDocumentAutoProcessingCompleted('doc-fail')).toBe(false)

    const retry = await shareDocumentAutoProcessing('doc-fail', () => {
      attempts += 1
      return Promise.resolve(makeResult('doc-fail'))
    })
    expect(attempts).toBe(2)
    expect(retry).not.toBeNull()
    expect(isDocumentAutoProcessingCompleted('doc-fail')).toBe(true)
  })
})

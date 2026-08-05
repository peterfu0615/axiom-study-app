import type { DocumentProcessingResult } from '../../domain/models'

type ProcessingRunner = () => Promise<DocumentProcessingResult>

const completedDocumentIds = new Set<string>()
const inFlightProcessing = new Map<string, Promise<DocumentProcessingResult>>()

export function isDocumentAutoProcessingCompleted(documentId: string) {
  return completedDocumentIds.has(documentId)
}

/**
 * Deduplicates automatic page processing per source document within the
 * current app session.  StrictMode remounts (or reopening the editor while a
 * run is pending) reuse the in-flight promise instead of dispatching another
 * `process_document` command, and a document that already finished is never
 * auto-processed again.  A failure releases the claim so the next editor
 * open can retry.
 *
 * Returns the processing result, or `null` when the document already
 * completed earlier in this session and the caller should load the persisted
 * blocks instead.
 */
export async function shareDocumentAutoProcessing(
  documentId: string,
  run: ProcessingRunner,
): Promise<DocumentProcessingResult | null> {
  if (completedDocumentIds.has(documentId)) return null
  const existing = inFlightProcessing.get(documentId)
  if (existing) return existing
  const promise = (async () => {
    try {
      const result = await run()
      completedDocumentIds.add(documentId)
      return result
    } finally {
      inFlightProcessing.delete(documentId)
    }
  })()
  inFlightProcessing.set(documentId, promise)
  return promise
}

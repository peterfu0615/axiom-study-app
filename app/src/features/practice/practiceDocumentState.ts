export type PracticeDocumentState = 'idle' | 'loading' | 'ready' | 'error'

export function shouldAutoPreparePracticeDocument(input: {
  attemptLoaded: boolean
  mode: 'ready' | 'submit' | 'scanner' | 'manual_match' | 'processing' | 'results'
  hasDocument: boolean
  documentState: PracticeDocumentState
}) {
  return input.attemptLoaded
    && input.mode !== 'results'
    && !input.hasDocument
    && input.documentState === 'idle'
}

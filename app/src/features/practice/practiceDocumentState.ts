export type PracticeDocumentState = 'idle' | 'loading' | 'ready' | 'error'

export function shouldAutoPreparePracticeDocument(input: {
  attemptLoaded: boolean
  mode: 'ready' | 'submit' | 'processing' | 'results'
  hasDocument: boolean
  documentState: PracticeDocumentState
}) {
  return input.attemptLoaded
    && input.mode !== 'results'
    && !input.hasDocument
    && input.documentState === 'idle'
}

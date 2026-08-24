export const LEARNING_STATE_EVENT = 'axiom:learning-state-changed'

export function notifyLearningStateChanged(reason: string) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(LEARNING_STATE_EVENT, { detail: { reason } }))
  }
}

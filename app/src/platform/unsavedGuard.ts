/**
 * Registry for pages that hold unsaved changes in local component state.
 *
 * Workspace components are unmounted on section switch; without a guard,
 * half-filled forms (e.g. AI provider settings) are lost silently.  A page
 * registers a guard while mounted; the shell consults it before navigating.
 */
interface UnsavedGuard {
  isDirty: () => boolean
}

const guards = new Map<string, UnsavedGuard>()

export function registerUnsavedGuard(id: string, guard: UnsavedGuard) {
  guards.set(id, guard)
}

export function unregisterUnsavedGuard(id: string) {
  guards.delete(id)
}

export function hasUnsavedChanges(): boolean {
  for (const guard of guards.values()) {
    if (guard.isDirty()) return true
  }
  return false
}

import { afterEach, describe, expect, it } from 'vitest'
import {
  hasUnsavedChanges,
  registerUnsavedGuard,
  unregisterUnsavedGuard,
} from './unsavedGuard'

describe('unsavedGuard', () => {
  afterEach(() => {
    unregisterUnsavedGuard('a')
    unregisterUnsavedGuard('b')
  })

  it('reports no unsaved changes when nothing is registered', () => {
    expect(hasUnsavedChanges()).toBe(false)
  })

  it('reports dirty when any registered guard is dirty', () => {
    registerUnsavedGuard('a', { isDirty: () => false })
    expect(hasUnsavedChanges()).toBe(false)
    registerUnsavedGuard('b', { isDirty: () => true })
    expect(hasUnsavedChanges()).toBe(true)
  })

  it('stops consulting unregistered guards', () => {
    registerUnsavedGuard('a', { isDirty: () => true })
    expect(hasUnsavedChanges()).toBe(true)
    unregisterUnsavedGuard('a')
    expect(hasUnsavedChanges()).toBe(false)
  })
})

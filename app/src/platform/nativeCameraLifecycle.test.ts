import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  unlisten: vi.fn(),
  callbacks: new Map<string, (event: { payload: Record<string, unknown> }) => void>(),
}))

vi.mock('@tauri-apps/api/core', () => ({
  Channel: class {
    onmessage: ((message: unknown) => void) | null = null
  },
  convertFileSrc: (path: string) => path,
  invoke: mocks.invoke,
  isTauri: () => true,
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: mocks.listen,
}))

import {
  processDocument,
  startCameraOrientationWatch,
} from './native'

beforeEach(() => {
  mocks.invoke.mockReset()
  mocks.listen.mockReset()
  mocks.unlisten.mockReset()
  mocks.callbacks.clear()
  mocks.listen.mockImplementation(
    async (eventName: string, callback: (event: { payload: Record<string, unknown> }) => void) => {
      mocks.callbacks.set(eventName, callback)
      return mocks.unlisten
    },
  )
})

describe('native camera lifecycle', () => {
  it('scopes orientation events and conditional cleanup to one watcher ID', async () => {
    mocks.invoke.mockResolvedValue(undefined)
    const onUpdate = vi.fn()
    const cleanup = await startCameraOrientationWatch('Peter 的 iPhone', onUpdate)
    const startCall = mocks.invoke.mock.calls.find(
      ([command]) => command === 'start_camera_orientation_watch',
    )
    expect(startCall).toBeTruthy()
    const watchId = startCall?.[1].watchId as string

    const dispatch = mocks.callbacks.get('camera://orientation')
    dispatch?.({
      payload: {
        watchId: 'stale-watch',
        deviceName: 'Peter 的 iPhone',
        isContinuityCamera: true,
        rotationAngle: 90,
      },
    })
    expect(onUpdate).not.toHaveBeenCalled()

    dispatch?.({
      payload: {
        watchId,
        deviceName: 'Peter 的 iPhone',
        isContinuityCamera: true,
        rotationAngle: 90,
      },
    })
    expect(onUpdate).toHaveBeenCalledOnce()

    cleanup()
    expect(mocks.unlisten).toHaveBeenCalledOnce()
    expect(mocks.invoke).toHaveBeenCalledWith('stop_camera_orientation_watch', {
      watchId,
    })
  })

  it('removes a registered listener if watcher startup fails', async () => {
    mocks.invoke.mockRejectedValueOnce(new Error('sidecar unavailable'))
    await expect(
      startCameraOrientationWatch('Camera', vi.fn()),
    ).rejects.toThrow('sidecar unavailable')
    expect(mocks.unlisten).toHaveBeenCalledOnce()
  })

  it('filters document progress and always cleans the listener', async () => {
    mocks.invoke.mockResolvedValueOnce({ correctedPath: '/corrected.jpg' })
    const onProgress = vi.fn()
    const pending = processDocument(
      'document-1',
      '/original.jpg',
      'color',
      onProgress,
    )
    await vi.waitFor(() => {
      expect(mocks.callbacks.has('document-processing-progress')).toBe(true)
    })
    const dispatch = mocks.callbacks.get('document-processing-progress')
    dispatch?.({ payload: { sourceDocumentId: 'document-2', stage: 'starting' } })
    dispatch?.({
      payload: {
        sourceDocumentId: 'document-1',
        stage: 'corrected_ready',
        correctedPath: '/corrected.jpg',
      },
    })
    await pending

    expect(onProgress).toHaveBeenCalledOnce()
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({ stage: 'corrected_ready' }),
    )
    expect(mocks.unlisten).toHaveBeenCalledOnce()
  })
})

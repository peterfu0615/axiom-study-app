import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({
  Channel: class {},
  convertFileSrc: (path: string) => path,
  invoke: mocks.invoke,
  isTauri: () => true,
}))

import { cropProblemImage } from './native'

describe('native privacy IPC', () => {
  beforeEach(() => mocks.invoke.mockReset().mockResolvedValue({ path: '/tmp/crop.png', created: true }))

  it('passes normalized pixel redactions to the native crop command', async () => {
    const rect = { x: 0.1, y: 0.2, width: 0.6, height: 0.5 }
    const redactions = [{ x: 0.12, y: 0.22, width: 0.2, height: 0.05 }]
    await cropProblemImage('problem-1', '/corrected/page.png', rect, redactions)
    expect(mocks.invoke).toHaveBeenCalledWith('crop_problem_image', {
      problemId: 'problem-1',
      sourcePath: '/corrected/page.png',
      rect,
      redactions,
    })
  })
})

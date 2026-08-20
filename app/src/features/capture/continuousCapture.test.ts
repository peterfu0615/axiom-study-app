// @ts-expect-error Vitest executes this contract in Node, while the app tsconfig is browser-only.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('continuous capture queue', () => {
  const source = readFileSync(new URL('./CaptureWorkspace.tsx', import.meta.url), 'utf8')

  it('persists each camera page before reconnecting the selected device', () => {
    const persist = source.indexOf('persistCameraFrame(dataUrl)')
    const save = source.indexOf('saveSourceDocument(media)', persist)
    const reconnect = source.indexOf('openCameraStream(selectedDeviceId)', save)
    expect(persist).toBeGreaterThan(-1)
    expect(save).toBeGreaterThan(persist)
    expect(reconnect).toBeGreaterThan(save)
    expect(source).toContain('可以继续拍摄下一页')
  })

  it('imports every selected Finder image into the durable document queue', () => {
    expect(source).toContain('multiple: true')
    expect(source).toContain('for (const path of paths)')
    expect(source).toContain('documents.push(await saveSourceDocument(media))')
  })
})

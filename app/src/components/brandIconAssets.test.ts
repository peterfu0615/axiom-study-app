// @ts-expect-error Vitest executes this contract in Node, while the app tsconfig is browser-only.
import { createHash } from 'node:crypto'
// @ts-expect-error Vitest executes this contract in Node, while the app tsconfig is browser-only.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function asset(path: string) {
  return readFileSync(new URL(path, import.meta.url)) as Uint8Array
}

function sha256(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex')
}

function pngDimensions(bytes: Uint8Array) {
  expect(new TextDecoder().decode(bytes.subarray(1, 4))).toBe('PNG')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return {
    width: view.getUint32(16),
    height: view.getUint32(20),
  }
}

describe('canonical Axiom icon assets', () => {
  it('tracks the supplied app icons and horizontal wordmark by stable hash', () => {
    const light = asset('../../src-tauri/icons/source/axiom-icon-light-1024.png')
    const dark = asset('../../src-tauri/icons/source/axiom-icon-dark-1024.png')
    const wordmark = asset('../../src-tauri/icons/source/axiom-wordmark.png')
    expect(pngDimensions(light)).toEqual({ width: 1024, height: 1024 })
    expect(pngDimensions(dark)).toEqual({ width: 1024, height: 1024 })
    expect(sha256(light)).toBe(
      '5fd423999b67540deb0c70e2bbc0568b5c801b0f08779b8d47bc684ecb51f9fd',
    )
    expect(sha256(dark)).toBe(
      '7008e424a9cbbecf9da1cb46438f7a680b510db0194933f88efc6373145d6946',
    )
    expect(pngDimensions(wordmark)).toEqual({ width: 9641, height: 2386 })
    expect(sha256(wordmark)).toBe(
      '568317fdbbb8bdb80883f37b64c67a4b8d4df99f2ba75fce5a4cacde85e837ee',
    )
  })

  it('keeps the Sidebar wordmark separate from generated app icon assets', () => {
    const sidebar = readFileSync(new URL('./Sidebar.tsx', import.meta.url), 'utf8')
    const appStyles = readFileSync(new URL('../App.css', import.meta.url), 'utf8')
    expect(sidebar).toContain(
      "../../src-tauri/icons/source/axiom-wordmark.png",
    )
    expect(sidebar).not.toContain('axiom-icon-light-1024.png')
    expect(sidebar).not.toContain('axiom-icon-dark-1024.png')
    expect(sidebar).not.toContain('../../../icons/')
    expect(appStyles).toMatch(/\.brand-icon\s*\{[^}]*width:\s*59px;[^}]*height:\s*15px;/s)

    expect(pngDimensions(asset('../../src-tauri/icons/32x32.png'))).toEqual({
      width: 32,
      height: 32,
    })
    expect(pngDimensions(asset('../../src-tauri/icons/128x128.png'))).toEqual({
      width: 128,
      height: 128,
    })
    expect(pngDimensions(asset('../../src-tauri/icons/128x128@2x.png'))).toEqual({
      width: 256,
      height: 256,
    })
    expect(pngDimensions(asset('../../src-tauri/icons/icon.png'))).toEqual({
      width: 512,
      height: 512,
    })
    expect(pngDimensions(asset('../../public/axiom-icon.png'))).toEqual({
      width: 128,
      height: 128,
    })
    expect(new TextDecoder().decode(
      asset('../../src-tauri/icons/icon.icns').subarray(0, 4),
    )).toBe('icns')
  })
})

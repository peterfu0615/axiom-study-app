import { describe, expect, it } from 'vitest'
// @ts-expect-error Vitest executes this contract in Node, while the app tsconfig is browser-only.
import { readFileSync } from 'node:fs'
import { formatSize, updateErrorTitle } from './updatePresentation'

describe('UpdateSettings display contracts', () => {
  it('formats the GitHub asset size instead of treating HEAD as zero bytes', () => {
    expect(formatSize(33_278_783)).toBe('31.7 MB')
  })

  it('renders unknown asset sizes explicitly', () => {
    expect(formatSize(null)).toBe('大小未知')
    expect(formatSize(0)).toBe('大小未知')
  })

  it('keeps check and install errors distinguishable', () => {
    expect(updateErrorTitle('check')).toBe('检查更新失败')
    expect(updateErrorTitle('install')).toBe('安装更新失败')
  })

  it('routes listener and download failures through the retryable install path', () => {
    const source = readFileSync(new URL('./UpdateSettings.tsx', import.meta.url), 'utf8')
    expect(source).toContain("setErrorPhase('install')")
    expect(source).toMatch(/try \{[\s\S]*onDownloadProgress[\s\S]*downloadAndInstallUpdate/u)
    expect(source).toContain('finally')
    expect(source).toContain('unlistenRef.current = null')
  })
})

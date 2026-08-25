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
    expect(updateErrorTitle('checking')).toBe('检查更新失败')
    expect(updateErrorTitle('verifying_signature')).toBe('更新签名验证失败')
    expect(updateErrorTitle('installing')).toBe('安装更新失败')
  })

  it('shows signed updater stages and never sends an artifact URL to installation', () => {
    const source = readFileSync(new URL('./UpdateSettings.tsx', import.meta.url), 'utf8')
    expect(source).toContain("progress.stage === 'verifying_signature'")
    expect(source).toContain("progress.stage === 'installing'")
    expect(source).toContain('await downloadAndInstallUpdate(setProgress)')
    expect(source).not.toContain('updateInfo.downloadUrl')
    expect(source).toContain('手动下载桥接版本')
  })
})

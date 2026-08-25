// @ts-expect-error Vitest executes this contract in Node, while the app tsconfig is browser-only.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const providers = readFileSync(new URL('./AISettings.tsx', import.meta.url), 'utf8')
const review = readFileSync(new URL('./ReviewSettings.tsx', import.meta.url), 'utf8')

describe('settings product surface', () => {
  it('uses one complete-URL checkbox and keeps technical endpoint details hidden', () => {
    expect(providers).toContain('<strong>完整 URL</strong>')
    expect(providers).toContain("event.target.checked ? 'full_endpoint' : 'auto'")
    expect(providers).not.toContain('label="端点模式"')
    expect(providers).not.toContain('label="结构化输出"')
    expect(providers).not.toContain('最终请求 URL')
  })

  it('keeps a short connection test beside the remove action', () => {
    const actions = providers.slice(
      providers.indexOf('<div className="provider-detail-actions">'),
      providers.indexOf('</div>', providers.indexOf('<div className="provider-detail-actions">')),
    )
    expect(actions).toContain("? '测试中…' : '测试'")
    expect(actions).toContain('移除')
  })

  it('offers exactly three review paces without a custom range input', () => {
    expect(review).toContain("{ value: 'relaxed', label: '省时 · 50%' }")
    expect(review).toContain("{ value: 'standard', label: '均衡 · 70%' }")
    expect(review).toContain("{ value: 'intensive', label: '强化 · 85%' }")
    expect(review).not.toContain('自定义衰减阈值')
    expect(review).not.toContain('type="range"')
  })
})

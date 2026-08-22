// @ts-expect-error Vitest executes this contract in Node, while the app tsconfig is browser-only.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// 产品决策：任务路由已从设置页移除。所有服务始终参与全部任务，
// 服务列表顺序即失败回退的优先级；保存时归一化写回这些不变量。
describe('provider settings normalization contract', () => {
  const source = readFileSync(new URL('./AISettings.tsx', import.meta.url), 'utf8')

  it('no longer renders task routing or per-capability toggles', () => {
    expect(source).not.toContain('任务路由')
    expect(source).not.toContain('PROVIDER_TASK_OPTIONS')
    expect(source).not.toContain('toggleProviderTask')
    // 启用/支持文本/支持图片三个勾选合并为单个「多模态」勾选
    expect(source).toContain('多模态')
    expect(source).not.toContain('支持图片识别</')
    expect(source).not.toContain('支持文本与推理')
  })

  it('persists the always-enabled invariants on every auto-save', () => {
    expect(source).toContain('enabled: true')
    expect(source).toContain('supportsText: true')
    expect(source).toContain('taskTypes: []')
  })

  it('auto-saves instead of exposing a manual save button', () => {
    expect(source).not.toContain('保存设置')
    expect(source).toContain('persistProfiles')
    expect(source).toContain("setTimeout(() => {\n      autoSaveTimerRef.current = null")
  })
})

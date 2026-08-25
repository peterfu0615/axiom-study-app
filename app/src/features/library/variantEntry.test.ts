// @ts-expect-error Vitest executes this contract in Node, while the app tsconfig is browser-only.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const library = readFileSync(new URL('./ProblemLibrary.tsx', import.meta.url), 'utf8')
const today = readFileSync(new URL('../today/TodayWorkspace.tsx', import.meta.url), 'utf8')
const practice = readFileSync(new URL('../practice/PracticeSetView.tsx', import.meta.url), 'utf8')

describe('visible variant entry contract', () => {
  it('keeps multiple variants in a coequal detail page and candidate tabs', () => {
    expect(library).toContain("type DetailTab = 'content' | 'knowledge' | 'method' | 'classification' | 'variants'")
    expect(library).toContain("{ value: 'variants', label: '变式' }")
    expect(library).toContain('ariaLabel="已保存变式"')
    expect(library).toContain('listProblemVariantCandidates')
    expect(library).not.toContain('生成变式前还需：')
    expect(library).toContain('最后一项完成后会自动开始生成')
  })

  it('saves manual variants without starting a one-question practice route', () => {
    expect(library).toContain('手动生成只会加入候选池，不会立刻开始练习')
    expect(library).not.toContain('createPracticeSetFromVariantPreview')
    expect(library).not.toContain('加入今日练习并开始')
    expect(library).toContain('返回候选池')
  })

  it('explains automatic variants and visible fallback reasons', () => {
    expect(today).toContain('在原题与变式间自动轮换')
    expect(today).not.toContain('变式优先')
    expect(today).not.toContain('仅原题')
    expect(practice).toContain('道题已安全回退原题')
    expect(practice).toContain('variantFallbackReason')
  })

  it('keeps the future workload in one accessible chart without calendar cards', () => {
    expect(today).toContain('className="today-forecast__tooltip"')
    expect(today).toContain('tabIndex={0}')
    expect(today).not.toContain('today-forecast__days')
    expect(today).not.toContain('today-forecast__day ')
  })
})

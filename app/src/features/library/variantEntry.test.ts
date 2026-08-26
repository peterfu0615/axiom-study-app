// @ts-expect-error Vitest executes this contract in Node, while the app tsconfig is browser-only.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const library = readFileSync(new URL('./ProblemLibrary.tsx', import.meta.url), 'utf8')
const today = readFileSync(new URL('../today/TodayWorkspace.tsx', import.meta.url), 'utf8')
const practice = readFileSync(new URL('../practice/PracticeSetView.tsx', import.meta.url), 'utf8')

describe('visible variant entry contract', () => {
  it('keeps variants as the final card on one detail page and opens a candidate dialog', () => {
    expect(library).not.toContain('错题详情视图')
    expect(library).toContain('className="problem-variant-summary-card"')
    expect(library).toContain('title="变式题"')
    expect(library).toContain('ariaLabel="已保存变式"')
    expect(library).toContain('listProblemVariantCandidates')
    expect(library).not.toContain('最后一项完成后会自动开始生成')
    expect(library).not.toContain('AI 题型：')
    expect(library).toContain('key={selected.id}')
    expect(library).toContain("if (item.candidate) return '已生成'")
    expect(library).toContain('savedVariantCount')
    expect(library).toContain('candidates.find((item) => Boolean(item.candidate))')
  })

  it('saves manual variants without starting a one-question practice route', () => {
    expect(library).toContain('只有点击生成按钮后才会开始')
    expect(library).not.toContain('createPracticeSetFromVariantPreview')
    expect(library).not.toContain('加入今日练习并开始')
    expect(library).not.toContain('refreshVariantPrerequisites')
    expect(library).not.toContain('type="range"')
    expect(library).not.toContain('实例指纹')
    expect(library).not.toContain('安全错误：')
  })

  it('explains automatic variants and visible fallback reasons', () => {
    expect(today).toContain('在原题与变式间自动轮换')
    expect(today).not.toContain('变式优先')
    expect(today).not.toContain('仅原题')
    expect(practice).toContain('道题已换用原题')
    expect(practice).toContain('variantFallbackReason')
  })

  it('keeps the future workload in one accessible chart without calendar cards', () => {
    expect(today).toContain('className="today-forecast__tooltip"')
    expect(today).toContain('tabIndex={0}')
    expect(today).not.toContain('today-forecast__days')
    expect(today).not.toContain('today-forecast__day ')
  })
})

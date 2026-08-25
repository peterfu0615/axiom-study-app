// @ts-expect-error Vitest executes this contract in Node, while the app tsconfig is browser-only.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./TodayWorkspace.tsx', import.meta.url), 'utf8')

describe('today practice preparation contract', () => {
  it('paints the preparation route before starting expensive generation', () => {
    const action = source.indexOf('const openTodayPractice')
    const paint = source.indexOf('setPreparation(optimistic)', action)
    const frame = source.indexOf('window.requestAnimationFrame', paint)
    const persistedJob = source.indexOf('createOrResumePracticePreparation', frame)
    expect(paint).toBeGreaterThan(0)
    expect(frame).toBeGreaterThan(paint)
    expect(persistedJob).toBeGreaterThan(frame)
    expect(source).toContain("status: 'selecting'")
    expect(source).toContain('runPreparation(snapshot, plan, todayPracticeSet)')
  })

  it('keeps one top-level practice action and removes per-topic generation menus', () => {
    expect(source.match(/生成今日练习/gu)).toHaveLength(1)
    expect(source).not.toContain('快速复习</MenuItem>')
    expect(source).not.toContain('模拟测试</MenuItem>')
    expect(source).not.toContain('生成练习</Button>')
  })

  it('renders expanded questions with math, media, and the reading typeface', () => {
    expect(source).toContain('<MathMarkdown className="today-unit__stem">')
    expect(source).toContain('mediaAssetUrl(imagePath)')
    const styles = readFileSync(new URL('./Today.css', import.meta.url), 'utf8')
    expect(styles).toContain('.today-unit__stem { font-family: var(--ax-font-reading);')
  })
})

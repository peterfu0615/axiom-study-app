// @ts-expect-error Vitest executes this contract in Node, while the app tsconfig is browser-only.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const library = readFileSync(new URL('./ProblemLibrary.tsx', import.meta.url), 'utf8')
const today = readFileSync(new URL('../today/TodayWorkspace.tsx', import.meta.url), 'utf8')
const practice = readFileSync(new URL('../practice/PracticeSetView.tsx', import.meta.url), 'utf8')

describe('visible variant entry contract', () => {
  it('keeps generation in the normal detail actions instead of edit mode', () => {
    const actions = library.indexOf('className="problem-detail-actions"')
    const editing = library.indexOf(") : editing ? (", actions)
    const normal = library.indexOf(") : (", editing + 1)
    const generate = library.indexOf('onClick={() => void generateSingleVariant()}', normal)
    expect(actions).toBeGreaterThan(-1)
    expect(editing).toBeGreaterThan(actions)
    expect(normal).toBeGreaterThan(editing)
    expect(generate).toBeGreaterThan(normal)
    expect(library.slice(editing, normal)).not.toContain('generateSingleVariant')
    expect(library).toContain('生成变式前还需：')
  })

  it('explains automatic variants and visible fallback reasons', () => {
    expect(today).toContain('生成练习时会优先创建并审校变式题')
    expect(practice).toContain('道题已安全回退原题')
    expect(practice).toContain('variantFallbackReason')
  })
})

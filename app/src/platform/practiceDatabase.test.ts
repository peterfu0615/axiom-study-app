// @ts-expect-error Vitest executes this contract in Node, while the app tsconfig is browser-only.
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { canonicalAnswerFromSolution, withinOptionalVariantBudget } from './practiceDatabase'

afterEach(() => vi.useRealTimers())

describe('practice database snapshots', () => {
  it('prefers explicit answers and safely derives legacy answers', () => {
    expect(canonicalAnswerFromSolution('{"final_answer":"x=2","contentMarkdown":"long"}')).toBe('x=2')
    expect(canonicalAnswerFromSolution('{"steps":[{"content_markdown":"第一步"},{"content_markdown":"x=3"}]}')).toBe('x=3')
    expect(canonicalAnswerFromSolution('invalid')).toBe('')
  })

  it('derives alternation only from confirmed evidence and retires completed sets', () => {
    const source = readFileSync(new URL('./practiceDatabase.ts', import.meta.url), 'utf8')
    expect(source).toContain('JOIN practice_evidences evidence')
    expect(source).toContain('lastConfirmedSourceType')
    expect(source).toContain('findReusablePracticeSetForSource')
    expect(source).toContain("sourcePolicy: options.forceVariant ? 'explicit-variant-v1' : 'alternating-v1'")
    expect(source).toContain('PARTITION BY item.problem_id')
    expect(source).not.toContain('PARTITION BY item.source_problem_id')
    expect(source).toContain('const optionalVariantDeadline = Date.now() + PRACTICE_VARIANT_WAIT_BUDGET_MS')
    expect(source).toContain('optionalVariantDeadline - Date.now()')
  })

  it('does not let an optional AI variant wait indefinitely', async () => {
    vi.useFakeTimers()
    const result = withinOptionalVariantBudget(new Promise<string>(() => undefined), 20)
    await vi.advanceTimersByTimeAsync(20)
    await expect(result).resolves.toBeNull()
  })
})

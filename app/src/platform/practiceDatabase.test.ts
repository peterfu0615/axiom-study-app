// @ts-expect-error Vitest executes this contract in Node, while the app tsconfig is browser-only.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { canonicalAnswerFromSolution } from './practiceDatabase'

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
  })
})

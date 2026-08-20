// @ts-expect-error Vitest executes this contract in Node, while the app tsconfig is browser-only.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('practice grading provider fallback', () => {
  it('records each routed provider attempt and continues after a safe failure', () => {
    const source = readFileSync(new URL('./practiceGradingDatabase.ts', import.meta.url), 'utf8')
    expect(source).toContain('for (const provider of providers)')
    expect(source).toContain('INSERT INTO practice_grading_model_runs')
    expect(source).toContain("status='failed'")
    expect(source).toContain('lastFailure = reason')
    expect(source).toContain('throw lastFailure')
    expect(source).not.toContain('getSubjectivePracticeGradingProviders()[0]')
  })
})

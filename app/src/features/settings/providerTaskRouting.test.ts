// @ts-expect-error Vitest executes this contract in Node, while the app tsconfig is browser-only.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('provider task routing settings', () => {
  it('only exposes task routes backed by a runtime selector', () => {
    const source = readFileSync(new URL('./AISettings.tsx', import.meta.url), 'utf8')
    expect(source).toContain("value: 'problem_understanding'")
    expect(source).toContain("value: 'variant_verification'")
    expect(source).toContain("value: 'submission_grading'")
    expect(source).not.toContain("value: 'solution_review'")
    expect(source).not.toContain("value: 'variant_planning'")
    expect(source).toContain("value: 'geometry_scene'")
  })
})

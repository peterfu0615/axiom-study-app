// @ts-expect-error Vitest executes this contract in Node, while the app tsconfig is browser-only.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('practice submission recovery UI', () => {
  const source = readFileSync(new URL('./PracticeSetView.tsx', import.meta.url), 'utf8')

  it('accepts ordered multi-file submission and exposes a manual page choice', () => {
    expect(source).toContain('multiple: true')
    expect(source).toContain("'manual_match'")
    expect(source).toContain('PracticeSubmissionMatchError')
    expect(source).toContain('resumeManualMatch')
    expect(source).toContain('manualMatch.pageOptions.map')
  })

  it('does not retry-import already persisted pages after a later page fails', () => {
    expect(source).toContain('submissions: reason.submissions')
    expect(source).toContain('const [failed, ...remaining] = manualMatch.submissions')
    expect(source).toContain('{ ...failed, practiceDocumentPageId }')
  })
})

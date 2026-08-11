import { describe, expect, it } from 'vitest'
import { canonicalAnswerFromSolution } from './practiceDatabase'

describe('practice database snapshots', () => {
  it('prefers explicit answers and safely derives legacy answers', () => {
    expect(canonicalAnswerFromSolution('{"final_answer":"x=2","contentMarkdown":"long"}')).toBe('x=2')
    expect(canonicalAnswerFromSolution('{"steps":[{"content_markdown":"第一步"},{"content_markdown":"x=3"}]}')).toBe('x=3')
    expect(canonicalAnswerFromSolution('invalid')).toBe('')
  })
})

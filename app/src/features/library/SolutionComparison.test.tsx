import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { SavedProblem, Solution, StudentAttempt } from '../../domain/models'
import { SolutionComparison } from './SolutionComparison'

const problem = {
  id: 'problem-1',
  cropImagePath: '/tmp/problem.jpg',
  subject: '数学',
  aiProblemType: '几何证明',
  stemMarkdown: '证明 $AB \\parallel CD$。',
  aiChoices: [],
  aiSubQuestions: [],
  knowledgePoints: ['平行线'],
} as unknown as SavedProblem

const solution: Solution = {
  id: 'solution-1',
  problemId: problem.id,
  contentMarkdown: String.raw`$$\because AB=CD\therefore AB\parallel CD$$`,
  steps: [
    {
      index: 1,
      title: '证明平行',
      contentMarkdown: String.raw`$$\therefore AB\parallel CD$$`,
    },
  ],
  keyMethod: '平行线判定',
  usedFormulas: [String.raw`AB\parallel CD`],
  knowledgePoints: ['平行线'],
  status: 'completed',
  activeModelRunId: 'run-1',
  errorMessage: null,
  createdAt: 1,
  updatedAt: 1,
}

const attempt: StudentAttempt = {
  id: 'attempt-1',
  problemId: problem.id,
  answerRegionIds: ['answer-1'],
  rawMarkdown: String.raw`由条件得 $AB\parallel CD$。`,
  steps: [
    {
      index: 1,
      contentMarkdown: String.raw`$AB\parallel CD$`,
      confidence: 0.9,
    },
  ],
  status: 'completed',
  activeModelRunId: 'run-2',
  errorMessage: null,
  createdAt: 1,
  updatedAt: 1,
}

describe('SolutionComparison', () => {
  it('renders a compact two-sided preview with normalized math', () => {
    const html = renderToStaticMarkup(
      <SolutionComparison
        attempt={attempt}
        problem={problem}
        reasoning={null}
        solution={solution}
      />,
    )
    expect(html).toContain('solution-comparison-preview')
    expect(html).toContain('正确解法')
    expect(html).toContain('我的解答')
    expect(html).toContain('class="katex"')
    expect(html).toContain('点击查看完整解答')
  })
})

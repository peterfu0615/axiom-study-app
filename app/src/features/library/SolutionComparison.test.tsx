import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
// @ts-expect-error Vitest executes this contract in Node, while the app tsconfig is browser-only.
import { readFileSync } from 'node:fs'
import type { SavedProblem, Solution, StudentAttempt } from '../../domain/models'
import { SolutionComparison } from './SolutionComparison'
import { normalizeKeyPoint } from './explanationText'

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
    expect(html).toContain('class="ax-button ax-button--secondary comparison-open-action"')
    expect(html).toContain('查看完整解答')
    expect(html).not.toContain('role="button"')
  })

  it('uses the shared icon control for the modal close action', () => {
    const source = readFileSync(new URL('./SolutionComparison.tsx', import.meta.url), 'utf8')
    expect(source).toMatch(/<IconButton label="关闭解答窗口"[^>]*>[\s\S]*?<Icon name="close" size=\{20\}/u)
    expect(source).not.toMatch(/aria-label="关闭解答窗口"[^>]*>\s*×\s*<\/button>/u)
  })
})

describe('normalizeKeyPoint', () => {
  it('keeps plain key points unchanged (real DB form)', () => {
    expect(normalizeKeyPoint('用待定系数法求一次函数表达式')).toBe('用待定系数法求一次函数表达式')
  })

  it('strips self-added markdown stars', () => {
    expect(normalizeKeyPoint('**用待定系数法求一次函数表达式**')).toBe('用待定系数法求一次函数表达式')
  })

  it('strips double-escaped stars', () => {
    expect(normalizeKeyPoint(String.raw`\*\*用待定系数法\*\*`)).toBe('用待定系数法')
  })

  it('strips surrounding whitespace and mixed star/backslash noise', () => {
    expect(normalizeKeyPoint('  ** 关键点内容 **  ')).toBe('关键点内容')
  })

  it('returns empty for star-only output so the row is hidden', () => {
    expect(normalizeKeyPoint('****')).toBe('')
    expect(normalizeKeyPoint('   ')).toBe('')
  })
})

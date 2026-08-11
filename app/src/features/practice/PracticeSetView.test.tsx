import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { PracticeSet } from '../../domain/practice'
import { PracticeSetView } from './PracticeSetView'

const practiceSet: PracticeSet = {
  id: 'set-1', subject: '数学', sourceType: 'review_unit', sourceRef: 'module-1',
  strategy: 'deterministic-v1', status: 'ready',
  targetSkills: [{ id: 'tag-1', name: '一次方程', type: 'knowledge', state: null }],
  generationMetadata: {}, createdAt: 1, updatedAt: 1,
  items: [{
    id: 'item-1', practiceSetId: 'set-1', orderIndex: 0, sourceType: 'existing_problem',
    sourceProblemId: 'problem-1', subject: '数学', targetSkillBundleId: 'bundle-1',
    targetTags: [], difficulty: 'basic', statementMarkdown: '求 $x+1=3$ 的解。', options: null,
    canonicalAnswer: 'x=2', solutionJson: '{"contentMarkdown":"移项可得 $x=2$。"}',
    gradingRubric: { criteria: ['答案正确'], maxScore: 100 }, diagramIds: [], questionImagePath: null, diagramImagePaths: [],
    generationMetadata: null, validationStatus: 'valid', createdAt: 1,
  }],
}

describe('PracticeSetView', () => {
  it('previews target, statement, difficulty and durable status without revealing the answer', () => {
    const html = renderToStaticMarkup(<PracticeSetView onBack={() => {}} practiceSet={practiceSet} />)
    expect(html).toContain('一次方程')
    expect(html).toContain('基础')
    expect(html).toContain('求 ')
    expect(html).toContain('已保存')
    expect(html).not.toContain('x=2')
  })
})

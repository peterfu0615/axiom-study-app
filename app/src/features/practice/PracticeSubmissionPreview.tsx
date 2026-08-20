import type { PracticeSet } from '../../domain/practice'
import { PracticeSetView } from './PracticeSetView'

const previewSet: PracticeSet = {
  id: 'submission-preview',
  subject: '数学',
  sourceType: 'review_unit',
  sourceRef: 'preview-module',
  strategy: 'preview',
  status: 'ready',
  targetSkills: [{ id: 'tag-equation', name: '一次方程', type: 'knowledge', state: null }],
  generationMetadata: {},
  createdAt: 1,
  updatedAt: 1,
  items: [0, 1].map((orderIndex) => ({
    id: `preview-item-${orderIndex + 1}`,
    practiceSetId: 'submission-preview',
    orderIndex,
    sourceType: 'existing_problem',
    sourceProblemId: `preview-problem-${orderIndex + 1}`,
    subject: '数学',
    targetSkillBundleId: null,
    targetTags: [],
    difficulty: 'basic',
    statementMarkdown: `练习题 ${orderIndex + 1}`,
    options: null,
    canonicalAnswer: String(orderIndex + 1),
    solutionJson: '{}',
    gradingRubric: { criteria: ['答案正确'], maxScore: 100 },
    diagramIds: [],
    questionImagePath: null,
    diagramImagePaths: [],
    generationMetadata: null,
    validationStatus: 'valid',
    createdAt: 1,
  })),
}

export function PracticeSubmissionPreview() {
  return <PracticeSetView initialMode="submit" onBack={() => undefined} practiceSet={previewSet} />
}

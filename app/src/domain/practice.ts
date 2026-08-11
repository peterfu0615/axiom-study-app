import type { DifficultyLevel } from './models'
import type { ReviewSkillState, ReviewTag } from './review'

export const PRACTICE_PLANNER_VERSION = 'deterministic-v1'

export type PracticeSourceType = 'review_unit' | 'skill' | 'today' | 'practice_attempt'
export type PracticeItemSourceType = 'existing_problem' | 'generated_variant'
export type PracticeSetStatus = 'draft' | 'ready' | 'archived'

export interface PracticeTargetSkill {
  id: string
  name: string
  type: 'knowledge' | 'method' | 'model'
  state: ReviewSkillState | null
}

export interface PracticeProblemCandidate {
  problemId: string
  subject: string
  statementMarkdown: string
  solutionJson: string
  canonicalAnswer: string
  options: string[] | null
  targetTags: ReviewTag[]
  diagramIds: string[]
  questionImagePath: string | null
  diagramImagePaths: string[]
  originalDifficulty: DifficultyLevel
  relevance: number
}

export interface PracticePlannerInput {
  sourceType: PracticeSourceType
  sourceRef: string
  subject: string
  targetSkills: PracticeTargetSkill[]
  relatedProblems: PracticeProblemCandidate[]
  recentFailureCount: number
  desiredBudget: number
  excludedProblemIds?: string[]
  preferredErrorCategories?: string[]
}

export interface PracticeBlueprintItem {
  sourceType: 'existing_problem'
  problem: PracticeProblemCandidate
  difficulty: DifficultyLevel
}

export interface PracticeBlueprint {
  plannerVersion: typeof PRACTICE_PLANNER_VERSION
  masteryBand: 'weak' | 'consolidating' | 'stable'
  requestedBudget: number
  items: PracticeBlueprintItem[]
  warnings: string[]
}

export interface PracticeItem {
  id: string
  practiceSetId: string
  orderIndex: number
  sourceType: PracticeItemSourceType
  sourceProblemId: string | null
  subject: string
  targetSkillBundleId: string | null
  targetTags: ReviewTag[]
  difficulty: DifficultyLevel
  statementMarkdown: string
  options: string[] | null
  canonicalAnswer: string
  solutionJson: string
  gradingRubric: { criteria: string[]; maxScore: number }
  diagramIds: string[]
  questionImagePath: string | null
  diagramImagePaths: string[]
  generationMetadata: Record<string, unknown> | null
  validationStatus: 'valid' | 'invalid'
  createdAt: number
}

export interface PracticeSet {
  id: string
  subject: string
  sourceType: PracticeSourceType
  sourceRef: string
  strategy: string
  status: PracticeSetStatus
  targetSkills: PracticeTargetSkill[]
  generationMetadata: Record<string, unknown>
  createdAt: number
  updatedAt: number
  items: PracticeItem[]
}

const difficultyPlan: Record<PracticeBlueprint['masteryBand'], DifficultyLevel[]> = {
  weak: ['basic', 'basic', 'intermediate'],
  consolidating: ['basic', 'intermediate', 'intermediate'],
  stable: ['intermediate', 'intermediate', 'advanced'],
}

function masteryBand(targets: PracticeTargetSkill[], recentFailureCount: number): PracticeBlueprint['masteryBand'] {
  const states = targets.flatMap((target) => target.state ? [target.state] : [])
  if (!states.length || recentFailureCount >= 2) return 'weak'
  const mastery = states.reduce((sum, state) => sum + state.masteryEstimate, 0) / states.length
  const uncertainty = states.reduce((sum, state) => sum + state.uncertainty, 0) / states.length
  if (mastery < .45 || uncertainty > .72) return 'weak'
  if (mastery < .78 || uncertainty > .35) return 'consolidating'
  return 'stable'
}

export function buildPracticeBlueprint(input: PracticePlannerInput): PracticeBlueprint {
  const band = masteryBand(input.targetSkills, input.recentFailureCount)
  const budget = Math.max(1, Math.min(12, Math.floor(input.desiredBudget)))
  const seen = new Set<string>()
  const excluded = new Set(input.excludedProblemIds ?? [])
  const preferredErrors = new Set(input.preferredErrorCategories ?? [])
  const candidates = [...input.relatedProblems]
    .filter((candidate) => candidate.subject === input.subject && !excluded.has(candidate.problemId) && validatePracticeCandidate(candidate).length === 0)
    .sort((left, right) => {
      const leftErrorMatch = left.targetTags.some((tag) => tag.type === 'error' && preferredErrors.has(tag.id ?? tag.name)) ? 1 : 0
      const rightErrorMatch = right.targetTags.some((tag) => tag.type === 'error' && preferredErrors.has(tag.id ?? tag.name)) ? 1 : 0
      return rightErrorMatch - leftErrorMatch || right.relevance - left.relevance || left.problemId.localeCompare(right.problemId)
    })
    .filter((candidate) => !seen.has(candidate.problemId) && Boolean(seen.add(candidate.problemId)))
  const warnings: string[] = []
  if (candidates.length < budget) warnings.push(`仅找到 ${candidates.length} 道已验证且不重复的关联题，未用无效占位题补足。`)
  const plan = difficultyPlan[band]
  return {
    plannerVersion: PRACTICE_PLANNER_VERSION,
    masteryBand: band,
    requestedBudget: budget,
    items: candidates.slice(0, budget).map((problem, index) => ({
      sourceType: 'existing_problem',
      problem,
      difficulty: plan[index % plan.length],
    })),
    warnings,
  }
}

export function validatePracticeCandidate(candidate: PracticeProblemCandidate) {
  const errors: string[] = []
  if (!candidate.statementMarkdown.trim()) errors.push('statement_empty')
  if (!candidate.canonicalAnswer.trim()) errors.push('answer_empty')
  try {
    const solution = JSON.parse(candidate.solutionJson) as { contentMarkdown?: unknown; content_markdown?: unknown; steps?: unknown }
    const hasContent = typeof solution?.contentMarkdown === 'string' && solution.contentMarkdown.trim() ||
      typeof solution?.content_markdown === 'string' && solution.content_markdown.trim() ||
      Array.isArray(solution?.steps) && solution.steps.length > 0
    if (!solution || typeof solution !== 'object' || !hasContent) errors.push('solution_invalid')
  } catch { errors.push('solution_invalid') }
  if (!['basic', 'intermediate', 'advanced'].includes(candidate.originalDifficulty)) errors.push('difficulty_invalid')
  if (candidate.options) {
    const options = candidate.options.map((option) => option.trim()).filter(Boolean)
    if (options.length < 2 || new Set(options).size !== options.length) errors.push('options_invalid')
    if (!options.includes(candidate.canonicalAnswer.trim())) errors.push('answer_not_in_options')
  }
  return errors
}

export function validateGeneratedPracticeItem(input: {
  statementMarkdown: string
  canonicalAnswer: string
  solutionJson: string
  difficulty: string
  options: string[] | null
  targetTagIds: string[]
  expectedTargetTagIds: string[]
  diagramStatus?: 'rendered' | 'failed'
}) {
  const candidate: PracticeProblemCandidate = {
    problemId: 'generated-validation', subject: 'generated', relevance: 1,
    statementMarkdown: input.statementMarkdown, canonicalAnswer: input.canonicalAnswer,
    solutionJson: input.solutionJson, originalDifficulty: input.difficulty as DifficultyLevel,
    options: input.options, targetTags: [], diagramIds: [], questionImagePath: null, diagramImagePaths: [],
  }
  const errors = validatePracticeCandidate(candidate)
  const actual = new Set(input.targetTagIds)
  if (input.expectedTargetTagIds.some((tag) => !actual.has(tag))) errors.push('target_mismatch')
  if (input.diagramStatus === 'failed') errors.push('diagram_failed')
  return [...new Set(errors)]
}

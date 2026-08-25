import type { DifficultyLevel } from './models'
import type { PracticeProblemCandidate } from './practice'
import { mathematicallyEquivalent } from './practiceGrading'
import type { ReviewTag } from './review'
import type { GeometryScene } from './geometryScene'
import { normalizeGeometryScene } from './geometryScene'

export const VARIANT_PROMPT_VERSION = 'variant-practice-v2'
export const VARIANT_SCHEMA_VERSION = 'variant-practice-v2'
export type VariantLevel = 'numeric' | 'condition' | 'rebuild'

export type VariantChangeKind =
  | 'numeric_values'
  | 'symbols_or_names'
  | 'narrative_order'
  | 'real_world_context'
  | 'diagram_orientation'
  | 'nonessential_distractor'
  | 'known_condition'

export type VariantPlanStatus = 'planned' | 'generating' | 'verified' | 'rejected' | 'failed' | 'superseded'

export interface VariantPlanInvariant {
  subject: string
  sourceProblemId: string
  targetKnowledgeTagIds: string[]
  targetMethodTagIds: string[]
  targetModelTagIds: string[]
  targetDifficulty: DifficultyLevel
  variationLevel: VariantLevel
  requiredSteps: string[]
  diagramPolicy: 'none' | 'preserve_or_regenerate'
}

export interface PracticeVariantPlan {
  id: string
  subject: string
  sourceProblemId: string
  skillBundleId: string | null
  targetTags: ReviewTag[]
  targetDifficulty: DifficultyLevel
  variationLevel: VariantLevel
  invariants: VariantPlanInvariant
  allowedChanges: VariantChangeKind[]
  forbiddenChanges: string[]
  sourceInputHash: string
  promptVersion: typeof VARIANT_PROMPT_VERSION
  schemaVersion: typeof VARIANT_SCHEMA_VERSION
  createdAt: number
}

export interface PracticeVariantCandidate {
  subject: string
  statementMarkdown: string
  options: string[] | null
  canonicalAnswer: string
  solutionJson: string
  difficulty: DifficultyLevel
  targetTagIds: string[]
  changes: Array<{ kind: VariantChangeKind; summary: string }>
  diagramPolicy: 'none' | 'preserved' | 'generated'
  geometryScene?: GeometryScene | null
}

export interface PracticeVariantVerification {
  independentAnswer: string
  independentSolutionJson: string
  conditionComplete: boolean
  uniqueAnswer: boolean
  preservesCoreKnowledge: boolean
  preservesCoreMethod: boolean
  preservesCoreModel: boolean
  targetTagIds: string[]
  difficulty: DifficultyLevel
  diagramCompatible: boolean
  usesOutOfScopeKnowledge: boolean
  requiredStepCoverage: Array<{ step: string; covered: boolean; evidence: string }>
  notes: string[]
}

export interface PracticeVariantGenerationInput {
  plan: PracticeVariantPlan
  source: {
    statementMarkdown: string
    options: string[] | null
    canonicalAnswer: string
    solutionJson: string
    questionImagePath: string | null
    diagramImagePaths: string[]
  }
}

export interface PracticeVariantVerificationInput {
  plan: PracticeVariantPlan
  candidate: PracticeVariantCandidate
}

const allowedChangesByLevel: Record<VariantLevel, VariantChangeKind[]> = {
  numeric: ['numeric_values', 'symbols_or_names', 'nonessential_distractor'],
  condition: ['numeric_values', 'symbols_or_names', 'known_condition', 'narrative_order'],
  rebuild: ['numeric_values', 'symbols_or_names', 'narrative_order', 'real_world_context', 'diagram_orientation', 'nonessential_distractor', 'known_condition'],
}

const forbiddenChanges = [
  'swap_condition_and_conclusion', 'inverse_proposition', 'remove_required_method',
  'introduce_different_shortcut', 'change_diagram_topology', 'out_of_scope_content',
  'change_unique_answer_to_multiple_or_none',
]

function solutionSteps(solutionJson: string) {
  try {
    const value = JSON.parse(solutionJson) as {
      steps?: Array<{ content?: unknown; contentMarkdown?: unknown; content_markdown?: unknown }>
    }
    return (value.steps ?? []).flatMap((step) => {
      const content = step.content ?? step.contentMarkdown ?? step.content_markdown
      return typeof content === 'string' && content.trim() ? [content.trim()] : []
    }).slice(0, 8)
  } catch { return [] }
}

function stableInputHash(value: string) {
  let hash = 2166136261
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 16777619)
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`
}

export function createPracticeVariantPlan(input: {
  id: string
  source: PracticeProblemCandidate
  targetDifficulty: DifficultyLevel
  variationLevel?: VariantLevel
  createdAt?: number
}): PracticeVariantPlan {
  const targetTags = input.source.targetTags.filter((tag) => tag.type !== 'error' && Boolean(tag.id))
  const tagIds = (type: ReviewTag['type']) => targetTags.filter((tag) => tag.type === type).map((tag) => tag.id!).sort()
  const invariants: VariantPlanInvariant = {
    subject: input.source.subject,
    sourceProblemId: input.source.problemId,
    targetKnowledgeTagIds: tagIds('knowledge'),
    targetMethodTagIds: tagIds('method'),
    targetModelTagIds: tagIds('model'),
    targetDifficulty: input.targetDifficulty,
    variationLevel: input.variationLevel ?? 'numeric',
    requiredSteps: solutionSteps(input.source.solutionJson),
    diagramPolicy: input.source.diagramImagePaths.length || input.source.diagramIds.length ? 'preserve_or_regenerate' : 'none',
  }
  const variationLevel = input.variationLevel ?? 'numeric'
  return {
    id: input.id,
    subject: input.source.subject,
    sourceProblemId: input.source.problemId,
    skillBundleId: input.source.targetSkillBundleId ?? null,
    targetTags,
    targetDifficulty: input.targetDifficulty,
    variationLevel,
    invariants,
    allowedChanges: allowedChangesByLevel[variationLevel],
    forbiddenChanges,
    sourceInputHash: stableInputHash(JSON.stringify({
      statement: input.source.statementMarkdown,
      answer: input.source.canonicalAnswer,
      solution: input.source.solutionJson,
      variationLevel,
      invariants,
    })),
    promptVersion: VARIANT_PROMPT_VERSION,
    schemaVersion: VARIANT_SCHEMA_VERSION,
    createdAt: input.createdAt ?? Date.now(),
  }
}

export function variantPlanEligibilityErrors(plan: PracticeVariantPlan) {
  const errors: string[] = []
  if (!plan.sourceProblemId) errors.push('missing_source_problem')
  return errors
}

function normalizedSurface(value: string) {
  return value.toLowerCase().replace(/[\s，。；：、,.!?！？;:()（）]/gu, '')
}

function sameAnswer(left: string, right: string) {
  const leftFinal = left.split('=').at(-1)?.trim() ?? left
  const rightFinal = right.split('=').at(-1)?.trim() ?? right
  return mathematicallyEquivalent(left, right)
    || mathematicallyEquivalent(leftFinal, rightFinal)
    || normalizedSurface(left) === normalizedSurface(right)
}

export function validatePracticeVariant(
  plan: PracticeVariantPlan,
  source: PracticeProblemCandidate,
  candidate: PracticeVariantCandidate,
  verification: PracticeVariantVerification,
) {
  const errors: string[] = []
  if (plan.subject !== '综合' && candidate.subject !== plan.subject) errors.push('subject_changed')
  if (!candidate.statementMarkdown.trim()) errors.push('statement_empty')
  if (normalizedSurface(candidate.statementMarkdown) === normalizedSurface(source.statementMarkdown)) errors.push('surface_unchanged')
  if (!candidate.canonicalAnswer.trim()) errors.push('answer_empty')
  try {
    const solution = JSON.parse(candidate.solutionJson) as { contentMarkdown?: unknown; steps?: unknown }
    if (!(typeof solution.contentMarkdown === 'string' && solution.contentMarkdown.trim())
      && !(Array.isArray(solution.steps) && solution.steps.length)) errors.push('solution_invalid')
  } catch { errors.push('solution_invalid') }
  if (candidate.difficulty !== plan.targetDifficulty || verification.difficulty !== plan.targetDifficulty) errors.push('difficulty_mismatch')
  const expectedTags = new Set(plan.targetTags.flatMap((tag) => tag.id ? [tag.id] : []))
  const candidateTags = new Set(candidate.targetTagIds)
  const verifiedTags = new Set(verification.targetTagIds)
  if (expectedTags.size) {
    if ([...expectedTags].some((tag) => !candidateTags.has(tag) || !verifiedTags.has(tag))) errors.push('target_mismatch')
    if ([...candidateTags].some((tag) => !expectedTags.has(tag)) || [...verifiedTags].some((tag) => !expectedTags.has(tag))) errors.push('unexpected_target')
  }
  if (!candidate.changes.length || candidate.changes.some((change) => !plan.allowedChanges.includes(change.kind))) errors.push('change_not_allowed')
  if (!sameAnswer(candidate.canonicalAnswer, verification.independentAnswer)) errors.push('independent_answer_mismatch')
  if (!verification.conditionComplete) errors.push('condition_incomplete')
  if (!verification.uniqueAnswer) errors.push('answer_not_unique')
  if (!verification.preservesCoreKnowledge) errors.push('knowledge_changed')
  if (!verification.preservesCoreMethod) errors.push('method_changed')
  if (!verification.preservesCoreModel) errors.push('model_changed')
  if (verification.usesOutOfScopeKnowledge) errors.push('out_of_scope')
  const coveredSteps = new Map(verification.requiredStepCoverage.map((item) => [normalizedSurface(item.step), item]))
  if (plan.invariants.requiredSteps.some((step) => {
    const coverage = coveredSteps.get(normalizedSurface(step))
    return !coverage?.covered || !coverage.evidence.trim()
  })) errors.push('required_steps_missing')
  if (!verification.diagramCompatible) errors.push('diagram_incompatible')
  if (plan.invariants.diagramPolicy === 'none' && candidate.diagramPolicy !== 'none') errors.push('diagram_policy_changed')
  if (plan.invariants.diagramPolicy !== 'none' && candidate.diagramPolicy === 'none') errors.push('diagram_policy_changed')
  if (candidate.changes.some((change) => change.kind === 'diagram_orientation') && candidate.diagramPolicy !== 'generated') {
    errors.push('diagram_regeneration_required')
  }
  if (candidate.diagramPolicy === 'generated' && (!candidate.geometryScene || !normalizeGeometryScene(candidate.geometryScene).valid)) {
    errors.push('geometry_scene_invalid')
  }
  if (candidate.options) {
    const options = candidate.options.map((option) => option.trim()).filter(Boolean)
    if (options.length < 2 || new Set(options).size !== options.length) errors.push('options_invalid')
    if (!options.includes(candidate.canonicalAnswer.trim())) errors.push('answer_not_in_options')
  }
  return [...new Set(errors)]
}

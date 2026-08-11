import { invoke } from '@tauri-apps/api/core'
import {
  PRACTICE_PLANNER_VERSION,
  buildPracticeBlueprint,
  type PracticeItem,
  type PracticePlannerInput,
  type PracticeProblemCandidate,
  type PracticeSet,
  type PracticeSourceType,
  type PracticeTargetSkill,
} from '../domain/practice'
import type { DifficultyLevel } from '../domain/models'
import type { ReviewSkillState, ReviewTag } from '../domain/review'
import { initialReviewSkillState } from '../domain/review'
import { withTransactionLock } from './transactionLock'

interface ExecuteResult { rowsAffected: number; lastInsertId: number }
const execute = (sql: string, params: unknown[] = []) => invoke<ExecuteResult>('db_execute', { sql, params })
const select = <T>(sql: string, params: unknown[] = []) => invoke<T>('db_select', { sql, params })
const uuid = () => crypto.randomUUID()
const numeric = (value: unknown, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback
const parseJSON = <T>(value: unknown, fallback: T): T => {
  if (typeof value !== 'string' || !value.trim()) return fallback
  try { return JSON.parse(value) as T } catch { return fallback }
}

export function canonicalAnswerFromSolution(solutionJson: string) {
  const solution = parseJSON<{
    canonicalAnswer?: string
    finalAnswer?: string
    final_answer?: string
    contentMarkdown?: string
    content_markdown?: string
    steps?: Array<{ content?: string; contentMarkdown?: string; content_markdown?: string }>
  }>(solutionJson, {})
  const explicit = solution.canonicalAnswer ?? solution.finalAnswer ?? solution.final_answer
  if (explicit?.trim()) return explicit.trim()
  const lastStep = solution.steps?.at(-1)
  return (lastStep?.content ?? lastStep?.contentMarkdown ?? lastStep?.content_markdown ??
    solution.contentMarkdown ?? solution.content_markdown ?? '').trim()
}

interface SetRow {
  id: string; subject: string; source_type: PracticeSourceType; source_ref: string
  strategy: string; status: PracticeSet['status']; target_skills_json: string
  generation_metadata_json: string; created_at: number; updated_at: number
}
interface ItemRow {
  id: string; practice_set_id: string; order_index: number; source_type: PracticeItem['sourceType']
  source_problem_id: string | null; subject: string; target_skill_bundle_id: string | null
  target_tags_json: string; difficulty: DifficultyLevel; statement_markdown: string
  options_json: string | null; canonical_answer: string; solution_json: string
  grading_rubric_json: string; generation_metadata_json: string | null
  validation_status: PracticeItem['validationStatus']; created_at: number
}

async function readPracticeSetById(id: string): Promise<PracticeSet | null> {
  const set = (await select<SetRow[]>('SELECT * FROM practice_sets WHERE id=$1 LIMIT 1', [id]))[0]
  if (!set) return null
  const items = await select<ItemRow[]>('SELECT * FROM practice_items WHERE practice_set_id=$1 ORDER BY order_index, id', [id])
  return {
    id: set.id, subject: set.subject, sourceType: set.source_type, sourceRef: set.source_ref,
    strategy: set.strategy, status: set.status,
    targetSkills: parseJSON(set.target_skills_json, []),
    generationMetadata: parseJSON(set.generation_metadata_json, {}),
    createdAt: numeric(set.created_at), updatedAt: numeric(set.updated_at),
    items: items.map((row) => {
      const metadata = parseJSON<Record<string, unknown> | null>(row.generation_metadata_json, null)
      return {
        id: row.id, practiceSetId: row.practice_set_id, orderIndex: numeric(row.order_index),
        sourceType: row.source_type, sourceProblemId: row.source_problem_id, subject: row.subject,
        targetSkillBundleId: row.target_skill_bundle_id, targetTags: parseJSON(row.target_tags_json, []),
        difficulty: row.difficulty, statementMarkdown: row.statement_markdown,
        options: parseJSON<string[] | null>(row.options_json, null), canonicalAnswer: row.canonical_answer,
        solutionJson: row.solution_json, gradingRubric: parseJSON(row.grading_rubric_json, { criteria: [], maxScore: 100 }),
        diagramIds: Array.isArray(metadata?.diagramIds) ? metadata.diagramIds.filter((value): value is string => typeof value === 'string') : [],
        questionImagePath: typeof metadata?.questionImagePath === 'string' ? metadata.questionImagePath : null,
        diagramImagePaths: Array.isArray(metadata?.diagramImagePaths) ? metadata.diagramImagePaths.filter((value): value is string => typeof value === 'string') : [],
        generationMetadata: metadata, validationStatus: row.validation_status, createdAt: numeric(row.created_at),
      }
    }),
  }
}

export function getPracticeSet(id: string) {
  return readPracticeSetById(id)
}

export async function findPracticeSetForSource(sourceType: PracticeSourceType, sourceRef: string) {
  const row = (await select<Array<{ id: string }>>(
    "SELECT id FROM practice_sets WHERE source_type=$1 AND source_ref=$2 AND status='ready' ORDER BY created_at DESC LIMIT 1",
    [sourceType, sourceRef],
  ))[0]
  return row ? readPracticeSetById(row.id) : null
}

export async function createPracticeSet(input: PracticePlannerInput): Promise<PracticeSet> {
  const blueprint = buildPracticeBlueprint(input)
  if (!blueprint.items.length) throw new Error('没有带有效题干、答案和解法的关联题，无法创建练习集')
  return withTransactionLock(async () => {
    await execute('BEGIN IMMEDIATE')
    try {
      const existing = await findPracticeSetForSource(input.sourceType, input.sourceRef)
      if (existing) { await execute('COMMIT'); return existing }
      const now = Date.now()
      const setId = uuid()
      await execute(`INSERT INTO practice_sets(
        id, subject, source_type, source_ref, strategy, status, target_skills_json,
        generation_metadata_json, created_at, updated_at
      ) VALUES($1,$2,$3,$4,$5,'ready',$6,$7,$8,$8)`, [
        setId, input.subject, input.sourceType, input.sourceRef, PRACTICE_PLANNER_VERSION,
        JSON.stringify(input.targetSkills), JSON.stringify({
          plannerVersion: blueprint.plannerVersion, masteryBand: blueprint.masteryBand,
          requestedBudget: blueprint.requestedBudget, warnings: blueprint.warnings,
        }), now,
      ])
      for (const [index, planned] of blueprint.items.entries()) {
        const problem = planned.problem
        await execute(`INSERT INTO practice_items(
          id, practice_set_id, order_index, source_type, source_problem_id, subject,
          target_skill_bundle_id, target_tags_json, difficulty, statement_markdown,
          options_json, canonical_answer, solution_json, grading_rubric_json,
          generation_metadata_json, validation_status, created_at
        ) VALUES($1,$2,$3,'existing_problem',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'valid',$15)`, [
          uuid(), setId, index, problem.problemId, input.subject,
          input.targetSkills[0]?.id.startsWith('bundle:') ? input.targetSkills[0].id.slice(7) : null,
          JSON.stringify(problem.targetTags), planned.difficulty, problem.statementMarkdown,
          problem.options ? JSON.stringify(problem.options) : null, problem.canonicalAnswer,
          problem.solutionJson, JSON.stringify({ criteria: ['答案正确', '关键步骤完整', '表达清晰'], maxScore: 100 }),
          JSON.stringify({ diagramIds: problem.diagramIds, questionImagePath: problem.questionImagePath, diagramImagePaths: problem.diagramImagePaths }), now,
        ])
      }
      await execute('COMMIT')
      const created = await readPracticeSetById(setId)
      if (!created) throw new Error('练习集保存后无法读取')
      return created
    } catch (error) {
      try { await execute('ROLLBACK') } catch { /* original error wins */ }
      throw error
    }
  })
}

interface ReviewPracticeContextRow {
  module_id: string; session_id: string; subject: string; skill_bundle_id: string
  source_problem_id: string; stem_markdown: string; solution_json: string
  structured_content_json: string; target_tags_json: string; target_difficulty: DifficultyLevel
}
interface RelatedProblemRow {
  problem_id: string; subject: string; stem_markdown: string; structured_content_json: string
  solution_content: string | null; solution_steps_json: string | null
  difficulty: DifficultyLevel | null; similarity_score: number
  question_image_path: string | null; diagram_image_path: string | null
}
interface SkillStateRow extends Partial<ReviewSkillState> { tag_id: string }

function optionsFromStructured(value: string) {
  const parsed = parseJSON<{ options?: unknown[] }>(value, {})
  const options = parsed.options?.map((option) => typeof option === 'string' ? option :
    typeof option === 'object' && option ? String((option as { text?: unknown }).text ?? '') : '').filter(Boolean)
  return options?.length ? options : null
}

async function plannerInputForReviewModule(moduleId: string, sourceType: 'review_unit' | 'today', budget: number): Promise<PracticePlannerInput> {
  const context = (await select<ReviewPracticeContextRow[]>(`
    SELECT module.id AS module_id, module.session_id, module.subject, module.skill_bundle_id,
      instance.source_problem_id, instance.stem_markdown, instance.solution_json,
      instance.structured_content_json, instance.target_tags_json, module.target_difficulty
    FROM review_modules module JOIN question_instances instance ON instance.review_module_id=module.id
    WHERE module.id=$1 LIMIT 1`, [moduleId]))[0]
  if (!context) throw new Error('找不到用于创建练习的 Review Unit')
  const snapshot = parseJSON<{ title?: string; tags?: ReviewTag[] }>(context.target_tags_json, {})
  const tags = (snapshot.tags ?? []).filter((tag) => tag.type !== 'error')
  const persistedTags = tags.filter((tag): tag is ReviewTag & { id: string } => Boolean(tag.id))
  const stateRows = persistedTags.length ? await select<SkillStateRow[]>(
    `SELECT tag_id, mastery_estimate AS masteryEstimate, stability, retrievability,
      evidence_count AS evidenceCount, success_count AS successCount,
      failure_count AS failureCount, transfer_score AS transferScore,
      max_stable_difficulty AS maxStableDifficulty, last_practiced_at AS lastPracticedAt,
      next_review_at AS nextReviewAt, uncertainty FROM skill_states WHERE tag_id IN (${persistedTags.map((_, index) => `$${index + 1}`).join(',')})`,
    persistedTags.map((tag) => tag.id),
  ) : []
  const states = new Map(stateRows.map((row) => [row.tag_id, { ...initialReviewSkillState(), ...row } as ReviewSkillState]))
  const targets: PracticeTargetSkill[] = [
    { id: `bundle:${context.skill_bundle_id}`, name: snapshot.title?.trim() || '当前能力组合', type: 'model', state: null },
    ...tags.flatMap((tag) => tag.id ? [{ id: tag.id, name: tag.name, type: tag.type as PracticeTargetSkill['type'], state: states.get(tag.id) ?? null }] : []),
  ]
  const related = await select<RelatedProblemRow[]>(`
    SELECT problem.id AS problem_id, context.subject, COALESCE(NULLIF(problem.user_stem_markdown,''), NULLIF(problem.ai_stem_markdown,''), NULLIF(problem.stem_markdown,''), '') AS stem_markdown,
      COALESCE(problem.structured_content_json, '{}') AS structured_content_json,
      solution.content_markdown AS solution_content, solution.steps_json AS solution_steps_json,
      difficulty.level AS difficulty, link.similarity_score, problem.crop_image_path AS question_image_path,
      COALESCE((SELECT region.image_path FROM problem_regions region
        WHERE region.problem_id=problem.id AND region.region_type='diagram' AND region.image_path IS NOT NULL
        ORDER BY CASE region.source WHEN 'manual' THEN 0 ELSE 1 END, region.updated_at DESC LIMIT 1
      ), problem.ai_diagram_image_path) AS diagram_image_path
    FROM skill_bundle_problems link JOIN problems problem ON problem.id=link.problem_id
    LEFT JOIN problem_solutions solution ON solution.problem_id=problem.id AND solution.status='completed'
    LEFT JOIN problem_difficulties difficulty ON difficulty.problem_id=problem.id
    CROSS JOIN (SELECT $1 AS subject) context
    WHERE link.skill_bundle_id=$2 ORDER BY link.similarity_score DESC, problem.id`, [context.subject, context.skill_bundle_id])
  const candidates: PracticeProblemCandidate[] = related.map((row) => {
    const solutionJson = JSON.stringify({ contentMarkdown: row.solution_content ?? '', steps: parseJSON(row.solution_steps_json, []) })
    return {
      problemId: row.problem_id, subject: row.subject, statementMarkdown: row.stem_markdown,
      solutionJson, canonicalAnswer: canonicalAnswerFromSolution(solutionJson),
      options: optionsFromStructured(row.structured_content_json), targetTags: tags, diagramIds: [],
      questionImagePath: row.question_image_path, diagramImagePaths: row.diagram_image_path ? [row.diagram_image_path] : [],
      originalDifficulty: row.difficulty ?? context.target_difficulty, relevance: numeric(row.similarity_score, 1),
    }
  })
  return {
    sourceType, sourceRef: context.module_id,
    subject: context.subject, targetSkills: targets, relatedProblems: candidates,
    recentFailureCount: 0, desiredBudget: budget,
  }
}

export async function getOrCreatePracticeSetFromReviewUnit(moduleId: string, budget = 3) {
  const existing = await findPracticeSetForSource('review_unit', moduleId)
  return existing ?? createPracticeSet(await plannerInputForReviewModule(moduleId, 'review_unit', budget))
}

export async function getOrCreatePracticeSetFromToday(moduleId: string, budget = 3) {
  return createPracticeSet(await plannerInputForReviewModule(moduleId, 'today', budget))
}

export async function getOrCreatePracticeSetFromSkill(skillBundleId: string, budget = 3) {
  const module = (await select<Array<{ id: string }>>('SELECT id FROM review_modules WHERE skill_bundle_id=$1 ORDER BY rowid DESC LIMIT 1', [skillBundleId]))[0]
  if (!module) throw new Error('该 Skill 暂无可用于练习的已验证题目')
  const input = await plannerInputForReviewModule(module.id, 'review_unit', budget)
  return createPracticeSet({ ...input, sourceType: 'skill', sourceRef: skillBundleId })
}

export async function getOrCreatePracticeSetFromFailedAttempt(attemptId: string, budget = 3) {
  const module = (await select<Array<{ module_id: string }>>(`SELECT module.id AS module_id FROM review_attempts attempt
    JOIN question_instances instance ON instance.id=attempt.question_instance_id
    JOIN review_modules module ON module.id=instance.review_module_id WHERE attempt.id=$1 LIMIT 1`, [attemptId]))[0]
  if (!module) throw new Error('找不到失败作答对应的 Review Unit')
  const input = await plannerInputForReviewModule(module.module_id, 'review_unit', budget)
  return createPracticeSet({ ...input, sourceType: 'practice_attempt', sourceRef: attemptId, recentFailureCount: Math.max(2, input.recentFailureCount) })
}

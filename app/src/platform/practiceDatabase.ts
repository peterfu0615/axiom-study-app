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
import { generateVerifiedPracticeVariant } from './variantPracticeDatabase'
import type { PracticeVariantPreparationOutcome } from './variantPracticeDatabase'
import { createPracticeReviewSession, transitionPracticeReviewSession } from './practiceSessionDatabase'
import { getProblemSolution, getSavedProblem } from './database'
import { getProblemDifficulty, listProblemTags } from './horizonDatabase'
import { getPreferredDiagram } from './diagramDatabase'
import { compileGeometrySceneToTikz } from '../domain/geometryTikz'
import { renderTikz } from './native'
import type { DiagramValidationContract, TikzRenderResult } from '../domain/diagram'

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
  generation_metadata_json: string; review_session_id: string | null; session_mode: PracticeSet['sessionMode']
  session_settings_json: string; created_at: number; updated_at: number
}
interface ItemRow {
  id: string; practice_set_id: string; order_index: number; source_type: PracticeItem['sourceType']
  source_problem_id: string | null; variant_plan_id: string | null; subject: string; target_skill_bundle_id: string | null
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
    reviewSessionId: set.review_session_id, sessionMode: set.session_mode,
    sessionSettings: parseJSON(set.session_settings_json, undefined), strategy: set.strategy, status: set.status,
    targetSkills: parseJSON(set.target_skills_json, []),
    generationMetadata: parseJSON(set.generation_metadata_json, {}),
    createdAt: numeric(set.created_at), updatedAt: numeric(set.updated_at),
    items: items.map((row) => {
      const metadata = parseJSON<Record<string, unknown> | null>(row.generation_metadata_json, null)
      return {
        id: row.id, practiceSetId: row.practice_set_id, orderIndex: numeric(row.order_index),
        sourceType: row.source_type, sourceProblemId: row.source_problem_id, variantPlanId: row.variant_plan_id, subject: row.subject,
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

export async function findPracticeSetForSource(
  sourceType: PracticeSourceType,
  sourceRef: string,
  sessionMode?: PracticeSet['sessionMode'],
) {
  const row = (await select<Array<{ id: string }>>(
    `SELECT id FROM practice_sets WHERE source_type=$1 AND source_ref=$2 AND status='ready'
      ${sessionMode ? 'AND session_mode=$3' : ''}
      ORDER BY created_at DESC LIMIT 1`,
    [sourceType, sourceRef, ...(sessionMode ? [sessionMode] : [])],
  ))[0]
  return row ? readPracticeSetById(row.id) : null
}

async function findReusablePracticeSetForSource(
  sourceType: PracticeSourceType,
  sourceRef: string,
  sessionMode: PracticeSet['sessionMode'],
) {
  const row = (await select<Array<{ id: string }>>(
    `SELECT practice_set.id FROM practice_sets practice_set
     WHERE practice_set.source_type=$1 AND practice_set.source_ref=$2
       AND practice_set.status='ready' AND practice_set.session_mode=$3
       AND EXISTS (
         SELECT 1 FROM practice_items item
         WHERE item.practice_set_id=practice_set.id AND NOT EXISTS (
           SELECT 1 FROM practice_responses response
           JOIN practice_evidences evidence ON evidence.practice_response_id=response.id
           WHERE response.practice_item_id=item.id
         )
       )
     ORDER BY practice_set.created_at DESC LIMIT 1`,
    [sourceType, sourceRef, sessionMode],
  ))[0]
  return row ? readPracticeSetById(row.id) : null
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, operation: (item: T) => Promise<R>) {
  const output = new Array<R>(items.length)
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      output[index] = await operation(items[index])
    }
  }))
  return output
}

export async function createPracticeSet(
  input: PracticePlannerInput,
  options: {
    preparedVariants?: Map<string, PracticeVariantPreparationOutcome>
    forceVariant?: boolean
  } = {},
): Promise<PracticeSet> {
  const mode = input.sessionMode ?? 'standard'
  const cached = await findReusablePracticeSetForSource(input.sourceType, input.sourceRef, mode)
  if (cached) return cached
  const blueprint = buildPracticeBlueprint(input)
  if (!blueprint.items.length) throw new Error('没有带有效题干、答案和解法的关联题，无法创建练习集')
  const durationPerItem = mode === 'quick' ? 180 : mode === 'mock_test' ? 600 : 420
  const session = await createPracticeReviewSession({
    mode, itemCount: blueprint.items.length,
    estimatedDurationSeconds: blueprint.items.length * durationPerItem,
    settings: input.sessionSettings,
  })
  try {
    const preparedOutcomes = await mapWithConcurrency(blueprint.items, 2, async (planned) => ({
      planned,
      outcome: options.preparedVariants?.get(planned.problem.problemId) ?? (!options.forceVariant && planned.requestedSourceType === 'existing_problem'
        ? { planId: '', variant: null, fallbackCode: 'original_only' }
        : await generateVerifiedPracticeVariant({ source: planned.problem, targetDifficulty: planned.difficulty })),
    }))
    const renderedVariantDiagrams = new Map<string, {
      source: string; contract: DiagramValidationContract; render: TikzRenderResult
    }>()
    const prepared = await Promise.all(preparedOutcomes.map(async (item) => {
      const candidate = item.outcome.variant?.candidate
      if (candidate?.diagramPolicy !== 'generated' || !candidate.geometryScene) return item
      const compiled = compileGeometrySceneToTikz(candidate.geometryScene)
      const render = await renderTikz(compiled.source, compiled.contract)
      if (render.renderStatus !== 'rendered' || render.validationStatus !== 'validated') {
        return { planned: item.planned, outcome: {
          planId: item.outcome.planId, variant: null,
          fallbackCode: render.errorCode ?? 'variant_diagram_failed',
        } }
      }
      renderedVariantDiagrams.set(item.outcome.planId, { ...compiled, render })
      return item
    }))
    return await withTransactionLock(async () => {
      await execute('BEGIN IMMEDIATE')
      try {
        const existing = await findReusablePracticeSetForSource(input.sourceType, input.sourceRef, mode)
        if (existing) {
          const now = Date.now()
          await execute("UPDATE review_sessions SET status='cancelled',failure_code='source_race_reused',updated_at=$1 WHERE id=$2 AND status='draft'", [now, session.id])
          await execute(`INSERT INTO review_session_events(id,review_session_id,from_status,to_status,safe_code,metadata_json,created_at)
            VALUES($1,$2,'draft','cancelled','source_race_reused','{}',$3)`, [uuid(), session.id, now])
          await execute('COMMIT')
          return existing
        }
        const now = Date.now()
        const setId = uuid()
        await execute(`INSERT INTO practice_sets(
          id, subject, source_type, source_ref, review_session_id, session_mode, session_settings_json,
          strategy, status, target_skills_json, generation_metadata_json, created_at, updated_at
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'ready',$9,$10,$11,$11)`, [
          setId, input.subject, input.sourceType, input.sourceRef, session.id, session.mode,
          JSON.stringify(session.settings), PRACTICE_PLANNER_VERSION, JSON.stringify(input.targetSkills), JSON.stringify({
            plannerVersion: blueprint.plannerVersion, masteryBand: blueprint.masteryBand,
            requestedBudget: blueprint.requestedBudget, warnings: blueprint.warnings,
            sourcePolicy: options.forceVariant ? 'explicit-variant-v1' : 'alternating-v1',
            variantPlanIds: prepared.map((item) => item.outcome.planId).filter(Boolean),
            generatedVariantCount: prepared.filter((item) => item.outcome.variant).length,
            fallbackCount: prepared.filter((item) => !item.outcome.variant).length,
          }), now,
        ])
        for (const [index, preparedItem] of prepared.entries()) {
          const { planned, outcome } = preparedItem
          const problem = planned.problem
          const variant = outcome.variant
          const sourceType = variant ? 'generated_variant' : 'existing_problem'
          const statementMarkdown = variant?.candidate.statementMarkdown ?? problem.statementMarkdown
          const options = variant?.candidate.options ?? problem.options
          const canonicalAnswer = variant?.candidate.canonicalAnswer ?? problem.canonicalAnswer
          const solutionJson = variant?.candidate.solutionJson ?? problem.solutionJson
          const bundleId = problem.targetSkillBundleId
            ?? input.targetSkills.find((target) => target.id.startsWith('bundle:'))?.id.slice(7)
            ?? null
          if (!bundleId) throw new Error(`练习题 ${index + 1} 缺少 SkillBundle，无法建立 ReviewSession`)
          const generationMetadata = variant ? {
            variantPlanId: variant.plan.id, sourceProblemId: problem.problemId,
            requestedSourceType: planned.requestedSourceType,
            changes: variant.candidate.changes, verification: variant.verification,
            provider: variant.provider, model: variant.model,
            promptVersion: variant.plan.promptVersion, schemaVersion: variant.plan.schemaVersion,
            generationModelRunId: variant.generationModelRunId,
            verificationModelRunId: variant.verificationModelRunId,
            diagramIds: problem.diagramIds, questionImagePath: null,
            diagramImagePaths: variant.candidate.diagramPolicy === 'preserved' ? problem.diagramImagePaths : [],
          } : {
            variantFallbackPlanId: outcome.planId, variantFallbackCode: outcome.fallbackCode,
            requestedSourceType: planned.requestedSourceType,
            diagramIds: problem.diagramIds, questionImagePath: problem.questionImagePath,
            diagramImagePaths: problem.diagramImagePaths,
          }
          const itemId = uuid()
          await execute(`INSERT INTO practice_items(
            id, practice_set_id, order_index, source_type, source_problem_id, variant_plan_id, subject,
            target_skill_bundle_id, target_tags_json, difficulty, statement_markdown,
            options_json, canonical_answer, solution_json, grading_rubric_json,
            generation_metadata_json, validation_status, created_at
          ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'valid',$17)`, [
            itemId, setId, index, sourceType, problem.problemId, variant?.plan.id ?? null, problem.subject,
            bundleId, JSON.stringify(problem.targetTags), planned.difficulty, statementMarkdown,
            options ? JSON.stringify(options) : null, canonicalAnswer, solutionJson,
            JSON.stringify({ criteria: ['答案正确', '关键步骤完整', '表达清晰'], maxScore: 100 }),
            JSON.stringify(generationMetadata), now,
          ])
          const preservedDiagramIds = !variant || variant.candidate.diagramPolicy === 'preserved'
            ? problem.diagramIds : []
          for (const diagramId of preservedDiagramIds) {
            await execute(`INSERT INTO diagrams(
              id,owner_type,owner_id,source_type,source,render_status,rendered_asset_path,
              rendered_mime_type,render_hash,renderer_version,render_error_code,render_error_message,
              validation_status,validation_json,contract_json,width_units,height_units,repair_attempts,
              created_at,updated_at
            ) SELECT $1,'practice_item',$2,source_type,source,render_status,rendered_asset_path,
              rendered_mime_type,render_hash,renderer_version,render_error_code,render_error_message,
              validation_status,validation_json,contract_json,width_units,height_units,repair_attempts,$3,$3
              FROM diagrams WHERE id=$4 AND render_status='rendered' AND validation_status='validated'`,
            [uuid(), itemId, now, diagramId])
          }
          const generatedDiagram = variant ? renderedVariantDiagrams.get(variant.plan.id) : null
          if (generatedDiagram) {
            const render = generatedDiagram.render
            await execute(`INSERT INTO diagrams(
              id,owner_type,owner_id,source_type,source,render_status,rendered_asset_path,
              rendered_mime_type,render_hash,renderer_version,render_error_code,render_error_message,
              validation_status,validation_json,contract_json,width_units,height_units,repair_attempts,
              created_at,updated_at
            ) VALUES($1,'practice_item',$2,'tikz',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,0,$16,$16)`, [
              uuid(), itemId, generatedDiagram.source, render.renderStatus, render.renderedAssetPath,
              render.renderedMimeType, render.renderHash, render.rendererVersion, render.errorCode,
              render.errorMessage, render.validationStatus,
              JSON.stringify({ errors: render.validationErrors, aspectRatio: render.aspectRatio, inkCoverage: render.inkCoverage }),
              JSON.stringify(generatedDiagram.contract), render.width, render.height, now,
            ])
          }
          const moduleId = uuid()
          await execute(`INSERT INTO review_modules(
            id,subject,session_id,skill_bundle_id,priority_score,selection_reason,target_difficulty,
            source_mode,estimated_duration_seconds,order_index,status
          ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending')`, [
            moduleId, problem.subject, session.id, bundleId, problem.relevance,
            variant ? '受约束变式题已通过独立审校' : '变式不可安全生成，已回退到已确认原题',
            planned.difficulty, variant ? 'variant' : 'original', durationPerItem, index,
          ])
          await execute(`INSERT INTO question_instances(
            id,subject,review_module_id,source_type,source_problem_id,variant_plan_id,stem_markdown,
            structured_content_json,solution_json,target_tags_json,difficulty,generation_model_run_id,
            verification_status,created_at
          ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'verified',$13)`, [
            uuid(), problem.subject, moduleId, variant ? 'variant' : 'original', problem.problemId,
            variant?.plan.id ?? null, statementMarkdown, JSON.stringify({ options, practiceItemId: itemId }),
            solutionJson, JSON.stringify({ tags: problem.targetTags }), planned.difficulty,
            variant?.generationModelRunId ?? null, now,
          ])
        }
        await execute("UPDATE review_sessions SET status='generated',updated_at=$1 WHERE id=$2 AND status='draft'", [now, session.id])
        await execute(`INSERT INTO review_session_events(id,review_session_id,from_status,to_status,safe_code,metadata_json,created_at)
          VALUES($1,$2,'draft','generated','practice_set_ready',$3,$4)`, [
          uuid(), session.id, JSON.stringify({ practiceSetId: setId, mode: session.mode }), now,
        ])
        await execute('COMMIT')
        const created = await readPracticeSetById(setId)
        if (!created) throw new Error('练习集保存后无法读取')
        return created
      } catch (error) {
        try { await execute('ROLLBACK') } catch { /* original error wins */ }
        throw error
      }
    })
  } catch (error) {
    try {
      await transitionPracticeReviewSession({ sessionId: session.id, to: 'generation_failed', safeCode: 'practice_generation_failed' })
    } catch { /* preserve the original generation error */ }
    throw error
  }
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
  question_image_path: string | null; diagram_image_path: string | null; diagram_ids_json: string
}
interface SkillStateRow extends Partial<ReviewSkillState> { tag_id: string }
interface ConfirmedPracticeHistoryRow {
  problem_id: string
  confirmed_count: number
  last_confirmed_at: number
  last_source_type: PracticeItem['sourceType']
}

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
      COALESCE((SELECT json_group_array(id) FROM (
        SELECT diagram.id FROM diagrams diagram
        WHERE diagram.owner_type='problem' AND diagram.owner_id=problem.id
          AND diagram.render_status='rendered' AND diagram.validation_status='validated'
        ORDER BY diagram.updated_at DESC,diagram.id DESC LIMIT 1
      )), '[]') AS diagram_ids_json,
      COALESCE((SELECT region.image_path FROM problem_regions region
        WHERE region.problem_id=problem.id AND region.region_type='diagram' AND region.image_path IS NOT NULL
        ORDER BY CASE region.source WHEN 'manual' THEN 0 ELSE 1 END, region.updated_at DESC LIMIT 1
      ), CASE WHEN problem.ai_has_diagram=1 THEN problem.ai_diagram_image_path END) AS diagram_image_path
    FROM skill_bundle_problems link JOIN problems problem ON problem.id=link.problem_id
    LEFT JOIN problem_solutions solution ON solution.problem_id=problem.id AND solution.status='completed'
    LEFT JOIN problem_difficulties difficulty ON difficulty.problem_id=problem.id
    CROSS JOIN (SELECT $1 AS subject) context
    WHERE link.skill_bundle_id=$2 ORDER BY link.similarity_score DESC, problem.id`, [context.subject, context.skill_bundle_id])
  const relatedIds = [...new Set(related.map((row) => row.problem_id))]
  const historyRows = relatedIds.length ? await select<ConfirmedPracticeHistoryRow[]>(`
    WITH confirmed AS (
      SELECT item.source_problem_id AS problem_id,item.source_type,evidence.created_at,
        row_number() OVER (
          PARTITION BY item.source_problem_id
          ORDER BY evidence.created_at DESC,evidence.id DESC
        ) AS recent_rank
      FROM practice_items item
      JOIN practice_responses response ON response.practice_item_id=item.id
      JOIN practice_evidences evidence ON evidence.practice_response_id=response.id
      WHERE item.source_problem_id IN (${relatedIds.map((_, index) => `$${index + 1}`).join(',')})
    )
    SELECT problem_id,count(*) AS confirmed_count,max(created_at) AS last_confirmed_at,
      max(CASE WHEN recent_rank=1 THEN source_type END) AS last_source_type
    FROM confirmed GROUP BY problem_id`, relatedIds) : []
  const history = new Map(historyRows.map((row) => [row.problem_id, row]))
  const candidates: PracticeProblemCandidate[] = related.map((row) => {
    const solutionJson = JSON.stringify({ contentMarkdown: row.solution_content ?? '', steps: parseJSON(row.solution_steps_json, []) })
    const confirmed = history.get(row.problem_id)
    return {
      problemId: row.problem_id, targetSkillBundleId: context.skill_bundle_id,
      subject: row.subject, statementMarkdown: row.stem_markdown,
      solutionJson, canonicalAnswer: canonicalAnswerFromSolution(solutionJson),
      options: optionsFromStructured(row.structured_content_json), targetTags: tags,
      diagramIds: parseJSON<string[]>(row.diagram_ids_json, []),
      questionImagePath: row.question_image_path, diagramImagePaths: row.diagram_image_path ? [row.diagram_image_path] : [],
      originalDifficulty: row.difficulty ?? context.target_difficulty, relevance: numeric(row.similarity_score, 1),
      confirmedPracticeCount: numeric(confirmed?.confirmed_count),
      lastConfirmedAt: confirmed ? numeric(confirmed.last_confirmed_at) : null,
      lastConfirmedSourceType: confirmed?.last_source_type ?? null,
    }
  })
  return {
    sourceType, sourceRef: context.module_id,
    subject: context.subject, targetSkills: targets, relatedProblems: candidates,
    recentFailureCount: 0, desiredBudget: budget,
  }
}

export interface SingleVariantPreview {
  source: PracticeProblemCandidate
  outcome: PracticeVariantPreparationOutcome
}

export interface SingleVariantPrerequisites {
  subject: string
  stemMarkdown: string
  hasValidSolution: boolean
  difficulty: DifficultyLevel | null
  confirmedTagCount: number
  missing: Array<'subject' | 'stem' | 'solution' | 'difficulty' | 'tags'>
}

export async function getSingleVariantPrerequisites(problemId: string): Promise<SingleVariantPrerequisites> {
  const [problem, solution, tags, difficulty] = await Promise.all([
    getSavedProblem(problemId), getProblemSolution(problemId), listProblemTags(problemId), getProblemDifficulty(problemId),
  ])
  if (!problem) throw new Error('找不到这道题')
  const hasValidSolution = Boolean(solution && solution.status === 'completed' &&
    (solution.contentMarkdown.trim() || solution.steps.length))
  const confirmedTagCount = tags.filter((tag) => tag.tagId && tag.tagType !== 'error' &&
    tag.mappingStatus !== 'rejected' && tag.verificationStatus === 'user_verified').length
  const missing: SingleVariantPrerequisites['missing'] = []
  if (!problem.subject?.trim()) missing.push('subject')
  if (!problem.stemMarkdown?.trim()) missing.push('stem')
  if (!hasValidSolution) missing.push('solution')
  if (!difficulty) missing.push('difficulty')
  if (!confirmedTagCount) missing.push('tags')
  return {
    subject: problem.subject?.trim() ?? '', stemMarkdown: problem.stemMarkdown?.trim() ?? '',
    hasValidSolution, difficulty: difficulty?.level ?? null, confirmedTagCount, missing,
  }
}

async function ensureSingleProblemBundle(source: PracticeProblemCandidate) {
  const linked = (await select<Array<{ skill_bundle_id: string }>>(
    `SELECT skill_bundle_id FROM skill_bundle_problems WHERE problem_id=$1 ORDER BY created_at LIMIT 1`,
    [source.problemId],
  ))[0]
  if (linked) return linked.skill_bundle_id
  const targetIds = source.targetTags.flatMap((tag) => tag.id ? [`${tag.type}:${tag.id}`] : []).sort()
  const canonicalKey = `${source.subject.trim().toLocaleLowerCase('zh-CN')}|${targetIds.join('|') || `problem:${source.problemId}`}|${source.originalDifficulty}`
  const primary = source.targetTags.find((tag) => tag.type === 'knowledge' && tag.id)
    ?? source.targetTags.find((tag) => tag.id)
  if (!primary?.id) throw new Error('请先确认至少一个知识、方法或模型标签')
  const now = Date.now()
  const bundleId = uuid()
  await withTransactionLock(async () => {
    await execute('BEGIN IMMEDIATE')
    try {
      await execute(`INSERT OR IGNORE INTO skill_bundles(
        id,subject,canonical_key,primary_knowledge_tag_id,method_tag_ids_json,model_tag_ids_json,
        difficulty_context,cluster_version,created_at
      ) VALUES($1,$2,$3,$4,$5,$6,$7,1,$8)`, [
        bundleId, source.subject, canonicalKey, primary.id,
        JSON.stringify(source.targetTags.filter((tag) => tag.type === 'method' && tag.id).map((tag) => tag.id)),
        JSON.stringify(source.targetTags.filter((tag) => tag.type === 'model' && tag.id).map((tag) => tag.id)),
        source.originalDifficulty, now,
      ])
      const actual = (await select<Array<{ id: string }>>(
        'SELECT id FROM skill_bundles WHERE subject=$1 AND canonical_key=$2 LIMIT 1',
        [source.subject, canonicalKey],
      ))[0]
      if (!actual) throw new Error('无法建立题目能力组合')
      await execute(`INSERT OR IGNORE INTO skill_bundle_problems(
        skill_bundle_id,problem_id,similarity_score,role,created_at
      ) VALUES($1,$2,1,'primary',$3)`, [actual.id, source.problemId, now])
      await execute('COMMIT')
    } catch (error) {
      try { await execute('ROLLBACK') } catch { /* preserve original error */ }
      throw error
    }
  })
  const saved = (await select<Array<{ skill_bundle_id: string }>>(
    `SELECT skill_bundle_id FROM skill_bundle_problems WHERE problem_id=$1 ORDER BY created_at LIMIT 1`,
    [source.problemId],
  ))[0]
  if (!saved) throw new Error('题目能力组合保存后无法读取')
  return saved.skill_bundle_id
}

export async function prepareSingleProblemVariant(problemId: string): Promise<SingleVariantPreview> {
  const [problem, solution, problemTags, diagram] = await Promise.all([
    getSavedProblem(problemId), getProblemSolution(problemId), listProblemTags(problemId),
    getPreferredDiagram('problem', problemId),
  ])
  if (!problem) throw new Error('找不到这道题')
  if (!problem.stemMarkdown?.trim()) throw new Error('请先补全题干')
  if (!problem.subject?.trim()) throw new Error('请先确认题目科目')
  if (!solution || solution.status !== 'completed' || (!solution.contentMarkdown.trim() && !solution.steps.length)) {
    throw new Error('请先生成并确认有效解答')
  }
  if (!problem.libraryMetadata.difficulty) throw new Error('请先确认题目难度')
  const targetTags: ReviewTag[] = problemTags
    .filter((tag) => tag.tagId && tag.tagType !== 'error' && tag.mappingStatus !== 'rejected' && tag.verificationStatus === 'user_verified')
    .map((tag) => ({ id: tag.tagId, name: tag.canonicalName, type: tag.tagType, role: tag.role }))
  if (!targetTags.length) throw new Error('请先确认至少一个知识、方法或模型标签')
  const solutionJson = JSON.stringify({ contentMarkdown: solution.contentMarkdown, steps: solution.steps })
  const source: PracticeProblemCandidate = {
    problemId: problem.id, subject: problem.subject, statementMarkdown: problem.stemMarkdown,
    solutionJson, canonicalAnswer: canonicalAnswerFromSolution(solutionJson),
    options: problem.aiChoices.length ? problem.aiChoices.map((choice) => choice.text) : null,
    targetTags, diagramIds: diagram ? [diagram.id] : [], questionImagePath: problem.cropImagePath,
    diagramImagePaths: diagram?.renderedAssetPath ? [diagram.renderedAssetPath] : problem.aiDiagramImagePath ? [problem.aiDiagramImagePath] : [],
    originalDifficulty: problem.libraryMetadata.difficulty, relevance: 100,
  }
  source.targetSkillBundleId = await ensureSingleProblemBundle(source)
  const outcome = await generateVerifiedPracticeVariant({ source, targetDifficulty: source.originalDifficulty })
  if (!outcome.variant) throw new Error(`变式未通过安全审校：${outcome.fallbackCode ?? 'unknown'}`)
  return { source, outcome }
}

export async function createPracticeSetFromVariantPreview(preview: SingleVariantPreview) {
  const bundleId = preview.source.targetSkillBundleId
  if (!bundleId) throw new Error('变式题缺少能力组合')
  const targets: PracticeTargetSkill[] = [
    { id: `bundle:${bundleId}`, name: '单题变式', type: 'model', state: null },
    ...preview.source.targetTags.filter((tag) => tag.id).map((tag) => ({
      id: tag.id!, name: tag.name, type: tag.type as PracticeTargetSkill['type'], state: null,
    })),
  ]
  return createPracticeSet({
    sourceType: 'skill', sourceRef: `variant:${preview.outcome.planId}`, subject: preview.source.subject,
    targetSkills: targets, relatedProblems: [preview.source], recentFailureCount: 0,
    desiredBudget: 1, sessionMode: 'standard',
  }, { preparedVariants: new Map([[preview.source.problemId, preview.outcome]]), forceVariant: true })
}

export async function getOrCreatePracticeSetFromReviewUnit(
  moduleId: string, budget = 3, sessionMode: PracticeSet['sessionMode'] = 'standard',
) {
  const existing = await findReusablePracticeSetForSource('review_unit', moduleId, sessionMode)
  return existing ?? createPracticeSet({ ...(await plannerInputForReviewModule(moduleId, 'review_unit', budget)), sessionMode })
}

export async function getOrCreatePracticeSetFromToday(
  moduleId: string, budget = 3, sessionMode: PracticeSet['sessionMode'] = 'standard',
) {
  return createPracticeSet({ ...(await plannerInputForReviewModule(moduleId, 'today', budget)), sessionMode })
}

export async function getOrCreatePracticeSetFromTodayPlan(
  sessionId: string, moduleIds: string[], budget = 6,
  sessionMode: PracticeSet['sessionMode'] = 'standard',
) {
  const existing = await findReusablePracticeSetForSource('today', sessionId, sessionMode)
  if (existing) return existing
  const uniqueModuleIds = [...new Set(moduleIds)]
  if (!uniqueModuleIds.length) throw new Error('今天没有可用于生成练习的学习主题')
  const inputs = await Promise.all(uniqueModuleIds.map((moduleId) => plannerInputForReviewModule(moduleId, 'today', budget)))
  const subjects = [...new Set(inputs.map((input) => input.subject))]
  const targetSkills = inputs.flatMap((input) => input.targetSkills).filter((target, index, all) =>
    all.findIndex((item) => item.id === target.id) === index)
  const relatedProblems = inputs.flatMap((input) => input.relatedProblems).filter((problem, index, all) =>
    all.findIndex((item) => item.problemId === problem.problemId) === index)
  return createPracticeSet({
    sourceType: 'today',
    sourceRef: sessionId,
    subject: subjects.length === 1 ? subjects[0] : '综合',
    subjects,
    targetSkills,
    relatedProblems,
    recentFailureCount: Math.max(...inputs.map((input) => input.recentFailureCount), 0),
    desiredBudget: Math.max(uniqueModuleIds.length, budget), sessionMode,
  })
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

export async function getOrCreatePracticeSetFromPracticeAttempt(attemptId: string, budget = 3) {
  const existing = await findPracticeSetForSource('practice_attempt', attemptId)
  if (existing) return existing
  const context = (await select<Array<{ module_id: string }>>(`SELECT module.id AS module_id
    FROM practice_attempts attempt
    JOIN practice_responses response ON response.practice_attempt_id=attempt.id
    JOIN practice_items item ON item.id=response.practice_item_id
    JOIN review_modules module ON module.skill_bundle_id=item.target_skill_bundle_id
    WHERE attempt.id=$1 ORDER BY module.rowid DESC LIMIT 1`, [attemptId]))[0]
  if (!context) throw new Error('失败练习缺少可追溯的 SkillBundle，不能安全生成下一轮')
  const input = await plannerInputForReviewModule(context.module_id, 'review_unit', budget)
  const excluded = await select<Array<{ problem_id: string }>>(`SELECT DISTINCT item.source_problem_id AS problem_id
    FROM practice_loop_rounds round
    JOIN practice_loop_rounds current_round ON current_round.practice_loop_id=round.practice_loop_id
    JOIN practice_attempts attempt ON attempt.practice_set_id=current_round.practice_set_id
    JOIN practice_items item ON item.practice_set_id=round.practice_set_id
    WHERE attempt.id=$1 AND item.source_problem_id IS NOT NULL`, [attemptId])
  const failures = await select<Array<{ error_category: string | null }>>(`SELECT json_extract(response.grading_result_json,'$.errorCategory') AS error_category
    FROM practice_responses response WHERE response.practice_attempt_id=$1
      AND json_extract(response.grading_result_json,'$.correctness')!='correct'`, [attemptId])
  return createPracticeSet({
    ...input, sourceType: 'practice_attempt', sourceRef: attemptId,
    recentFailureCount: Math.max(2, failures.length),
    excludedProblemIds: excluded.map((row) => row.problem_id),
    preferredErrorCategories: failures.flatMap((row) => row.error_category ? [row.error_category] : []),
  })
}

import { invoke } from '@tauri-apps/api/core'
import {
  REVIEW_SCHEDULER_VERSION,
  applyReviewRating,
  buildTodayReviewUnits,
  initialReviewSkillState,
  localReviewDate,
  ratingEvidence,
  type ReviewCandidate,
  type ReviewRating,
  type ReviewSkillState,
  type ReviewTag,
  type ReviewUnitDraft,
  type ReviewUnitStatus,
} from '../domain/review'
import type { DifficultyLevel, HorizonTagType } from '../domain/models'
import { buildReviewForecast, type ReviewForecastDay } from '../domain/reviewForecast'
import { DEFAULT_REVIEW_PREFERENCES, getReviewPreferences, type ReviewPreferences } from './reviewPreferencesDatabase'
import { withTransactionLock } from './transactionLock'

interface ExecuteResult { rowsAffected: number; lastInsertId: number }
const execute = (sql: string, params: unknown[] = []) => invoke<ExecuteResult>('db_execute', { sql, params })
const select = <T>(sql: string, params: unknown[] = []) => invoke<T>('db_select', { sql, params })
const uuid = () => crypto.randomUUID()
const number = (value: unknown, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback
const nullableNumber = (value: unknown) => value == null ? null : number(value)
const text = (value: unknown, fallback = '') => typeof value === 'string' ? value : fallback

function parseJSON<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || !value.trim()) return fallback
  try { return JSON.parse(value) as T } catch { return fallback }
}

export function resolveReviewQuestionMedia(
  snapshot: { questionImagePath?: string | null; diagramImagePaths?: string[] },
  current: { questionImagePath: string | null; diagramImagePath: string | null },
) {
  return {
    questionImagePath: snapshot.questionImagePath ?? current.questionImagePath,
    diagramImagePaths: snapshot.diagramImagePaths ?? (current.diagramImagePath ? [current.diagramImagePath] : []),
  }
}

interface ProblemRow {
  problem_id: string
  subject: string
  title: string
  stem_markdown: string
  structured_content_json: string | null
  created_at: number
  difficulty: DifficultyLevel | null
  solution_content: string | null
  solution_steps_json: string | null
  question_image_path: string | null
  diagram_image_path: string | null
}

interface TagRow {
  problem_id: string
  tag_id: string | null
  tag_type: HorizonTagType
  tag_name: string
  role: 'primary' | 'secondary'
}

interface SkillRow {
  tag_id: string
  mastery_estimate: number
  stability: number
  retrievability: number
  evidence_count: number
  success_count: number
  failure_count: number
  transfer_score: number
  max_stable_difficulty: DifficultyLevel | null
  last_practiced_at: number | null
  next_review_at: number | null
  uncertainty: number
}

interface HistoryRow {
  problem_id: string
  reviewed_at: number
  rating: ReviewRating | null
}

function skillFromRow(row: SkillRow): ReviewSkillState {
  return {
    masteryEstimate: number(row.mastery_estimate, .45),
    stability: number(row.stability, 1),
    retrievability: number(row.retrievability, .65),
    evidenceCount: number(row.evidence_count),
    successCount: number(row.success_count),
    failureCount: number(row.failure_count),
    transferScore: number(row.transfer_score),
    maxStableDifficulty: row.max_stable_difficulty,
    lastPracticedAt: nullableNumber(row.last_practiced_at),
    nextReviewAt: nullableNumber(row.next_review_at),
    uncertainty: number(row.uncertainty, 1),
  }
}

export async function listReviewCandidates(): Promise<ReviewCandidate[]> {
  const [problems, tagRows, skillRows, historyRows] = await Promise.all([
    select<ProblemRow[]>(`
      SELECT p.id AS problem_id,
        trim(COALESCE(NULLIF(p.user_subject, ''), NULLIF(p.ai_subject, ''), NULLIF(p.subject, ''))) AS subject,
        COALESCE(NULLIF(p.user_title, ''), NULLIF(p.ai_title, ''), NULLIF(p.title, ''), '未命名错题') AS title,
        COALESCE(NULLIF(p.user_stem_markdown, ''), NULLIF(p.ai_stem_markdown, ''), NULLIF(p.stem_markdown, ''), '') AS stem_markdown,
        COALESCE(p.structured_content_json, '{}') AS structured_content_json,
        p.created_at,
        difficulty.level AS difficulty,
        solution.content_markdown AS solution_content,
        solution.steps_json AS solution_steps_json,
        p.crop_image_path AS question_image_path,
        COALESCE((SELECT region.image_path FROM problem_regions region
          WHERE region.problem_id = p.id AND region.region_type = 'diagram' AND region.image_path IS NOT NULL
          ORDER BY CASE region.source WHEN 'manual' THEN 0 ELSE 1 END, region.updated_at DESC LIMIT 1
        ), p.ai_diagram_image_path) AS diagram_image_path
      FROM problems p
      LEFT JOIN problem_difficulties difficulty
        ON difficulty.problem_id = p.id AND difficulty.superseded_at IS NULL
      LEFT JOIN problem_solutions solution
        ON solution.problem_id = p.id AND solution.status = 'completed'
      WHERE p.status = 'saved' AND p.deleted_at IS NULL AND p.archived_at IS NULL
        AND trim(COALESCE(NULLIF(p.user_subject, ''), NULLIF(p.ai_subject, ''), NULLIF(p.subject, ''))) <> ''
      ORDER BY p.created_at, p.id
    `),
    select<TagRow[]>(`
      SELECT problem_tag.problem_id, problem_tag.tag_id, problem_tag.tag_type,
        COALESCE(definition.canonical_name, problem_tag.candidate_name, '未命名标签') AS tag_name,
        problem_tag.role
      FROM problem_tags problem_tag
      JOIN problems problem ON problem.id = problem_tag.problem_id
      LEFT JOIN tag_definitions definition ON definition.id = problem_tag.tag_id
      WHERE problem_tag.superseded_at IS NULL
        AND problem_tag.mapping_status != 'rejected'
        AND problem_tag.verification_status != 'rejected'
        AND problem.status = 'saved' AND problem.deleted_at IS NULL AND problem.archived_at IS NULL
      ORDER BY problem_tag.problem_id, problem_tag.tag_type, problem_tag.role, tag_name
    `),
    select<SkillRow[]>(`
      SELECT tag_id, mastery_estimate, stability, retrievability, evidence_count,
        success_count, failure_count, transfer_score, max_stable_difficulty,
        last_practiced_at, next_review_at, uncertainty
      FROM skill_states
    `),
    select<HistoryRow[]>(`
      SELECT instance.source_problem_id AS problem_id, attempt.created_at AS reviewed_at,
        CASE WHEN attempt.evidence_source='practice_attempt' AND effective.effective_grading_json IS NOT NULL
          THEN CASE json_extract(effective.effective_grading_json, '$.correctness')
            WHEN 'correct' THEN 'good' WHEN 'partial' THEN 'hard' ELSE 'again' END
          ELSE attempt.rating END AS rating
      FROM review_attempts attempt
      JOIN question_instances instance ON instance.id = attempt.question_instance_id
      LEFT JOIN practice_evidences practice_evidence ON practice_evidence.review_attempt_id=attempt.id
      LEFT JOIN practice_effective_responses effective ON effective.response_id=practice_evidence.practice_response_id
      WHERE instance.source_problem_id IS NOT NULL
      ORDER BY attempt.created_at DESC
    `),
  ])
  const tagsByProblem = new Map<string, ReviewTag[]>()
  tagRows.forEach((row) => {
    const tags = tagsByProblem.get(row.problem_id) ?? []
    tags.push({ id: row.tag_id, name: row.tag_name, type: row.tag_type, role: row.role })
    tagsByProblem.set(row.problem_id, tags)
  })
  const skills = Object.fromEntries(skillRows.map((row) => [row.tag_id, skillFromRow(row)]))
  const history = new Map<string, { lastReviewedAt: number; reviewCount: number; lastRating: ReviewRating | null }>()
  historyRows.forEach((row) => {
    const current = history.get(row.problem_id)
    history.set(row.problem_id, {
      lastReviewedAt: current?.lastReviewedAt ?? number(row.reviewed_at),
      reviewCount: (current?.reviewCount ?? 0) + 1,
      lastRating: current?.lastRating ?? row.rating,
    })
  })
  return problems.map((row) => {
    const tags = tagsByProblem.get(row.problem_id) ?? []
    const skillStates = Object.fromEntries(tags
      .filter((tag) => tag.id && tag.type !== 'error' && skills[tag.id])
      .map((tag) => [tag.id!, skills[tag.id!]]))
    const previous = history.get(row.problem_id)
    return {
      problemId: row.problem_id,
      subject: text(row.subject),
      title: text(row.title, '未命名错题'),
      stemMarkdown: text(row.stem_markdown),
      structuredContentJson: text(row.structured_content_json, '{}'),
      solutionJson: JSON.stringify({
        contentMarkdown: row.solution_content ?? '',
        steps: parseJSON(row.solution_steps_json, []),
      }),
      questionImagePath: row.question_image_path,
      diagramImagePaths: row.diagram_image_path ? [row.diagram_image_path] : [],
      createdAt: number(row.created_at),
      difficulty: row.difficulty,
      tags,
      skillStates,
      lastReviewedAt: previous?.lastReviewedAt ?? null,
      reviewCount: previous?.reviewCount ?? 0,
      lastRating: previous?.lastRating ?? null,
    }
  })
}

export async function getReviewForecast(days = 7, timestamp = Date.now()): Promise<ReviewForecastDay[]> {
  return buildReviewForecast(await listReviewCandidates(), timestamp, days)
}

/** @deprecated 兼容旧调用；请使用 getReviewForecast。 */
export async function getSevenDayReviewForecast(timestamp = Date.now()): Promise<ReviewForecastDay[]> {
  return getReviewForecast(7, timestamp)
}

export interface TodayReviewUnit {
  id: string
  sessionId: string
  subject: string
  skillBundleId: string
  canonicalKey: string
  title: string
  selectionReason: string
  difficulty: DifficultyLevel
  estimatedDurationSeconds: number
  orderIndex: number
  status: ReviewUnitStatus
  completedAt: number | null
  associationCount: number
  tags: ReviewTag[]
  errorCategories: ReviewTag[]
  question: {
    id: string
    sourceProblemId: string
    title: string
    stemMarkdown: string
    structuredContentJson: string
    solutionJson: string
    questionImagePath: string | null
    diagramImagePaths: string[]
  }
  rating: ReviewRating | null
}

export interface TodayReviewPlan {
  id: string
  sessionDate: string
  status: string
  createdAt: number
  completedAt: number | null
  estimatedDurationSeconds: number
  preferences: ReviewPreferences
  units: TodayReviewUnit[]
}

interface SessionRow {
  id: string
  session_date: string
  status: string
  estimated_duration_seconds: number
  created_at: number
  completed_at: number | null
  settings_json: string
}

interface UnitRow {
  id: string
  session_id: string
  subject: string
  skill_bundle_id: string
  canonical_key: string
  selection_reason: string
  target_difficulty: DifficultyLevel
  estimated_duration_seconds: number
  order_index: number
  status: ReviewUnitStatus
  completed_at: number | null
  question_id: string
  source_problem_id: string
  stem_markdown: string
  structured_content_json: string
  solution_json: string
  target_tags_json: string
  rating: ReviewRating | null
  association_count: number
  current_question_image_path: string | null
  current_diagram_image_path: string | null
}

async function readTodayPlanBySession(session: SessionRow): Promise<TodayReviewPlan> {
  const rows = await select<UnitRow[]>(`
    SELECT module.id, module.session_id, module.subject, module.skill_bundle_id,
      bundle.canonical_key, module.selection_reason, module.target_difficulty,
      module.estimated_duration_seconds, module.order_index, module.status,
      module.completed_at, instance.id AS question_id, instance.source_problem_id,
      instance.stem_markdown, instance.structured_content_json, instance.solution_json,
      instance.target_tags_json,
      CASE WHEN attempt.evidence_source='practice_attempt' AND effective.effective_grading_json IS NOT NULL
        THEN CASE json_extract(effective.effective_grading_json, '$.correctness')
          WHEN 'correct' THEN 'good' WHEN 'partial' THEN 'hard' ELSE 'again' END
        ELSE attempt.rating END AS rating,
      problem.crop_image_path AS current_question_image_path,
      COALESCE((SELECT region.image_path FROM problem_regions region
        WHERE region.problem_id = instance.source_problem_id AND region.region_type = 'diagram' AND region.image_path IS NOT NULL
        ORDER BY CASE region.source WHEN 'manual' THEN 0 ELSE 1 END, region.updated_at DESC LIMIT 1
      ), problem.ai_diagram_image_path) AS current_diagram_image_path,
      (SELECT COUNT(*) FROM skill_bundle_problems link WHERE link.skill_bundle_id = bundle.id) AS association_count
    FROM review_modules module
    JOIN subjects active_subject ON active_subject.name = module.subject AND active_subject.archived_at IS NULL
    JOIN skill_bundles bundle ON bundle.id = module.skill_bundle_id
    JOIN question_instances instance ON instance.review_module_id = module.id
    LEFT JOIN review_attempts attempt ON attempt.question_instance_id = instance.id
    LEFT JOIN practice_evidences practice_evidence ON practice_evidence.review_attempt_id=attempt.id
    LEFT JOIN practice_effective_responses effective ON effective.response_id=practice_evidence.practice_response_id
    LEFT JOIN problems problem ON problem.id = instance.source_problem_id
    WHERE module.session_id = $1
    ORDER BY module.order_index, module.id
  `, [session.id])
  return {
    id: session.id,
    sessionDate: session.session_date,
    status: session.status,
    createdAt: number(session.created_at),
    completedAt: nullableNumber(session.completed_at),
    estimatedDurationSeconds: number(session.estimated_duration_seconds),
    preferences: {
      ...DEFAULT_REVIEW_PREFERENCES,
      ...parseJSON<Partial<ReviewPreferences>>(session.settings_json, {}),
    },
    units: rows.map((row) => {
      const snapshot = parseJSON<{
        title?: string
        tags?: ReviewTag[]
        errorCategories?: ReviewTag[]
        questionImagePath?: string | null
        diagramImagePaths?: string[]
      }>(row.target_tags_json, {})
      const media = resolveReviewQuestionMedia(snapshot, {
        questionImagePath: row.current_question_image_path,
        diagramImagePath: row.current_diagram_image_path,
      })
      return {
        id: row.id,
        sessionId: row.session_id,
        subject: row.subject,
        skillBundleId: row.skill_bundle_id,
        canonicalKey: row.canonical_key,
        title: snapshot.title || '错题回顾',
        selectionReason: row.selection_reason,
        difficulty: row.target_difficulty,
        estimatedDurationSeconds: number(row.estimated_duration_seconds),
        orderIndex: number(row.order_index),
        status: row.status,
        completedAt: nullableNumber(row.completed_at),
        associationCount: number(row.association_count, 1),
        tags: snapshot.tags ?? [],
        errorCategories: snapshot.errorCategories ?? [],
        question: {
          id: row.question_id,
          sourceProblemId: row.source_problem_id,
          title: snapshot.title || '错题回顾',
          stemMarkdown: row.stem_markdown,
          structuredContentJson: row.structured_content_json,
          solutionJson: row.solution_json,
          ...media,
        },
        rating: row.rating,
      }
    }),
  }
}

async function findTodaySession(sessionDate: string) {
  return (await select<SessionRow[]>(`
    SELECT id, session_date, status, estimated_duration_seconds, created_at, completed_at, settings_json
    FROM review_sessions WHERE session_date = $1 AND session_kind = 'today' AND mode = 'standard' LIMIT 1
  `, [sessionDate]))[0] ?? null
}

function planningTags(unit: ReviewUnitDraft) {
  const seen = new Set<string>()
  return [unit.primaryKnowledge, ...unit.methods, ...unit.models]
    .filter((tag): tag is ReviewTag => Boolean(tag))
    .filter((tag) => {
      const key = `${tag.type}:${tag.id || tag.name}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

async function persistUnit(sessionId: string, unit: ReviewUnitDraft, orderIndex: number, now: number) {
  const bundleId = uuid()
  const moduleId = uuid()
  const questionId = uuid()
  const representative = unit.representativeProblems[0]
  const methodIds = unit.methods.flatMap((tag) => tag.id ? [tag.id] : [])
  const modelIds = unit.models.flatMap((tag) => tag.id ? [tag.id] : [])
  await execute(`INSERT OR IGNORE INTO skill_bundles (
    id, subject, canonical_key, primary_knowledge_tag_id, method_tag_ids_json,
    model_tag_ids_json, difficulty_context, cluster_version, created_at
  ) VALUES ($1,$2,$3,$4,$5,$6,$7,1,$8)`, [
    bundleId, unit.subject, unit.canonicalKey,
    unit.primaryKnowledge?.id ?? `legacy:${representative.problemId}`,
    JSON.stringify(methodIds), JSON.stringify(modelIds), unit.difficulty, now,
  ])
  const persistedBundle = (await select<Array<{ id: string }>>(
    'SELECT id FROM skill_bundles WHERE subject = $1 AND canonical_key = $2 LIMIT 1',
    [unit.subject, unit.canonicalKey],
  ))[0]
  if (!persistedBundle) throw new Error('无法建立复习能力组合')
  for (const [index, problemId] of unit.allProblemIds.entries()) {
    await execute(`INSERT OR IGNORE INTO skill_bundle_problems (
      skill_bundle_id, problem_id, similarity_score, role, created_at
    ) VALUES ($1,$2,$3,$4,$5)`, [persistedBundle.id, problemId, index === 0 ? 1 : .8, index === 0 ? 'primary' : 'supporting', now])
  }
  await execute(`INSERT OR IGNORE INTO skill_bundle_states (
    subject, skill_bundle_id, mastery_estimate, stability, retrievability,
    transfer_score, evidence_count, last_practiced_at, next_review_at,
    uncertainty, scheduler_version, updated_at
  ) VALUES ($1,$2,.45,1,.65,0,0,NULL,NULL,1,1,$3)`, [unit.subject, persistedBundle.id, now])

  for (const tag of planningTags(unit)) {
    if (!tag.id) continue
    await execute(`INSERT OR IGNORE INTO skill_states (
      id, subject, tag_id, mastery_estimate, stability, retrievability,
      evidence_count, success_count, failure_count, transfer_score,
      max_stable_difficulty, last_practiced_at, next_review_at, uncertainty,
      scheduler_version, created_at, updated_at
    ) VALUES ($1,$2,$3,.45,1,.65,0,0,0,0,NULL,NULL,NULL,1,$4,$5,$5)`, [uuid(), unit.subject, tag.id, REVIEW_SCHEDULER_VERSION, now])
  }

  await execute(`INSERT INTO review_modules (
    id, subject, session_id, skill_bundle_id, priority_score, selection_reason,
    target_difficulty, source_mode, estimated_duration_seconds, order_index, status
  ) VALUES ($1,$2,$3,$4,$5,$6,$7,'original',$8,$9,'pending')`, [
    moduleId, unit.subject, sessionId, persistedBundle.id, unit.priorityScore,
    unit.selectionReason, unit.difficulty, unit.estimatedDurationSeconds, orderIndex,
  ])
  await execute(`INSERT INTO question_instances (
    id, subject, review_module_id, source_type, source_problem_id,
    stem_markdown, structured_content_json, solution_json, target_tags_json,
    difficulty, verification_status, created_at
  ) VALUES ($1,$2,$3,'original',$4,$5,$6,$7,$8,$9,'verified',$10)`, [
    questionId, unit.subject, moduleId, representative.problemId,
    representative.stemMarkdown, representative.structuredContentJson,
    representative.solutionJson, JSON.stringify({
      title: unit.title,
      tags: planningTags(unit),
      errorCategories: unit.errorCategories,
      questionImagePath: representative.questionImagePath ?? null,
      diagramImagePaths: representative.diagramImagePaths ?? [],
    }), unit.difficulty, now,
  ])
}

export async function getOrCreateTodayPlan(timestamp = Date.now()): Promise<TodayReviewPlan> {
  const sessionDate = localReviewDate(timestamp)
  const existing = await findTodaySession(sessionDate)
  if (existing) return readTodayPlanBySession(existing)
  const [candidates, preferences] = await Promise.all([listReviewCandidates(), getReviewPreferences()])
  const units = buildTodayReviewUnits(candidates, { now: timestamp })
  return withTransactionLock(async () => {
    await execute('BEGIN IMMEDIATE')
    try {
      const raced = await findTodaySession(sessionDate)
      if (raced) {
        await execute('COMMIT')
        return readTodayPlanBySession(raced)
      }
      const sessionId = uuid()
      const estimated = units.reduce((total, unit) => total + unit.estimatedDurationSeconds, 0)
      await execute(`INSERT INTO review_sessions (
        id, session_date, status, mode, planned_problem_count,
        estimated_duration_seconds, settings_json, created_at
      ) VALUES ($1,$2,$3,'standard',$4,$5,$6,$7)`, [
        sessionId, sessionDate, units.length ? 'generated' : 'empty', units.length, estimated,
        JSON.stringify(preferences), timestamp,
      ])
      for (const [index, unit] of units.entries()) await persistUnit(sessionId, unit, index, timestamp)
      await execute('COMMIT')
      const session = await findTodaySession(sessionDate)
      if (!session) throw new Error('今日计划创建后无法读取')
      return readTodayPlanBySession(session)
    } catch (error) {
      try { await execute('ROLLBACK') } catch { /* original error wins */ }
      throw error
    }
  })
}

interface StateRow extends SkillRow { id?: string }

function skillParams(state: ReviewSkillState) {
  return [state.masteryEstimate, state.stability, state.retrievability, state.evidenceCount,
    state.successCount, state.failureCount, state.transferScore, state.maxStableDifficulty,
    state.lastPracticedAt, state.nextReviewAt, state.uncertainty]
}

export async function recordTodayReviewResult(input: {
  questionId: string
  rating: ReviewRating
  durationSeconds: number
  reviewedAt?: number
}) {
  const reviewedAt = input.reviewedAt ?? Date.now()
  const resultKey = `today:${input.questionId}`
  return withTransactionLock(async () => {
    await execute('BEGIN IMMEDIATE')
    try {
      const existing = await select<Array<{ id: string }>>('SELECT id FROM review_attempts WHERE result_key = $1', [resultKey])
      if (existing.length) { await execute('COMMIT'); return false }
      const context = (await select<Array<{
        module_id: string; session_id: string; subject: string; skill_bundle_id: string
        difficulty: DifficultyLevel; target_tags_json: string
      }>>(`
        SELECT module.id AS module_id, module.session_id, module.subject,
          module.skill_bundle_id, instance.difficulty, instance.target_tags_json
        FROM question_instances instance
        JOIN review_modules module ON module.id = instance.review_module_id
        WHERE instance.id = $1
      `, [input.questionId]))[0]
      if (!context) throw new Error('复习题目不存在或已失效')
      const snapshot = parseJSON<{ tags?: ReviewTag[] }>(context.target_tags_json, {})
      const attemptId = uuid()
      await execute(`INSERT INTO review_attempts (
        id, subject, question_instance_id, is_correct, duration_seconds,
        used_hint, grading_confidence, created_at, rating, result_key
      ) VALUES ($1,$2,$3,$4,$5,0,1,$6,$7,$8)`, [
        attemptId, context.subject, input.questionId, input.rating === 'again' ? 0 : 1,
        Math.max(0, Math.round(input.durationSeconds)), reviewedAt, input.rating, resultKey,
      ])

      const evidence = ratingEvidence(input.rating)
      for (const tag of snapshot.tags ?? []) {
        if (!tag.id || tag.type === 'error') continue
        const currentRow = (await select<StateRow[]>(`
          SELECT * FROM skill_states WHERE subject = $1 AND tag_id = $2 LIMIT 1
        `, [context.subject, tag.id]))[0]
        const current = currentRow ? skillFromRow(currentRow) : initialReviewSkillState()
        const next = applyReviewRating(current, input.rating, context.difficulty, reviewedAt)
        if (currentRow) {
          await execute(`UPDATE skill_states SET
            mastery_estimate=$1, stability=$2, retrievability=$3, evidence_count=$4,
            success_count=$5, failure_count=$6, transfer_score=$7,
            max_stable_difficulty=$8, last_practiced_at=$9, next_review_at=$10,
            uncertainty=$11, scheduler_version=$12, updated_at=$13
            WHERE subject=$14 AND tag_id=$15`, [
            ...skillParams(next), REVIEW_SCHEDULER_VERSION, reviewedAt, context.subject, tag.id,
          ])
        }
        await execute(`INSERT INTO tag_evidences (
          id, subject, review_attempt_id, tag_id, skill_bundle_id, result,
          confidence, weight, evidence_text, transfer_flag, difficulty_context,
          user_verified, created_at
        ) VALUES ($1,$2,$3,$4,$5,$6,1,$7,$8,0,$9,1,$10)`, [
          uuid(), context.subject, attemptId, tag.id, context.skill_bundle_id,
          evidence.result, evidence.weight, '用户完成今日复习后的自评结果', context.difficulty, reviewedAt,
        ])
      }

      const bundleRow = (await select<Array<{
        mastery_estimate: number; stability: number; retrievability: number
        transfer_score: number; evidence_count: number; last_practiced_at: number | null
        next_review_at: number | null; uncertainty: number
      }>>('SELECT * FROM skill_bundle_states WHERE subject=$1 AND skill_bundle_id=$2', [context.subject, context.skill_bundle_id]))[0]
      const previousBundle = bundleRow ? {
        ...initialReviewSkillState(),
        masteryEstimate: number(bundleRow.mastery_estimate, .45),
        stability: number(bundleRow.stability, 1),
        retrievability: number(bundleRow.retrievability, .65),
        transferScore: number(bundleRow.transfer_score),
        evidenceCount: number(bundleRow.evidence_count),
        lastPracticedAt: nullableNumber(bundleRow.last_practiced_at),
        nextReviewAt: nullableNumber(bundleRow.next_review_at),
        uncertainty: number(bundleRow.uncertainty, 1),
      } : initialReviewSkillState()
      const nextBundle = applyReviewRating(previousBundle, input.rating, context.difficulty, reviewedAt)
      await execute(`UPDATE skill_bundle_states SET
        mastery_estimate=$1, stability=$2, retrievability=$3, transfer_score=$4,
        evidence_count=$5, last_practiced_at=$6, next_review_at=$7,
        uncertainty=$8, scheduler_version=1, updated_at=$9
        WHERE subject=$10 AND skill_bundle_id=$11`, [
        nextBundle.masteryEstimate, nextBundle.stability, nextBundle.retrievability,
        nextBundle.transferScore, nextBundle.evidenceCount, nextBundle.lastPracticedAt,
        nextBundle.nextReviewAt, nextBundle.uncertainty, reviewedAt, context.subject, context.skill_bundle_id,
      ])
      await execute(`INSERT INTO horizon_review_logs (
        id, review_attempt_id, subject, skill_bundle_id, rating,
        previous_state_json, evidence_json, new_state_json, scheduler_version, reviewed_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [
        uuid(), attemptId, context.subject, context.skill_bundle_id, input.rating,
        JSON.stringify(previousBundle), JSON.stringify(evidence), JSON.stringify(nextBundle),
        REVIEW_SCHEDULER_VERSION, reviewedAt,
      ])
      await execute(`UPDATE review_modules SET status='completed', completed_at=$1 WHERE id=$2`, [reviewedAt, context.module_id])
      const pending = (await select<Array<{ count: number }>>(
        `SELECT COUNT(*) AS count FROM review_modules WHERE session_id=$1 AND status='pending'`, [context.session_id],
      ))[0]?.count ?? 0
      await execute(`UPDATE review_sessions SET status=$1, completed_at=$2 WHERE id=$3`, [
        number(pending) === 0 ? 'completed' : 'in_progress', number(pending) === 0 ? reviewedAt : null, context.session_id,
      ])
      await execute('COMMIT')
      return true
    } catch (error) {
      try { await execute('ROLLBACK') } catch { /* original error wins */ }
      throw error
    }
  })
}

export async function deferTodayReviewUnit(moduleId: string) {
  await execute(`UPDATE review_modules SET status='deferred' WHERE id=$1 AND status='pending'`, [moduleId])
}

async function extendTodayPlan(input: { timestamp: number; replaceModuleId?: string }) {
  const sessionDate = localReviewDate(input.timestamp)
  const [session, candidates] = await Promise.all([findTodaySession(sessionDate), listReviewCandidates()])
  if (!session) return getOrCreateTodayPlan(input.timestamp)
  const current = await readTodayPlanBySession(session)
  const existingKeys = new Set(current.units.map((unit) => unit.canonicalKey))
  const existingProblems = new Set(current.units.map((unit) => unit.question.sourceProblemId))
  const candidatesToPlan = candidates.filter((candidate) => !existingProblems.has(candidate.problemId))
  const nextUnit = buildTodayReviewUnits(candidatesToPlan, { now: input.timestamp })
    .find((unit) => !existingKeys.has(unit.canonicalKey))
  if (!nextUnit) return current

  return withTransactionLock(async () => {
    await execute('BEGIN IMMEDIATE')
    try {
      if (input.replaceModuleId) {
        await execute(`UPDATE review_modules SET status='deferred' WHERE id=$1 AND session_id=$2 AND status='pending'`, [input.replaceModuleId, session.id])
      }
      const order = (await select<Array<{ next_order: number }>>(
        'SELECT COALESCE(MAX(order_index), -1) + 1 AS next_order FROM review_modules WHERE session_id=$1',
        [session.id],
      ))[0]?.next_order ?? current.units.length
      await persistUnit(session.id, nextUnit, number(order), input.timestamp)
      await execute(`UPDATE review_sessions SET
        status='in_progress', planned_problem_count=planned_problem_count+1,
        estimated_duration_seconds=estimated_duration_seconds+$1, completed_at=NULL
        WHERE id=$2`, [nextUnit.estimatedDurationSeconds, session.id])
      await execute('COMMIT')
      const refreshed = await findTodaySession(sessionDate)
      if (!refreshed) throw new Error('扩展后的今日计划无法读取')
      return readTodayPlanBySession(refreshed)
    } catch (error) {
      try { await execute('ROLLBACK') } catch { /* original error wins */ }
      throw error
    }
  })
}

export function addTodayReviewUnit(timestamp = Date.now()) {
  return extendTodayPlan({ timestamp })
}

export function replaceTodayReviewUnit(moduleId: string, timestamp = Date.now()) {
  return extendTodayPlan({ timestamp, replaceModuleId: moduleId })
}

export async function refreshTodayPlan(timestamp = Date.now()) {
  const session = await findTodaySession(localReviewDate(timestamp))
  return session ? readTodayPlanBySession(session) : getOrCreateTodayPlan(timestamp)
}

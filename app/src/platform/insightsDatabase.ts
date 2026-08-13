import { invoke } from '@tauri-apps/api/core'
import type { DifficultyLevel, HorizonTagType } from '../domain/models'
import {
  buildReviewInsights,
  type BundleMasteryChange,
  type InsightRangeDays,
  type InsightSkill,
  type ReviewInsightRecord,
} from '../domain/reviewInsights'
import { addLocalReviewDays, initialReviewSkillState, localReviewDate, startOfLocalReviewDay, type ReviewRating, type ReviewTag } from '../domain/review'

const select = <T>(sql: string, params: unknown[] = []) => invoke<T>('db_select', { sql, params })
const num = (value: unknown, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback
const nullable = (value: unknown) => value == null ? null : num(value)
function parse<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') return fallback
  try { return JSON.parse(value) as T } catch { return fallback }
}

interface RecordRow {
  module_id: string
  session_date: string
  status: ReviewInsightRecord['status']
  completed_at: number | null
  source_problem_id: string
  rating: ReviewRating | null
  target_tags_json: string
}

interface SkillRow {
  subject: string
  tag_id: string
  canonical_name: string
  tag_type: Extract<HorizonTagType, 'knowledge' | 'method' | 'model'>
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

interface ChangeRow { log_id: string; reviewed_at: number; previous_state_json: string; new_state_json: string }

export async function getReviewInsights(rangeDays: InsightRangeDays, now = Date.now()) {
  const fromStart = addLocalReviewDays(startOfLocalReviewDay(now), -(rangeDays - 1))
  const fromDate = localReviewDate(fromStart)
  const toDate = localReviewDate(now)
  const [rows, skillRows, changeRows] = await Promise.all([
    select<RecordRow[]>(`
      SELECT module.id AS module_id, session.session_date, module.status,
        module.completed_at, instance.source_problem_id,
        CASE WHEN attempt.evidence_source='practice_attempt' AND effective.effective_grading_json IS NOT NULL
          THEN CASE json_extract(effective.effective_grading_json, '$.correctness')
            WHEN 'correct' THEN 'good' WHEN 'partial' THEN 'hard' ELSE 'again' END
          ELSE attempt.rating END AS rating,
        instance.target_tags_json
      FROM review_modules module
      JOIN review_sessions session ON session.id = module.session_id
      JOIN question_instances instance ON instance.review_module_id = module.id
      LEFT JOIN review_attempts attempt ON attempt.question_instance_id = instance.id
      LEFT JOIN practice_evidences practice_evidence ON practice_evidence.review_attempt_id=attempt.id
      LEFT JOIN practice_effective_responses effective ON effective.response_id=practice_evidence.practice_response_id
      WHERE session.session_date BETWEEN $1 AND $2
      ORDER BY session.session_date, module.order_index, module.id
    `, [fromDate, toDate]),
    select<SkillRow[]>(`
      SELECT state.subject, state.tag_id, COALESCE(definition.canonical_name, state.tag_id) AS canonical_name,
        definition.tag_type, state.mastery_estimate, state.stability, state.retrievability,
        state.evidence_count, state.success_count, state.failure_count, state.transfer_score,
        state.max_stable_difficulty, state.last_practiced_at, state.next_review_at, state.uncertainty
      FROM skill_states state
      JOIN tag_definitions definition ON definition.id = state.tag_id AND definition.subject = state.subject
      WHERE definition.tag_type IN ('knowledge', 'method', 'model')
      ORDER BY state.subject, definition.tag_type, definition.canonical_name
    `),
    select<ChangeRow[]>(`
      SELECT log.id AS log_id, log.reviewed_at, log.previous_state_json,
        CASE WHEN attempt.evidence_source='practice_attempt' AND effective.effective_grading_json IS NOT NULL
          THEN json_set(log.new_state_json, '$.effectiveRating',
            CASE json_extract(effective.effective_grading_json, '$.correctness')
              WHEN 'correct' THEN 'good' WHEN 'partial' THEN 'hard' ELSE 'again' END)
          ELSE log.new_state_json END AS new_state_json
      FROM horizon_review_logs log
      JOIN review_attempts attempt ON attempt.id=log.review_attempt_id
      LEFT JOIN practice_evidences practice_evidence ON practice_evidence.review_attempt_id=attempt.id
      LEFT JOIN practice_effective_responses effective ON effective.response_id=practice_evidence.practice_response_id
      WHERE log.reviewed_at >= $1
      ORDER BY log.reviewed_at, log.id
    `, [fromStart]),
  ])

  const records: ReviewInsightRecord[] = rows.map((row) => {
    const snapshot = parse<{ tags?: ReviewTag[]; errorCategories?: ReviewTag[] }>(row.target_tags_json, {})
    return {
      moduleId: row.module_id, sessionDate: row.session_date, status: row.status,
      completedAt: nullable(row.completed_at), sourceProblemId: row.source_problem_id,
      rating: row.rating, tags: snapshot.tags ?? [], errorCategories: snapshot.errorCategories ?? [],
    }
  })
  const skills: InsightSkill[] = skillRows.map((row) => ({
    subject: row.subject, tagId: row.tag_id, name: row.canonical_name, type: row.tag_type,
    state: {
      ...initialReviewSkillState(), masteryEstimate: num(row.mastery_estimate, .45),
      stability: num(row.stability, 1), retrievability: num(row.retrievability, .65),
      evidenceCount: num(row.evidence_count), successCount: num(row.success_count), failureCount: num(row.failure_count),
      transferScore: num(row.transfer_score), maxStableDifficulty: row.max_stable_difficulty,
      lastPracticedAt: nullable(row.last_practiced_at), nextReviewAt: nullable(row.next_review_at),
      uncertainty: num(row.uncertainty, 1),
    },
  }))
  const changes: BundleMasteryChange[] = changeRows.flatMap((row) => {
    const previous = parse<{ masteryEstimate?: number }>(row.previous_state_json, {})
    const next = parse<{ masteryEstimate?: number }>(row.new_state_json, {})
    return Number.isFinite(previous.masteryEstimate) && Number.isFinite(next.masteryEstimate) ? [{
      logId: row.log_id, reviewedAt: num(row.reviewed_at), previousMastery: num(previous.masteryEstimate), newMastery: num(next.masteryEstimate),
    }] : []
  })
  return buildReviewInsights({ records, skills, changes, rangeDays, now })
}

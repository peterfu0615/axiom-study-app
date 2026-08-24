import { invoke } from '@tauri-apps/api/core'
import {
  REVIEW_SCHEDULER_VERSION,
  convertReviewStateV1ToV2,
  initialReviewSkillStateV1,
  type ReviewSkillState,
} from '../domain/review'
import type { DifficultyLevel } from '../domain/models'
import { getReviewPreferences } from './reviewPreferencesDatabase'
import { withTransactionLock } from './transactionLock'
import { notifyLearningStateChanged } from './learningStateEvents'

interface ExecuteResult { rowsAffected: number; lastInsertId: number }
const execute = (sql: string, params: unknown[] = []) => invoke<ExecuteResult>('db_execute', { sql, params })
const select = <T>(sql: string, params: unknown[] = []) => invoke<T>('db_select', { sql, params })

interface StateRow {
  subject: string; entity_id: string; mastery_estimate: number; stability: number
  retrievability: number; evidence_count: number; success_count?: number; failure_count?: number
  transfer_score: number; max_stable_difficulty?: DifficultyLevel | null
  last_practiced_at: number | null; next_review_at: number | null; uncertainty: number
  scheduler_version: string | number
}

const num = (value: unknown, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback
const stateFromRow = (row: StateRow): ReviewSkillState => ({
  ...initialReviewSkillStateV1(), masteryEstimate: num(row.mastery_estimate, .45),
  stability: num(row.stability, 1), retrievability: num(row.retrievability, .65),
  evidenceCount: num(row.evidence_count), successCount: num(row.success_count),
  failureCount: num(row.failure_count), transferScore: num(row.transfer_score),
  maxStableDifficulty: row.max_stable_difficulty ?? null,
  lastPracticedAt: row.last_practiced_at == null ? null : num(row.last_practiced_at),
  nextReviewAt: row.next_review_at == null ? null : num(row.next_review_at),
  uncertainty: num(row.uncertainty, 1),
})

export async function migrateReviewSchedulerState(now = Date.now()) {
  const { targetRetention } = await getReviewPreferences()
  const [skills, bundles] = await Promise.all([
    select<StateRow[]>(`SELECT subject,tag_id AS entity_id,mastery_estimate,stability,retrievability,
      evidence_count,success_count,failure_count,transfer_score,max_stable_difficulty,
      last_practiced_at,next_review_at,uncertainty,scheduler_version
      FROM skill_states WHERE CAST(scheduler_version AS TEXT)!=$1`, [REVIEW_SCHEDULER_VERSION]),
    select<StateRow[]>(`SELECT subject,skill_bundle_id AS entity_id,mastery_estimate,stability,retrievability,
      evidence_count,transfer_score,last_practiced_at,next_review_at,uncertainty,scheduler_version
      FROM skill_bundle_states WHERE CAST(scheduler_version AS TEXT)!=$1`, [REVIEW_SCHEDULER_VERSION]),
  ])
  if (!skills.length && !bundles.length) return 0
  await withTransactionLock(async () => {
    await execute('BEGIN IMMEDIATE')
    try {
      for (const [kind, rows] of [['skill', skills], ['bundle', bundles]] as const) {
        for (const row of rows) {
          const previous = stateFromRow(row)
          const next = convertReviewStateV1ToV2(previous, now, targetRetention)
          if (kind === 'skill') {
            await execute(`UPDATE skill_states SET stability=$1,retrievability=$2,next_review_at=$3,
              scheduler_version=$4,updated_at=$5 WHERE subject=$6 AND tag_id=$7`, [
              next.stability, next.retrievability, next.nextReviewAt, REVIEW_SCHEDULER_VERSION,
              now, row.subject, row.entity_id,
            ])
          } else {
            await execute(`UPDATE skill_bundle_states SET stability=$1,retrievability=$2,next_review_at=$3,
              scheduler_version=$4,updated_at=$5 WHERE subject=$6 AND skill_bundle_id=$7`, [
              next.stability, next.retrievability, next.nextReviewAt, REVIEW_SCHEDULER_VERSION,
              now, row.subject, row.entity_id,
            ])
          }
          const fromVersion = String(row.scheduler_version) === '1' ? 'horizon-v1' : String(row.scheduler_version)
          await execute(`INSERT OR IGNORE INTO review_scheduler_migrations(
            id,state_kind,subject,entity_id,from_version,to_version,previous_state_json,new_state_json,migrated_at
          ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [
            crypto.randomUUID(), kind, row.subject, row.entity_id, fromVersion,
            REVIEW_SCHEDULER_VERSION, JSON.stringify(previous), JSON.stringify(next), now,
          ])
        }
      }
      await execute('COMMIT')
    } catch (error) {
      try { await execute('ROLLBACK') } catch { /* preserve original error */ }
      throw error
    }
  })
  notifyLearningStateChanged('scheduler_migrated')
  return skills.length + bundles.length
}

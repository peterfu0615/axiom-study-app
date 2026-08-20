import { invoke } from '@tauri-apps/api/core'
import {
  canTransitionReviewSession,
  defaultReviewSessionSettings,
  localReviewDate,
  type ReviewSessionMode,
  type ReviewSessionSettings,
  type ReviewSessionStatus,
} from '../domain/review'
import { withTransactionLock } from './transactionLock'

interface ExecuteResult { rowsAffected: number; lastInsertId: number }
const execute = (sql: string, params: unknown[] = []) => invoke<ExecuteResult>('db_execute', { sql, params })
const select = <T>(sql: string, params: unknown[] = []) => invoke<T>('db_select', { sql, params })
const uuid = () => crypto.randomUUID()

export interface PracticeReviewSession {
  id: string
  mode: ReviewSessionMode
  status: ReviewSessionStatus
  settings: ReviewSessionSettings
  createdAt: number
}

export async function createPracticeReviewSession(input: {
  mode?: ReviewSessionMode
  itemCount: number
  estimatedDurationSeconds: number
  settings?: Partial<ReviewSessionSettings>
  createdAt?: number
}): Promise<PracticeReviewSession> {
  const mode = input.mode ?? 'standard'
  const createdAt = input.createdAt ?? Date.now()
  const settings = { ...defaultReviewSessionSettings(mode, input.itemCount), ...input.settings, mode }
  const id = uuid()
  return withTransactionLock(async () => {
    await execute('BEGIN IMMEDIATE')
    try {
      await execute(`INSERT INTO review_sessions(
        id,session_date,status,mode,planned_problem_count,estimated_duration_seconds,
        session_kind,settings_json,created_at,updated_at
      ) VALUES($1,$2,'draft',$3,$4,$5,'practice',$6,$7,$7)`, [
        id, localReviewDate(createdAt), mode, input.itemCount,
        Math.max(0, Math.round(input.estimatedDurationSeconds)), JSON.stringify(settings), createdAt,
      ])
      await execute(`INSERT INTO review_session_events(
        id,review_session_id,from_status,to_status,safe_code,metadata_json,created_at
      ) VALUES($1,$2,NULL,'draft','practice_created',$3,$4)`, [
        uuid(), id, JSON.stringify({ mode, itemCount: input.itemCount }), createdAt,
      ])
      await execute('COMMIT')
      return { id, mode, status: 'draft', settings, createdAt }
    } catch (error) {
      try { await execute('ROLLBACK') } catch { /* original error wins */ }
      throw error
    }
  })
}

export async function transitionPracticeReviewSession(input: {
  sessionId: string
  to: ReviewSessionStatus
  safeCode?: string | null
  metadata?: Record<string, unknown>
  occurredAt?: number
}) {
  return withTransactionLock(async () => {
    await execute('BEGIN IMMEDIATE')
    try {
      const row = (await select<Array<{ status: string; session_kind: string }>>(
        'SELECT status,session_kind FROM review_sessions WHERE id=$1 LIMIT 1', [input.sessionId],
      ))[0]
      if (!row || row.session_kind !== 'practice') throw new Error('找不到对应的练习会话')
      const from = row.status as ReviewSessionStatus
      if (!canTransitionReviewSession(from, input.to)) throw new Error(`练习会话不能从 ${from} 进入 ${input.to}`)
      if (from === input.to) { await execute('COMMIT'); return false }
      const occurredAt = input.occurredAt ?? Date.now()
      const failureCode = input.to.endsWith('_failed') ? input.safeCode ?? input.to : null
      await execute(`UPDATE review_sessions SET status=$1,updated_at=$2,
        submitted_at=CASE WHEN $1='submitted' THEN $2 ELSE submitted_at END,
        applied_at=CASE WHEN $1='applied' THEN $2 ELSE applied_at END,
        completed_at=CASE WHEN $1='completed' THEN $2 ELSE completed_at END,
        failure_code=$3 WHERE id=$4`, [input.to, occurredAt, failureCode, input.sessionId])
      await execute(`INSERT INTO review_session_events(
        id,review_session_id,from_status,to_status,safe_code,metadata_json,created_at
      ) VALUES($1,$2,$3,$4,$5,$6,$7)`, [
        uuid(), input.sessionId, from, input.to, input.safeCode ?? null,
        JSON.stringify(input.metadata ?? {}), occurredAt,
      ])
      await execute('COMMIT')
      return true
    } catch (error) {
      try { await execute('ROLLBACK') } catch { /* original error wins */ }
      throw error
    }
  })
}

export async function transitionPracticeSessionForSet(practiceSetId: string, input: {
  to: ReviewSessionStatus
  safeCode?: string | null
  metadata?: Record<string, unknown>
}) {
  const row = (await select<Array<{ review_session_id: string | null }>>(
    'SELECT review_session_id FROM practice_sets WHERE id=$1 LIMIT 1', [practiceSetId],
  ))[0]
  if (!row?.review_session_id) return false
  return transitionPracticeReviewSession({ sessionId: row.review_session_id, ...input })
}

import { invoke } from '@tauri-apps/api/core'
import type { ReviewSessionMode } from '../domain/review'
import { withTransactionLock } from './transactionLock'

interface ExecuteResult { rowsAffected: number; lastInsertId: number }
const execute = (sql: string, params: unknown[] = []) => invoke<ExecuteResult>('db_execute', { sql, params })
const select = <T>(sql: string, params: unknown[] = []) => invoke<T>('db_select', { sql, params })
const uuid = () => crypto.randomUUID()

export type PracticePreparationPhase = 'selecting' | 'generating' | 'verifying' | 'rendering' | 'ready' | 'failed'
export type PracticePreparationSlotStatus = PracticePreparationPhase

export interface PracticePreparationSlotSnapshot {
  id: string
  orderIndex: number
  sourceRef: string
  status: PracticePreparationSlotStatus
  sourceProblemId: string | null
  variantPlanId: string | null
  safeErrorCode: string | null
}

export interface PracticePreparationSnapshot {
  id: string
  sourceType: 'today' | 'review_unit' | 'skill'
  sourceRef: string
  sessionMode: ReviewSessionMode
  status: PracticePreparationPhase
  totalSlots: number
  practiceSetId: string | null
  safeErrorCode: string | null
  errorMessage: string | null
  slots: PracticePreparationSlotSnapshot[]
  updatedAt: number
}

export const PRACTICE_PREPARATION_EVENT = 'axiom:practice-preparation'

interface JobRow {
  id: string; source_type: PracticePreparationSnapshot['sourceType']; source_ref: string
  session_mode: ReviewSessionMode; status: PracticePreparationPhase; total_slots: number
  practice_set_id: string | null; safe_error_code: string | null; error_message: string | null; updated_at: number
}
interface SlotRow {
  id: string; order_index: number; source_ref: string; status: PracticePreparationSlotStatus
  source_problem_id: string | null; variant_plan_id: string | null; safe_error_code: string | null
}

async function readSnapshot(row: JobRow): Promise<PracticePreparationSnapshot> {
  const slots = await select<SlotRow[]>(`SELECT id,order_index,source_ref,status,source_problem_id,
    variant_plan_id,safe_error_code FROM practice_preparation_slots
    WHERE preparation_id=$1 ORDER BY order_index,id`, [row.id])
  return {
    id: row.id, sourceType: row.source_type, sourceRef: row.source_ref,
    sessionMode: row.session_mode, status: row.status, totalSlots: Number(row.total_slots),
    practiceSetId: row.practice_set_id, safeErrorCode: row.safe_error_code,
    errorMessage: row.error_message, updatedAt: Number(row.updated_at),
    slots: slots.map((slot) => ({
      id: slot.id, orderIndex: Number(slot.order_index), sourceRef: slot.source_ref,
      status: slot.status, sourceProblemId: slot.source_problem_id,
      variantPlanId: slot.variant_plan_id, safeErrorCode: slot.safe_error_code,
    })),
  }
}

function emit(snapshot: PracticePreparationSnapshot) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(PRACTICE_PREPARATION_EVENT, { detail: snapshot }))
  }
  return snapshot
}

export async function getActivePracticePreparation(
  sourceType: PracticePreparationSnapshot['sourceType'],
  sourceRef: string,
  sessionMode: ReviewSessionMode,
) {
  const row = (await select<JobRow[]>(`SELECT * FROM practice_preparations
    WHERE source_type=$1 AND source_ref=$2 AND session_mode=$3
      AND status IN ('selecting','generating','verifying','rendering')
    ORDER BY updated_at DESC LIMIT 1`, [sourceType, sourceRef, sessionMode]))[0]
  return row ? readSnapshot(row) : null
}

export async function createOrResumePracticePreparation(input: {
  sourceType: PracticePreparationSnapshot['sourceType']
  sourceRef: string
  sessionMode: ReviewSessionMode
  slotRefs: string[]
}) {
  const existing = await getActivePracticePreparation(input.sourceType, input.sourceRef, input.sessionMode)
  if (existing) return existing
  const now = Date.now()
  const id = uuid()
  return withTransactionLock(async () => {
    await execute('BEGIN IMMEDIATE')
    try {
      await execute(`INSERT OR IGNORE INTO practice_preparations(
        id,source_type,source_ref,session_mode,status,total_slots,created_at,updated_at
      ) VALUES($1,$2,$3,$4,'selecting',$5,$6,$6)`, [
        id, input.sourceType, input.sourceRef, input.sessionMode, input.slotRefs.length, now,
      ])
      const row = (await select<JobRow[]>(`SELECT * FROM practice_preparations
        WHERE source_type=$1 AND source_ref=$2 AND session_mode=$3
          AND status IN ('selecting','generating','verifying','rendering')
        ORDER BY updated_at DESC LIMIT 1`, [input.sourceType, input.sourceRef, input.sessionMode]))[0]
      if (!row) throw new Error('练习准备作业创建后无法读取')
      if (row.id === id) {
        for (const [index, sourceRef] of input.slotRefs.entries()) {
          await execute(`INSERT INTO practice_preparation_slots(
            id,preparation_id,order_index,source_ref,status,updated_at
          ) VALUES($1,$2,$3,$4,'selecting',$5)`, [uuid(), id, index, sourceRef, now])
        }
      }
      await execute('COMMIT')
      return emit(await readSnapshot(row))
    } catch (error) {
      try { await execute('ROLLBACK') } catch { /* preserve original error */ }
      throw error
    }
  })
}

export async function updatePracticePreparationPhase(id: string, status: Exclude<PracticePreparationPhase, 'ready' | 'failed'>) {
  const now = Date.now()
  await execute(`UPDATE practice_preparations SET status=$1,safe_error_code=NULL,error_message=NULL,updated_at=$2
    WHERE id=$3 AND status NOT IN ('ready','failed','cancelled')`, [status, now, id])
  await execute(`UPDATE practice_preparation_slots SET status=$1,updated_at=$2
    WHERE preparation_id=$3 AND status NOT IN ('ready','failed')`, [status, now, id])
  const row = (await select<JobRow[]>('SELECT * FROM practice_preparations WHERE id=$1 LIMIT 1', [id]))[0]
  if (!row) throw new Error('练习准备作业不存在')
  return emit(await readSnapshot(row))
}

export async function claimPracticePreparation(id: string, expectedUpdatedAt: number) {
  const now = Math.max(Date.now(), expectedUpdatedAt + 1)
  const claimed = await execute(`UPDATE practice_preparations SET status='generating',updated_at=$1
    WHERE id=$2 AND updated_at=$3 AND status IN ('selecting','generating','verifying','rendering')`, [
    now, id, expectedUpdatedAt,
  ])
  if (claimed.rowsAffected !== 1) return null
  await execute(`UPDATE practice_preparation_slots SET status='generating',updated_at=$1
    WHERE preparation_id=$2 AND status NOT IN ('ready','failed')`, [now, id])
  const row = (await select<JobRow[]>('SELECT * FROM practice_preparations WHERE id=$1 LIMIT 1', [id]))[0]
  if (!row) return null
  return emit(await readSnapshot(row))
}

export async function completePracticePreparation(id: string, practiceSetId: string) {
  const now = Date.now()
  await execute(`UPDATE practice_preparations SET status='ready',practice_set_id=$1,
    safe_error_code=NULL,error_message=NULL,updated_at=$2 WHERE id=$3`, [practiceSetId, now, id])
  await execute(`UPDATE practice_preparation_slots SET status='ready',updated_at=$1
    WHERE preparation_id=$2 AND status!='failed'`, [now, id])
  const row = (await select<JobRow[]>('SELECT * FROM practice_preparations WHERE id=$1 LIMIT 1', [id]))[0]
  if (!row) throw new Error('练习准备作业不存在')
  return emit(await readSnapshot(row))
}

export async function failPracticePreparation(id: string, error: unknown) {
  const now = Date.now()
  const message = String(error instanceof Error ? error.message : error).slice(0, 1000)
  await execute(`UPDATE practice_preparations SET status='failed',safe_error_code='practice_preparation_failed',
    error_message=$1,updated_at=$2 WHERE id=$3 AND status!='ready'`, [message, now, id])
  await execute(`UPDATE practice_preparation_slots SET status='failed',safe_error_code='practice_preparation_failed',
    updated_at=$1 WHERE preparation_id=$2 AND status!='ready'`, [now, id])
}

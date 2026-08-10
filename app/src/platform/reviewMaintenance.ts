import { invoke } from '@tauri-apps/api/core'
import type { DifficultyLevel } from '../domain/models'
import { initialReviewSkillState, type ReviewRating, type ReviewSkillState } from '../domain/review'
import {
  previewReviewStateReplay,
  type CurrentReplayState,
  type ExpectedReplayState,
  type ReviewReplayEvent,
  type ReviewReplayPreview,
} from '../domain/reviewReplay'
import { withTransactionLock } from './transactionLock'

interface ExecuteResult { rowsAffected: number; lastInsertId: number }
const execute = (sql: string, params: unknown[] = []) => invoke<ExecuteResult>('db_execute', { sql, params })
const select = <T>(sql: string, params: unknown[] = []) => invoke<T>('db_select', { sql, params })
const uuid = () => crypto.randomUUID()
const num = (value: unknown, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback
const nullable = (value: unknown) => value == null ? null : num(value)

interface ReplayRow {
  log_id: string
  reviewed_at: number
  subject: string
  skill_bundle_id: string
  rating: ReviewRating
  difficulty: DifficultyLevel
  previous_state_json: string
  tag_id: string | null
}

interface StateRow {
  subject: string
  entity_id: string
  mastery_estimate: number
  stability: number
  retrievability: number
  evidence_count: number
  success_count?: number
  failure_count?: number
  transfer_score: number
  max_stable_difficulty?: DifficultyLevel | null
  last_practiced_at: number | null
  next_review_at: number | null
  uncertainty: number
  scheduler_version: string | number
}

function parseState(value: string): ReviewSkillState | null {
  try {
    const parsed = JSON.parse(value) as Partial<ReviewSkillState>
    if (!Number.isFinite(parsed.evidenceCount)) return null
    return { ...initialReviewSkillState(), ...parsed }
  } catch { return null }
}

function stateFromRow(row: StateRow): ReviewSkillState {
  return {
    masteryEstimate: num(row.mastery_estimate, .45), stability: num(row.stability, 1),
    retrievability: num(row.retrievability, .65), evidenceCount: num(row.evidence_count),
    successCount: num(row.success_count), failureCount: num(row.failure_count),
    transferScore: num(row.transfer_score), maxStableDifficulty: row.max_stable_difficulty ?? null,
    lastPracticedAt: nullable(row.last_practiced_at), nextReviewAt: nullable(row.next_review_at),
    uncertainty: num(row.uncertainty, 1),
  }
}

async function loadReplayEvents(): Promise<ReviewReplayEvent[]> {
  const rows = await select<ReplayRow[]>(`
    SELECT log.id AS log_id, log.reviewed_at, log.subject, log.skill_bundle_id,
      log.rating, log.previous_state_json, instance.difficulty, evidence.tag_id
    FROM horizon_review_logs log
    JOIN review_attempts attempt ON attempt.id = log.review_attempt_id
    JOIN question_instances instance ON instance.id = attempt.question_instance_id
    LEFT JOIN tag_evidences evidence ON evidence.review_attempt_id = attempt.id
    ORDER BY log.reviewed_at, log.id, evidence.tag_id
  `)
  const events = new Map<string, ReviewReplayEvent>()
  rows.forEach((row) => {
    const existing = events.get(row.log_id)
    if (existing) {
      if (row.tag_id) existing.tagIds.push(row.tag_id)
      return
    }
    events.set(row.log_id, {
      logId: row.log_id, reviewedAt: num(row.reviewed_at), subject: row.subject,
      skillBundleId: row.skill_bundle_id, rating: row.rating,
      difficulty: row.difficulty ?? 'intermediate', tagIds: row.tag_id ? [row.tag_id] : [],
      previousBundleState: parseState(row.previous_state_json),
    })
  })
  return [...events.values()]
}

async function loadCurrentStates(): Promise<CurrentReplayState[]> {
  const [skills, bundles] = await Promise.all([
    select<StateRow[]>(`SELECT subject, tag_id AS entity_id, mastery_estimate, stability,
      retrievability, evidence_count, success_count, failure_count, transfer_score,
      max_stable_difficulty, last_practiced_at, next_review_at, uncertainty, scheduler_version
      FROM skill_states`),
    select<StateRow[]>(`SELECT subject, skill_bundle_id AS entity_id, mastery_estimate, stability,
      retrievability, evidence_count, transfer_score, last_practiced_at, next_review_at,
      uncertainty, scheduler_version FROM skill_bundle_states`),
  ])
  return [
    ...skills.map((row): CurrentReplayState => ({
      kind: 'skill', key: `skill:${row.subject}:${row.entity_id}`, subject: row.subject,
      entityId: row.entity_id, state: stateFromRow(row), schedulerVersion: String(row.scheduler_version),
    })),
    ...bundles.map((row): CurrentReplayState => ({
      kind: 'bundle', key: `bundle:${row.subject}:${row.entity_id}`, subject: row.subject,
      entityId: row.entity_id, state: stateFromRow(row),
      schedulerVersion: String(row.scheduler_version) === '1' ? 'horizon-v1' : String(row.scheduler_version),
    })),
  ]
}

async function immutableFingerprint() {
  const [logs, attempts] = await Promise.all([
    select<Array<{ id: string; reviewed_at: number }>>('SELECT id, reviewed_at FROM horizon_review_logs ORDER BY id'),
    select<Array<{ id: string; result_key: string | null }>>('SELECT id, result_key FROM review_attempts ORDER BY id'),
  ])
  return JSON.stringify({ logs, attempts })
}

export async function previewLearningState(): Promise<ReviewReplayPreview> {
  const [events, states] = await Promise.all([loadReplayEvents(), loadCurrentStates()])
  return previewReviewStateReplay(events, states)
}

async function writeExpected(item: ExpectedReplayState, now: number) {
  const state = item.state
  if (item.kind === 'skill') {
    await execute(`INSERT INTO skill_states (
      id, subject, tag_id, mastery_estimate, stability, retrievability,
      evidence_count, success_count, failure_count, transfer_score,
      max_stable_difficulty, last_practiced_at, next_review_at, uncertainty,
      scheduler_version, created_at, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'horizon-v1',$15,$15)
    ON CONFLICT(subject, tag_id) DO UPDATE SET
      mastery_estimate=excluded.mastery_estimate, stability=excluded.stability,
      retrievability=excluded.retrievability, evidence_count=excluded.evidence_count,
      success_count=excluded.success_count, failure_count=excluded.failure_count,
      transfer_score=excluded.transfer_score, max_stable_difficulty=excluded.max_stable_difficulty,
      last_practiced_at=excluded.last_practiced_at, next_review_at=excluded.next_review_at,
      uncertainty=excluded.uncertainty, scheduler_version=excluded.scheduler_version,
      updated_at=excluded.updated_at`, [
      uuid(), item.subject, item.entityId, state.masteryEstimate, state.stability,
      state.retrievability, state.evidenceCount, state.successCount, state.failureCount,
      state.transferScore, state.maxStableDifficulty, state.lastPracticedAt,
      state.nextReviewAt, state.uncertainty, now,
    ])
  } else {
    await execute(`INSERT INTO skill_bundle_states (
      subject, skill_bundle_id, mastery_estimate, stability, retrievability,
      transfer_score, evidence_count, last_practiced_at, next_review_at,
      uncertainty, scheduler_version, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11)
    ON CONFLICT(subject, skill_bundle_id) DO UPDATE SET
      mastery_estimate=excluded.mastery_estimate, stability=excluded.stability,
      retrievability=excluded.retrievability, transfer_score=excluded.transfer_score,
      evidence_count=excluded.evidence_count, last_practiced_at=excluded.last_practiced_at,
      next_review_at=excluded.next_review_at, uncertainty=excluded.uncertainty,
      scheduler_version=excluded.scheduler_version, updated_at=excluded.updated_at`, [
      item.subject, item.entityId, state.masteryEstimate, state.stability,
      state.retrievability, state.transferScore, state.evidenceCount,
      state.lastPracticedAt, state.nextReviewAt, state.uncertainty, now,
    ])
  }
}

export async function rebuildLearningState(options: { simulateFailure?: boolean } = {}) {
  return withTransactionLock(async () => {
    await execute('BEGIN IMMEDIATE')
    try {
      const beforeFingerprint = await immutableFingerprint()
      const before = await previewLearningState()
      if (before.status === 'empty') { await execute('COMMIT'); return { before, after: before } }
      const legacy = new Set(before.legacyKeys)
      const changedKeys = new Set(before.differences.filter((item) => item.kind !== 'extra').map((item) => item.key))
      for (const expected of before.expected) {
        if (changedKeys.has(expected.key) && !legacy.has(expected.key)) await writeExpected(expected, Date.now())
      }
      for (const difference of before.differences.filter((item) => item.kind === 'extra')) {
        if (difference.stateKind === 'skill') await execute('DELETE FROM skill_states WHERE subject=$1 AND tag_id=$2', difference.key.split(':').slice(1))
        else await execute('DELETE FROM skill_bundle_states WHERE subject=$1 AND skill_bundle_id=$2', difference.key.split(':').slice(1))
      }
      if (options.simulateFailure) throw new Error('模拟学习状态重建失败')
      const after = await previewLearningState()
      if (after.differences.length) throw new Error('重建后验证未通过，已取消本次修改')
      if (await immutableFingerprint() !== beforeFingerprint) throw new Error('复习历史在重建期间发生变化，已取消本次修改')
      await execute('COMMIT')
      return { before, after }
    } catch (error) {
      try { await execute('ROLLBACK') } catch { /* preserve original failure */ }
      throw error
    }
  })
}

import { invoke } from '@tauri-apps/api/core'
import type { ReviewSessionMode } from '../domain/review'
import { notifyLearningStateChanged } from './learningStateEvents'

interface ExecuteResult { rowsAffected: number; lastInsertId: number }
const execute = (sql: string, params: unknown[] = []) => invoke<ExecuteResult>('db_execute', { sql, params })
const select = <T>(sql: string, params: unknown[] = []) => invoke<T>('db_select', { sql, params })

export interface ReviewPreferences {
  maxDailyMinutes: number
  maxModules: number
  preferredMode: ReviewSessionMode
  targetRetention: number
}

export type ReviewPace = 'relaxed' | 'standard' | 'intensive'

export const REVIEW_PACE_TARGETS: Record<ReviewPace, number> = {
  relaxed: .8,
  standard: .85,
  intensive: .9,
}

export function reviewPaceFromTarget(targetRetention: number): ReviewPace {
  const entries = Object.entries(REVIEW_PACE_TARGETS) as Array<[ReviewPace, number]>
  return entries.reduce((nearest, entry) =>
    Math.abs(entry[1] - targetRetention) < Math.abs(nearest[1] - targetRetention) ? entry : nearest,
  entries[0])[0]
}

export function targetRetentionForPace(pace: ReviewPace) {
  return REVIEW_PACE_TARGETS[pace]
}

export const DEFAULT_REVIEW_PREFERENCES: ReviewPreferences = {
  maxDailyMinutes: 25,
  maxModules: 2,
  preferredMode: 'standard',
  targetRetention: .85,
}

function normalize(value: Partial<ReviewPreferences>): ReviewPreferences {
  const preferredMode = ['quick', 'standard', 'mock_test'].includes(String(value.preferredMode))
    ? value.preferredMode as ReviewSessionMode
    : DEFAULT_REVIEW_PREFERENCES.preferredMode
  return {
    maxDailyMinutes: Math.max(5, Math.min(180, Math.round(Number.isFinite(Number(value.maxDailyMinutes))
      ? Number(value.maxDailyMinutes) : DEFAULT_REVIEW_PREFERENCES.maxDailyMinutes))),
    maxModules: Math.max(1, Math.min(12, Math.round(Number.isFinite(Number(value.maxModules))
      ? Number(value.maxModules) : DEFAULT_REVIEW_PREFERENCES.maxModules))),
    preferredMode,
    targetRetention: Math.max(.75, Math.min(.95, Number.isFinite(Number(value.targetRetention))
      ? Number(value.targetRetention) : DEFAULT_REVIEW_PREFERENCES.targetRetention)),
  }
}

export async function getReviewPreferences(): Promise<ReviewPreferences> {
  const row = (await select<Array<{
    max_daily_minutes: number
    max_modules: number
    preferred_mode: ReviewSessionMode
    target_retention: number
  }>>(`SELECT max_daily_minutes,max_modules,preferred_mode,target_retention
    FROM review_preferences WHERE id='default' LIMIT 1`))[0]
  return normalize(row ? {
    maxDailyMinutes: Number(row.max_daily_minutes),
    maxModules: Number(row.max_modules),
    preferredMode: row.preferred_mode,
    targetRetention: Number(row.target_retention),
  } : DEFAULT_REVIEW_PREFERENCES)
}

export async function saveReviewPreferences(value: ReviewPreferences) {
  const next = normalize(value)
  const now = Date.now()
  await execute(`INSERT INTO review_preferences(
      id,max_daily_minutes,max_modules,preferred_mode,target_retention,variant_mode,created_at,updated_at
    ) VALUES('default',$1,$2,$3,$4,'variant_preferred',$5,$5)
    ON CONFLICT(id) DO UPDATE SET max_daily_minutes=$1,max_modules=$2,
      preferred_mode=$3,target_retention=$4,updated_at=$5`, [
    next.maxDailyMinutes, next.maxModules, next.preferredMode, next.targetRetention, now,
  ])
  notifyLearningStateChanged('review_preferences_changed')
  return next
}

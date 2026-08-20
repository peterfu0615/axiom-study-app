import { invoke } from '@tauri-apps/api/core'
import {
  GEOMETRY_SCENE_PROMPT_VERSION,
  GEOMETRY_SCENE_SCHEMA_VERSION,
} from '../ai/geometrySceneContract'
import {
  AIProviderFailure,
  getGeometrySceneProviders,
} from '../ai/provider'
import { runWithAIBackoff } from '../ai/retryPolicy'
import {
  AIExecutionError,
  classifyAIError,
  publicAIErrorMessage,
} from '../domain/aiError'
import type {
  GeometrySceneInput,
  PersistedGeometryScene,
} from '../domain/geometryScene'
import { recordProcessingModelRunOutput } from './database'
import { withTransactionLock } from './transactionLock'

interface ExecuteResult { rowsAffected: number; lastInsertId: number }
const execute = (sql: string, params: unknown[] = []) =>
  invoke<ExecuteResult>('db_execute', { sql, params })
const select = <T>(sql: string, params: unknown[] = []) =>
  invoke<T>('db_select', { sql, params })

interface GeometrySceneRow {
  id: string
  problem_id: string
  model_run_id: string
  source_image_path: string
  scene_json: string
  validation_status: 'validated' | 'rejected'
  validation_errors_json: string
  confidence: number
  created_at: number
  updated_at: number
}

const fromRow = (row: GeometrySceneRow): PersistedGeometryScene => ({
  id: row.id,
  problemId: row.problem_id,
  modelRunId: row.model_run_id,
  sourceImagePath: row.source_image_path,
  scene: JSON.parse(row.scene_json),
  validationStatus: row.validation_status,
  validationErrors: JSON.parse(row.validation_errors_json),
  confidence: Number(row.confidence),
  createdAt: Number(row.created_at),
  updatedAt: Number(row.updated_at),
})

function stableHash(input: unknown) {
  const value = JSON.stringify(input)
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`
}

export async function getLatestGeometryScene(problemId: string) {
  const row = (await select<GeometrySceneRow[]>(
    `SELECT * FROM geometry_scenes WHERE problem_id=$1
     ORDER BY created_at DESC, id DESC LIMIT 1`,
    [problemId],
  ))[0]
  return row ? fromRow(row) : null
}

export async function reconstructGeometryScene(
  input: GeometrySceneInput,
): Promise<PersistedGeometryScene> {
  const providers = getGeometrySceneProviders()
  const runId = crypto.randomUUID()
  const createdAt = Date.now()
  const first = providers[0]
  await execute(
    `INSERT INTO model_runs (
       id, problem_id, task_type, provider, model, prompt_version,
       schema_version, input_hash, input_json, status, created_at
     ) VALUES ($1,$2,'geometry_scene',$3,$4,$5,$6,$7,$8,'processing',$9)`,
    [runId, input.problemId, first.id, first.model, GEOMETRY_SCENE_PROMPT_VERSION,
      GEOMETRY_SCENE_SCHEMA_VERSION, stableHash(input), JSON.stringify(input), createdAt],
  )
  let providerId = first.id
  let model = first.model
  let lastError: unknown = null
  try {
    for (const provider of providers) {
      providerId = provider.id
      model = provider.model
      await execute(
        `UPDATE model_runs SET provider=$1, model=$2
         WHERE id=$3 AND status='processing'`,
        [providerId, model, runId],
      )
      try {
        const result = await runWithAIBackoff({
          context: { providerId, model, runId },
          operation: () => provider.extractGeometryScene(input),
          onFailure: async (error, envelope) => {
            await recordProcessingModelRunOutput(
              { id: runId, provider: providerId, model },
              error instanceof AIProviderFailure ? error.rawOutput : '',
              error instanceof AIProviderFailure ? error.repairStrategy : null,
              envelope,
              error instanceof AIProviderFailure ? error.usage : null,
            )
          },
        })
        await recordProcessingModelRunOutput(
          { id: runId, provider: providerId, model }, result.rawOutput, null,
          null, result.usage ?? null,
        )
        const now = Date.now()
        const id = crypto.randomUUID()
        await withTransactionLock(async () => {
          await execute('BEGIN IMMEDIATE')
          try {
            await execute(
              `INSERT INTO geometry_scenes (
                 id,problem_id,model_run_id,source_image_path,scene_json,
                 validation_status,validation_errors_json,confidence,created_at,updated_at
               ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)`,
              [id, input.problemId, runId, input.imagePath, JSON.stringify(result.scene),
                result.valid ? 'validated' : 'rejected', JSON.stringify(result.errors),
                result.scene.confidence, now],
            )
            await execute(
              `UPDATE model_runs SET output_json=$1,status='completed',error_message=NULL,
               latency_ms=MAX(0,$2-created_at) WHERE id=$3 AND status='processing'`,
              [JSON.stringify(result.scene), now, runId],
            )
            await execute('COMMIT')
          } catch (error) {
            try { await execute('ROLLBACK') } catch { /* original error wins */ }
            throw error
          }
        })
        const saved = await getLatestGeometryScene(input.problemId)
        if (!saved || saved.id !== id) throw new Error('几何场景保存后无法读取')
        return saved
      } catch (error) {
        lastError = error
        if (error instanceof AIExecutionError && !error.envelope.fallbackAllowed) {
          throw error
        }
      }
    }
    throw lastError ?? new Error('没有可用的几何场景 Provider')
  } catch (error) {
    const envelope = classifyAIError(error, { providerId, model, runId })
    await execute(
      `UPDATE model_runs SET status='failed',error_message=$1,error_code=$2,
       error_json=$3,latency_ms=MAX(0,$4-created_at)
       WHERE id=$5 AND status='processing'`,
      [publicAIErrorMessage(envelope), envelope.code, JSON.stringify(envelope), Date.now(), runId],
    )
    throw error
  }
}

import { invoke } from '@tauri-apps/api/core'
import { GEOMETRY_SCENE_PROMPT_VERSION, GEOMETRY_SCENE_SCHEMA_VERSION } from '../ai/geometrySceneContract'
import { AIProviderFailure, getGeometrySceneProviders } from '../ai/provider'
import { runWithAIBackoff } from '../ai/retryPolicy'
import { AIExecutionError, classifyAIError, publicAIErrorMessage } from '../domain/aiError'
import type { GeometrySceneInput, PersistedGeometryScene } from '../domain/geometryScene'
import { compileGeometrySceneToTikz } from '../domain/geometryTikz'
import { recordProcessingModelRunOutput } from './database'
import { createTikzDiagram } from './diagramDatabase'
import { withTransactionLock } from './transactionLock'

interface ExecuteResult { rowsAffected: number; lastInsertId: number }
const execute = (sql: string, params: unknown[] = []) => invoke<ExecuteResult>('db_execute', { sql, params })
const select = <T>(sql: string, params: unknown[] = []) => invoke<T>('db_select', { sql, params })

export const GEOMETRY_SCENE_STATUS_EVENT = 'axiom:geometry-scene-status'

interface GeometrySceneRow {
  id: string; problem_id: string; model_run_id: string; source_image_path: string
  scene_json: string; validation_status: 'validated' | 'rejected'; validation_errors_json: string
  confidence: number; created_at: number; updated_at: number
}

interface GeometryRunRow {
  id: string; problem_id: string; provider: string; model: string; input_json: string; created_at: number
}

const fromRow = (row: GeometrySceneRow): PersistedGeometryScene => ({
  id: row.id, problemId: row.problem_id, modelRunId: row.model_run_id,
  sourceImagePath: row.source_image_path, scene: JSON.parse(row.scene_json),
  validationStatus: row.validation_status, validationErrors: JSON.parse(row.validation_errors_json),
  confidence: Number(row.confidence), createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
})

function notifyGeometrySceneStatus(problemId: string) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(GEOMETRY_SCENE_STATUS_EVENT, { detail: { problemId } }))
  }
}

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
    `SELECT * FROM geometry_scenes WHERE problem_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1`,
    [problemId],
  ))[0]
  return row ? fromRow(row) : null
}

async function getGeometrySceneForRun(runId: string) {
  const row = (await select<GeometrySceneRow[]>(
    'SELECT * FROM geometry_scenes WHERE model_run_id=$1 LIMIT 1', [runId],
  ))[0]
  return row ? fromRow(row) : null
}

export async function queueGeometryScene(input: GeometrySceneInput, force = false) {
  const providers = getGeometrySceneProviders()
  if (!providers.length) throw new Error('没有可用的几何场景 Provider')
  const hash = stableHash(input)
  if (!force) {
    const existing = (await select<Array<{ id: string }>>(
      `SELECT run.id FROM model_runs run
       WHERE run.task_type='geometry_scene' AND run.problem_id=$1 AND run.input_hash=$2
         AND (run.status IN ('pending','processing') OR (
           run.status='completed'
           AND EXISTS(SELECT 1 FROM geometry_scenes scene WHERE scene.model_run_id=run.id AND scene.validation_status='validated')
           AND EXISTS(SELECT 1 FROM diagrams diagram WHERE diagram.owner_type='problem' AND diagram.owner_id=run.problem_id
             AND diagram.render_status='rendered' AND diagram.validation_status='validated')
         ))
       ORDER BY run.created_at DESC LIMIT 1`,
      [input.problemId, hash],
    ))[0]
    if (existing) return existing.id
  }
  const first = providers[0]
  const runId = crypto.randomUUID()
  await execute(
    `INSERT INTO model_runs (
       id,problem_id,task_type,provider,model,prompt_version,schema_version,input_hash,input_json,status,created_at
     ) VALUES ($1,$2,'geometry_scene',$3,$4,$5,$6,$7,$8,'pending',$9)`,
    [runId, input.problemId, first.id, first.model, GEOMETRY_SCENE_PROMPT_VERSION,
      GEOMETRY_SCENE_SCHEMA_VERSION, hash, JSON.stringify(input), Date.now()],
  )
  notifyGeometrySceneStatus(input.problemId)
  return runId
}

async function claimNextGeometryRun(): Promise<GeometryRunRow | null> {
  return withTransactionLock(async () => {
    await execute('BEGIN IMMEDIATE')
    try {
      const row = (await select<GeometryRunRow[]>(
        `SELECT id,problem_id,provider,model,input_json,created_at FROM model_runs
         WHERE task_type='geometry_scene' AND status='pending' ORDER BY created_at,id LIMIT 1`,
      ))[0]
      if (!row) { await execute('COMMIT'); return null }
      const claimed = await execute(
        "UPDATE model_runs SET status='processing',error_message=NULL WHERE id=$1 AND status='pending'", [row.id],
      )
      await execute('COMMIT')
      return claimed.rowsAffected === 1 ? row : null
    } catch (error) {
      try { await execute('ROLLBACK') } catch { /* preserve original error */ }
      throw error
    }
  })
}

async function processGeometryRun(run: GeometryRunRow) {
  const input = JSON.parse(run.input_json) as GeometrySceneInput
  const providers = getGeometrySceneProviders()
  let providerId = run.provider
  let model = run.model
  let lastError: unknown = null
  try {
    for (const provider of providers) {
      providerId = provider.id
      model = provider.model
      await execute("UPDATE model_runs SET provider=$1,model=$2 WHERE id=$3 AND status='processing'", [providerId, model, run.id])
      try {
        const result = await runWithAIBackoff({
          context: { providerId, model, runId: run.id },
          operation: () => provider.extractGeometryScene(input),
          onFailure: async (error, envelope) => recordProcessingModelRunOutput(
            { id: run.id, provider: providerId, model },
            error instanceof AIProviderFailure ? error.rawOutput : '',
            error instanceof AIProviderFailure ? error.repairStrategy : null,
            envelope,
            error instanceof AIProviderFailure ? error.usage : null,
          ),
        })
        await recordProcessingModelRunOutput(
          { id: run.id, provider: providerId, model }, result.rawOutput, null, null, result.usage ?? null,
        )
        if (result.valid) {
          const compiled = compileGeometrySceneToTikz(result.scene)
          await createTikzDiagram({ ownerType: 'problem', ownerId: input.problemId, ...compiled })
        }
        const now = Date.now()
        const id = crypto.randomUUID()
        await withTransactionLock(async () => {
          await execute('BEGIN IMMEDIATE')
          try {
            await execute(
              `INSERT INTO geometry_scenes (
                 id,problem_id,model_run_id,source_image_path,scene_json,validation_status,
                 validation_errors_json,confidence,created_at,updated_at
               ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)`,
              [id, input.problemId, run.id, input.imagePath, JSON.stringify(result.scene),
                result.valid ? 'validated' : 'rejected', JSON.stringify(result.errors), result.scene.confidence, now],
            )
            await execute(
              `UPDATE model_runs SET output_json=$1,status='completed',error_message=NULL,
               latency_ms=MAX(0,$2-created_at) WHERE id=$3 AND status='processing'`,
              [JSON.stringify(result.scene), now, run.id],
            )
            await execute('COMMIT')
          } catch (error) {
            try { await execute('ROLLBACK') } catch { /* preserve original error */ }
            throw error
          }
        })
        return
      } catch (error) {
        lastError = error
        if (error instanceof AIExecutionError && !error.envelope.fallbackAllowed) throw error
      }
    }
    throw lastError ?? new Error('没有可用的几何场景 Provider')
  } catch (error) {
    const envelope = classifyAIError(error, { providerId, model, runId: run.id })
    await execute(
      `UPDATE model_runs SET status='failed',error_message=$1,error_code=$2,error_json=$3,
       latency_ms=MAX(0,$4-created_at) WHERE id=$5 AND status='processing'`,
      [publicAIErrorMessage(envelope), envelope.code, JSON.stringify(envelope), Date.now(), run.id],
    )
  } finally {
    notifyGeometrySceneStatus(input.problemId)
  }
}

let activeWorker: Promise<void> | null = null
let workerRequested = false

export function runGeometrySceneWorker() {
  workerRequested = true
  activeWorker ??= (async () => {
    while (workerRequested) {
      workerRequested = false
      let run: GeometryRunRow | null
      while ((run = await claimNextGeometryRun())) await processGeometryRun(run)
    }
  })().finally(() => { activeWorker = null })
  return activeWorker
}

export async function resumeGeometryScenePipeline() {
  await execute("UPDATE model_runs SET status='pending',error_message=NULL WHERE task_type='geometry_scene' AND status='processing'")
  await runGeometrySceneWorker()
}

export async function reconstructGeometryScene(input: GeometrySceneInput): Promise<PersistedGeometryScene> {
  const runId = await queueGeometryScene(input, true)
  await runGeometrySceneWorker()
  const saved = await getGeometrySceneForRun(runId)
  if (!saved) throw new Error('几何场景生成失败，请检查 AI Provider 后重试')
  return saved
}

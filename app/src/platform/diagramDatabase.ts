import { invoke } from '@tauri-apps/api/core'
import type { Diagram, DiagramOwnerType, DiagramValidationContract, TikzRenderResult } from '../domain/diagram'
import { renderTikz } from './native'
import { withTransactionLock } from './transactionLock'

interface ExecuteResult { rowsAffected: number; lastInsertId: number }
const execute = (sql: string, params: unknown[] = []) => invoke<ExecuteResult>('db_execute', { sql, params })
const select = <T>(sql: string, params: unknown[] = []) => invoke<T>('db_select', { sql, params })

interface DiagramRow {
  id: string
  owner_type: DiagramOwnerType
  owner_id: string
  source_type: 'tikz' | 'image'
  source: string
  render_status: 'pending' | 'rendered' | 'failed'
  rendered_asset_path: string | null
  rendered_mime_type: string | null
  render_hash: string
  renderer_version: string
  render_error_code: string | null
  render_error_message: string | null
  validation_status: Diagram['validationStatus']
  validation_json: string
  contract_json: string
  width_units: number | null
  height_units: number | null
  repair_attempts: number
  created_at: number
  updated_at: number
}

function fromRow(row: DiagramRow): Diagram {
  return {
    id: row.id,
    ownerType: row.owner_type,
    ownerId: row.owner_id,
    sourceType: row.source_type,
    source: row.source,
    renderStatus: row.render_status,
    renderedAssetPath: row.rendered_asset_path,
    renderedMimeType: row.rendered_mime_type,
    renderHash: row.render_hash,
    rendererVersion: row.renderer_version,
    renderErrorCode: row.render_error_code,
    renderErrorMessage: row.render_error_message,
    validationStatus: row.validation_status,
    validationErrors: JSON.parse(row.validation_json || '{}').errors ?? [],
    contract: JSON.parse(row.contract_json || '{}'),
    width: row.width_units,
    height: row.height_units,
    repairAttempts: Number(row.repair_attempts),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}

async function persistRender(
  input: { id: string; ownerType: DiagramOwnerType; ownerId: string; source: string; createdAt: number; contract: DiagramValidationContract; repairAttempts: number },
  render: TikzRenderResult,
) {
  await execute(`INSERT INTO diagrams (
    id, owner_type, owner_id, source_type, source, render_status,
    rendered_asset_path, rendered_mime_type, render_hash, renderer_version,
    render_error_code, render_error_message, validation_status, validation_json,
    contract_json, width_units, height_units, repair_attempts, created_at, updated_at
  ) VALUES ($1,$2,$3,'tikz',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$18)`, [
    input.id, input.ownerType, input.ownerId, input.source, render.renderStatus,
    render.renderedAssetPath, render.renderedMimeType, render.renderHash,
    render.rendererVersion, render.errorCode, render.errorMessage, render.validationStatus,
    JSON.stringify({ errors: render.validationErrors, aspectRatio: render.aspectRatio, inkCoverage: render.inkCoverage }),
    JSON.stringify(input.contract), render.width, render.height, input.repairAttempts, input.createdAt,
  ])
}

const emptyContract: DiagramValidationContract = { requiredLabels: [], requiredRelations: [] }

async function renderWithRepair(input: {
  source: string
  contract: DiagramValidationContract
  repair?: (source: string, errors: string[], attempt: number) => Promise<string>
}) {
  let source = input.source
  for (let attempt = 0; attempt <= 2; attempt += 1) {
    const render = await renderTikz(source, input.contract)
    if (render.validationStatus === 'validated' || !input.repair || attempt === 2) {
      return { source, render, repairAttempts: attempt }
    }
    source = await input.repair(source, render.validationErrors, attempt + 1)
  }
  throw new Error('TikZ 修复超过重试限制')
}

export async function createTikzDiagram(input: {
  ownerType: DiagramOwnerType
  ownerId: string
  source: string
  contract?: DiagramValidationContract
  repair?: (source: string, errors: string[], attempt: number) => Promise<string>
}): Promise<Diagram> {
  const id = crypto.randomUUID()
  const createdAt = Date.now()
  const contract = input.contract ?? emptyContract
  const rendered = await renderWithRepair({ source: input.source, contract, repair: input.repair })
  await withTransactionLock(async () => {
    await execute('BEGIN IMMEDIATE')
    try {
      await persistRender({ ...input, source: rendered.source, contract, repairAttempts: rendered.repairAttempts, id, createdAt }, rendered.render)
      await execute('COMMIT')
    } catch (error) {
      try { await execute('ROLLBACK') } catch { /* original error wins */ }
      throw error
    }
  })
  const diagram = await getDiagram(id)
  if (!diagram) throw new Error('图形保存后无法读取')
  return diagram
}

export async function getDiagram(id: string) {
  const row = (await select<DiagramRow[]>('SELECT * FROM diagrams WHERE id=$1 LIMIT 1', [id]))[0]
  return row ? fromRow(row) : null
}

export async function listDiagrams(ownerType: DiagramOwnerType, ownerId: string) {
  const rows = await select<DiagramRow[]>(
    'SELECT * FROM diagrams WHERE owner_type=$1 AND owner_id=$2 ORDER BY created_at, id',
    [ownerType, ownerId],
  )
  return rows.map(fromRow)
}

export async function retryTikzDiagram(diagram: Diagram) {
  if (diagram.sourceType !== 'tikz') throw new Error('只有 TikZ 图形可以重新渲染')
  const render = await renderTikz(diagram.source, diagram.contract)
  const updatedAt = Date.now()
  await execute(`UPDATE diagrams SET render_status=$1, rendered_asset_path=$2,
    rendered_mime_type=$3, render_hash=$4, renderer_version=$5,
    render_error_code=$6, render_error_message=$7, validation_status=$8,
    validation_json=$9, width_units=$10, height_units=$11, updated_at=$12 WHERE id=$13`, [
    render.renderStatus, render.renderedAssetPath, render.renderedMimeType,
    render.renderHash, render.rendererVersion, render.errorCode,
    render.errorMessage, render.validationStatus,
    JSON.stringify({ errors: render.validationErrors, aspectRatio: render.aspectRatio, inkCoverage: render.inkCoverage }),
    render.width, render.height, updatedAt, diagram.id,
  ])
  const updated = await getDiagram(diagram.id)
  if (!updated) throw new Error('图形重新渲染后无法读取')
  return updated
}

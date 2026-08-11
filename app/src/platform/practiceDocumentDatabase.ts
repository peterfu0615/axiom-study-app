import { invoke } from '@tauri-apps/api/core'
import type { PracticeSet } from '../domain/practice'
import { buildPracticeDocument, type PracticeDocument, type PracticeDocumentType } from '../domain/practiceDocument'
import { openPracticePdf, renderPracticePdf, type PdfRenderResult } from './native'
import { withTransactionLock } from './transactionLock'

interface ExecuteResult { rowsAffected: number; lastInsertId: number }
const execute = (sql: string, params: unknown[] = []) => invoke<ExecuteResult>('db_execute', { sql, params })
const select = <T>(sql: string, params: unknown[] = []) => invoke<T>('db_select', { sql, params })
const uuid = () => crypto.randomUUID()

export interface PracticeDocumentRecord extends PdfRenderResult {
  id: string
  practiceSetId: string
  attemptId: string
  documentType: PracticeDocumentType
  layoutVersion: string
  status: 'ready'
}

async function exportAttemptId(practiceSetId: string) {
  const existing = (await select<Array<{ attempt_id: string }>>(
    "SELECT attempt_id FROM practice_documents WHERE practice_set_id=$1 AND status='ready' ORDER BY created_at DESC LIMIT 1",
    [practiceSetId],
  ))[0]
  return existing?.attempt_id ?? uuid()
}

async function hydrateDiagramAssets(practiceSet: PracticeSet): Promise<PracticeSet> {
  const items = await Promise.all(practiceSet.items.map(async (item) => {
    const generated = await select<Array<{ rendered_asset_path: string }>>(
      "SELECT rendered_asset_path FROM diagrams WHERE owner_type='practice_item' AND owner_id=$1 AND render_status='rendered' AND rendered_asset_path IS NOT NULL ORDER BY created_at, id",
      [item.id],
    )
    const paths = [...new Set([...item.diagramImagePaths, ...generated.map((row) => row.rendered_asset_path)])]
    return { ...item, diagramImagePaths: paths }
  }))
  return { ...practiceSet, items }
}

async function persistDocument(document: PracticeDocument, render: PdfRenderResult): Promise<PracticeDocumentRecord> {
  return withTransactionLock(async () => {
    await execute('BEGIN IMMEDIATE')
    try {
      const existing = (await select<Array<{ id: string; content_hash: string }>>(`SELECT id, content_hash FROM practice_documents
        WHERE practice_set_id=$1 AND attempt_id=$2 AND document_type=$3 AND layout_version=$4 LIMIT 1`,
      [document.practiceSetId, document.attemptId, document.documentType, document.layout.version]))[0]
      const now = Date.now()
      const id = existing?.id ?? uuid()
      if (existing) {
        await execute(`UPDATE practice_documents SET content_hash=$1, status='ready', file_path=$2,
          page_count=$3, metadata_json=$4, error_message=NULL, updated_at=$5 WHERE id=$6`, [
          render.contentHash, render.filePath, render.pageCount,
          JSON.stringify({ rendererVersion: render.rendererVersion, byteLength: render.byteLength }), now, id,
        ])
        await execute('DELETE FROM practice_document_pages WHERE practice_document_id=$1', [id])
      } else {
        await execute(`INSERT INTO practice_documents(id, practice_set_id, attempt_id, document_type,
          layout_version, content_hash, status, file_path, page_count, metadata_json, created_at, updated_at)
          VALUES($1,$2,$3,$4,$5,$6,'ready',$7,$8,$9,$10,$10)`, [
          id, document.practiceSetId, document.attemptId, document.documentType, document.layout.version,
          render.contentHash, render.filePath, render.pageCount, JSON.stringify({ rendererVersion: render.rendererVersion, byteLength: render.byteLength }), now,
        ])
      }
      for (const page of document.pages) {
        const pageId = uuid()
        await execute(`INSERT INTO practice_document_pages(id, practice_document_id, page_index, page_identity,
          qr_payload, width_points, height_points, created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [
          pageId, id, page.pageIndex, page.pageIdentity, page.qrPayload,
          document.layout.widthPoints, document.layout.heightPoints, now,
        ])
        for (const region of page.answerRegions) {
          await execute(`INSERT INTO practice_answer_regions(id, practice_document_page_id, practice_item_id,
            region_index, x, y, width, height, created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [
            region.id, pageId, region.practiceItemId, region.regionIndex,
            region.x, region.y, region.width, region.height, now,
          ])
        }
      }
      await execute('COMMIT')
      return { ...render, id, practiceSetId: document.practiceSetId, attemptId: document.attemptId, documentType: document.documentType, layoutVersion: document.layout.version, status: 'ready' }
    } catch (error) {
      try { await execute('ROLLBACK') } catch { /* original error wins */ }
      throw error
    }
  })
}

export async function exportPracticePdf(practiceSet: PracticeSet, documentType: PracticeDocumentType) {
  const attemptId = await exportAttemptId(practiceSet.id)
  const hydrated = await hydrateDiagramAssets(practiceSet)
  const document = buildPracticeDocument(hydrated, { attemptId, documentType, generatedAt: practiceSet.createdAt })
  return persistDocument(document, await renderPracticePdf(document))
}

export async function openExportedPracticePdf(record: PracticeDocumentRecord) {
  await openPracticePdf(record.filePath)
}

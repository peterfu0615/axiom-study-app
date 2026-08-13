import { invoke } from '@tauri-apps/api/core'
import type { PracticeSet } from '../domain/practice'
import { buildCompletePracticeDocument, type CompletePracticeDocument } from '../domain/practiceDocument'
import {
  openPracticePdf,
  practicePdfExists,
  printPracticePdf,
  renderCompletePracticePdf,
  savePracticePdf,
  type CompletePdfRenderResult,
} from './native'
import { withTransactionLock } from './transactionLock'

interface ExecuteResult { rowsAffected: number; lastInsertId: number }
const execute = (sql: string, params: unknown[] = []) => invoke<ExecuteResult>('db_execute', { sql, params })
const select = <T>(sql: string, params: unknown[] = []) => invoke<T>('db_select', { sql, params })
const uuid = () => crypto.randomUUID()

export interface PracticeDocumentRecord extends CompletePdfRenderResult {
  id: string
  practiceSetId: string
  attemptId: string
  documentType: 'complete'
  layoutVersion: string
  status: 'ready'
}

const RENDERER_CONTRACT = 'axiom-typst-v2'

function sourceHash(document: CompletePracticeDocument) {
  let hash = 2166136261
  for (const character of JSON.stringify(document)) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

async function exportAttemptId(practiceSetId: string) {
  const existing = (await select<Array<{ attempt_id: string }>>(
    `SELECT document.attempt_id FROM practice_documents document
     LEFT JOIN practice_attempts attempt ON attempt.id=document.attempt_id
     WHERE document.practice_set_id=$1 AND document.document_type='complete'
       AND document.status='ready' AND attempt.id IS NULL
     ORDER BY document.created_at DESC LIMIT 1`,
    [practiceSetId],
  ))[0]
  return existing?.attempt_id ?? uuid()
}

async function hydrateDiagramAssets(practiceSet: PracticeSet): Promise<PracticeSet> {
  const items = await Promise.all(practiceSet.items.map(async (item) => {
    const generated = await select<Array<{ rendered_asset_path: string }>>(
      "SELECT rendered_asset_path FROM diagrams WHERE owner_type='practice_item' AND owner_id=$1 AND render_status='rendered' AND validation_status='validated' AND rendered_asset_path IS NOT NULL ORDER BY created_at, id",
      [item.id],
    )
    const paths = [...new Set([...item.diagramImagePaths, ...generated.map((row) => row.rendered_asset_path)])]
    return { ...item, diagramImagePaths: paths }
  }))
  return { ...practiceSet, items }
}

async function readReadyDocument(practiceSet: PracticeSet): Promise<PracticeDocumentRecord | null> {
  const candidates = await select<Array<{
    id: string; attempt_id: string; layout_version: string; content_hash: string; file_path: string | null
    page_count: number; metadata_json: string
  }>>(`SELECT id, attempt_id, layout_version, content_hash, file_path, page_count, metadata_json
    FROM practice_documents
    WHERE practice_set_id=$1 AND document_type='complete' AND status='ready'
      AND layout_version=$2 AND file_path IS NOT NULL
    ORDER BY updated_at DESC LIMIT 3`, [practiceSet.id, 'practice-a4-v3'])
  if (!candidates.length) return null
  const hydrated = await hydrateDiagramAssets(practiceSet)
  for (const candidate of candidates) {
    let metadata: { rendererContract?: string; rendererVersion?: string; byteLength?: number; sectionPageRanges?: CompletePdfRenderResult['sectionPageRanges']; sourceHash?: string }
    try { metadata = JSON.parse(candidate.metadata_json) as typeof metadata } catch { continue }
    const document = buildCompletePracticeDocument(hydrated, { attemptId: candidate.attempt_id, generatedAt: practiceSet.createdAt })
    if (metadata.sourceHash !== sourceHash(document) || metadata.rendererContract !== RENDERER_CONTRACT || !metadata.sectionPageRanges) continue
    const rows = await select<Array<{
      page_id: string; page_index: number; page_identity: string; qr_payload: string
      width_points: number; height_points: number; region_id: string | null; practice_item_id: string | null
      region_index: number | null; x: number | null; y: number | null; width: number | null; height: number | null
    }>>(`SELECT page.id AS page_id, page.page_index, page.page_identity, page.qr_payload,
      page.width_points, page.height_points, region.id AS region_id, region.practice_item_id,
      region.region_index, region.x, region.y, region.width, region.height
      FROM practice_document_pages page
      LEFT JOIN practice_answer_regions region ON region.practice_document_page_id=page.id
      WHERE page.practice_document_id=$1 ORDER BY page.page_index, region.region_index`, [candidate.id])
    const grouped = new Map<number, CompletePdfRenderResult['pages'][number]>()
    for (const row of rows) {
      const page = grouped.get(Number(row.page_index)) ?? {
        pageIndex: Number(row.page_index), pageIdentity: row.page_identity, qrPayload: row.qr_payload,
        widthPoints: Number(row.width_points), heightPoints: Number(row.height_points), answerRegions: [],
      }
      if (row.region_id && row.practice_item_id && row.region_index !== null && row.x !== null && row.y !== null && row.width !== null && row.height !== null) {
        page.answerRegions.push({ id: row.region_id, practiceItemId: row.practice_item_id, regionIndex: Number(row.region_index), x: Number(row.x), y: Number(row.y), width: Number(row.width), height: Number(row.height) })
      }
      grouped.set(Number(row.page_index), page)
    }
    if (!grouped.size || !candidate.file_path || !(await practicePdfExists(candidate.file_path))) continue
    return {
      documentId: candidate.id, filePath: candidate.file_path, contentHash: candidate.content_hash,
      rendererVersion: metadata.rendererVersion ?? RENDERER_CONTRACT, pageCount: Number(candidate.page_count),
      byteLength: Number(metadata.byteLength ?? 0), cacheHit: true,
      sectionPageRanges: metadata.sectionPageRanges, pages: [...grouped.values()],
      id: candidate.id, practiceSetId: practiceSet.id, attemptId: candidate.attempt_id,
      documentType: 'complete', layoutVersion: candidate.layout_version, status: 'ready',
    }
  }
  return null
}

async function persistDocument(document: CompletePracticeDocument, render: CompletePdfRenderResult): Promise<PracticeDocumentRecord> {
  return withTransactionLock(async () => {
    await execute('BEGIN IMMEDIATE')
    try {
      const existing = (await select<Array<{ id: string; content_hash: string }>>(`SELECT id, content_hash FROM practice_documents
        WHERE practice_set_id=$1 AND attempt_id=$2 AND document_type=$3 AND layout_version=$4 LIMIT 1`,
      [document.practiceSetId, document.attemptId, document.documentType, document.layout.version]))[0]
      const now = Date.now()
      const id = existing?.id ?? document.id
      const replacePages = !existing || existing.content_hash !== render.contentHash
      const metadata = JSON.stringify({
        documentType: 'complete',
        rendererVersion: render.rendererVersion,
        rendererContract: RENDERER_CONTRACT,
        sourceHash: sourceHash(document),
        byteLength: render.byteLength,
        sectionPageRanges: render.sectionPageRanges,
      })
      if (existing) {
        await execute(`UPDATE practice_documents SET content_hash=$1, status='ready', file_path=$2,
          page_count=$3, metadata_json=$4, error_message=NULL, updated_at=$5 WHERE id=$6`, [
          render.contentHash, render.filePath, render.pageCount,
          metadata, now, id,
        ])
        if (replacePages) {
          await execute('DELETE FROM practice_document_pages WHERE practice_document_id=$1', [id])
        }
      } else {
        await execute(`INSERT INTO practice_documents(id, practice_set_id, attempt_id, document_type,
          layout_version, content_hash, status, file_path, page_count, metadata_json, created_at, updated_at)
          VALUES($1,$2,$3,$4,$5,$6,'ready',$7,$8,$9,$10,$10)`, [
          id, document.practiceSetId, document.attemptId, document.documentType, document.layout.version,
          render.contentHash, render.filePath, render.pageCount, metadata, now,
        ])
      }
      for (const page of replacePages ? render.pages : []) {
        const pageId = uuid()
        await execute(`INSERT INTO practice_document_pages(id, practice_document_id, page_index, page_identity,
          qr_payload, width_points, height_points, created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [
          pageId, id, page.pageIndex, page.pageIdentity, page.qrPayload,
          page.widthPoints, page.heightPoints, now,
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

export async function exportPracticePdf(practiceSet: PracticeSet) {
  const cached = await readReadyDocument(practiceSet)
  if (cached) return cached
  const attemptId = await exportAttemptId(practiceSet.id)
  const hydrated = await hydrateDiagramAssets(practiceSet)
  const document = buildCompletePracticeDocument(hydrated, { attemptId, generatedAt: practiceSet.createdAt })
  return persistDocument(document, await renderCompletePracticePdf(document))
}

export async function getLatestReadyPracticeDocument(practiceSet: PracticeSet) {
  return readReadyDocument(practiceSet)
}

export async function openExportedPracticePdf(record: PracticeDocumentRecord) {
  await openPracticePdf(record.filePath)
}

export async function saveExportedPracticePdf(record: PracticeDocumentRecord, destination: string) {
  await savePracticePdf(record.filePath, destination)
}

export async function printExportedPracticePdf(record: PracticeDocumentRecord) {
  await printPracticePdf(record.filePath)
}

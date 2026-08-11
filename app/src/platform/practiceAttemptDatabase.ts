import { invoke } from '@tauri-apps/api/core'
import type { PracticeAttempt, PracticeScanResult } from '../domain/practiceAttempt'
import { processPracticeScan, type PracticeScanLayout } from './native'
import { withTransactionLock } from './transactionLock'

interface ExecuteResult { rowsAffected: number; lastInsertId: number }
interface LayoutRow {
  attempt_id: string
  page_id: string
  page_identity: string
  qr_payload: string
  width_points: number
  height_points: number
  region_id: string | null
  practice_item_id: string | null
  region_index: number | null
  x: number | null
  y: number | null
  width: number | null
  height: number | null
}

const execute = (sql: string, params: unknown[] = []) => invoke<ExecuteResult>('db_execute', { sql, params })
const select = <T>(sql: string, params: unknown[] = []) => invoke<T>('db_select', { sql, params })

export function groupScanLayouts(rows: LayoutRow[]): PracticeScanLayout[] {
  const grouped = new Map<string, PracticeScanLayout>()
  for (const row of rows) {
    const layout = grouped.get(row.page_id) ?? {
      pageId: row.page_id, pageIdentity: row.page_identity, qrPayload: row.qr_payload,
      widthPoints: Number(row.width_points), heightPoints: Number(row.height_points), regions: [],
    }
    if (row.region_id && row.practice_item_id && row.region_index !== null
      && row.x !== null && row.y !== null && row.width !== null && row.height !== null) {
      layout.regions.push({
        id: row.region_id, practiceItemId: row.practice_item_id, regionIndex: Number(row.region_index),
        x: Number(row.x), y: Number(row.y), width: Number(row.width), height: Number(row.height),
      })
    }
    grouped.set(row.page_id, layout)
  }
  return [...grouped.values()]
}

async function captureContext(practiceSetId: string) {
  const rows = await select<LayoutRow[]>(`SELECT document.attempt_id, page.id AS page_id,
    page.page_identity, page.qr_payload, page.width_points, page.height_points,
    region.id AS region_id, region.practice_item_id, region.region_index,
    region.x, region.y, region.width, region.height
    FROM practice_documents document
    JOIN practice_document_pages page ON page.practice_document_id=document.id
    LEFT JOIN practice_answer_regions region ON region.practice_document_page_id=page.id
    WHERE document.practice_set_id=$1 AND document.document_type='answer_sheet' AND document.status='ready'
    ORDER BY document.updated_at DESC, page.page_index, region.region_index`, [practiceSetId])
  if (!rows.length) throw new Error('请先导出机器答题卡，再导入作答照片')
  const attemptId = rows[0].attempt_id
  return { attemptId, layouts: groupScanLayouts(rows.filter((row) => row.attempt_id === attemptId)) }
}

async function persistCapture(practiceSetId: string, scan: PracticeScanResult): Promise<PracticeAttempt> {
  const now = Date.now()
  return withTransactionLock(async () => {
    await execute('BEGIN IMMEDIATE')
    try {
      await execute(`INSERT INTO practice_attempts(id, practice_set_id, status, started_at, submitted_at, created_at, updated_at)
        VALUES($1,$2,'captured',$3,$3,$3,$3)
        ON CONFLICT(id) DO UPDATE SET status='captured', submitted_at=$3, error_message=NULL, updated_at=$3`,
      [scan.practiceAttemptId, practiceSetId, now])
      const existingPage = (await select<Array<{ id: string }>>(`SELECT id FROM practice_attempt_pages
        WHERE practice_attempt_id=$1 AND practice_document_page_id=$2 LIMIT 1`,
      [scan.practiceAttemptId, scan.practiceDocumentPageId]))[0]
      const pageId = existingPage?.id ?? crypto.randomUUID()
      if (existingPage) {
        await execute(`UPDATE practice_attempt_pages SET source_asset_path=$1, corrected_asset_path=$2,
          qr_payload=$3, orientation_degrees=$4, geometry_json=$5, status='captured', created_at=$6 WHERE id=$7`, [
          scan.sourceAssetPath, scan.correctedAssetPath, scan.qrPayload, scan.orientationDegrees,
          JSON.stringify({ pageDetected: scan.pageDetected, corners: scan.corners, stages: scan.stages }), now, pageId,
        ])
      } else {
        await execute(`INSERT INTO practice_attempt_pages(id, practice_attempt_id, practice_document_page_id,
          source_asset_path, corrected_asset_path, qr_payload, orientation_degrees, geometry_json, status, created_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,'captured',$9)`, [
          pageId, scan.practiceAttemptId, scan.practiceDocumentPageId, scan.sourceAssetPath,
          scan.correctedAssetPath, scan.qrPayload, scan.orientationDegrees,
          JSON.stringify({ pageDetected: scan.pageDetected, corners: scan.corners, stages: scan.stages }), now,
        ])
      }
      const persistedResponses = []
      for (const response of scan.responses) {
        const responseId = (await select<Array<{ id: string }>>(`SELECT id FROM practice_responses
          WHERE practice_attempt_id=$1 AND practice_item_id=$2 LIMIT 1`,
        [scan.practiceAttemptId, response.practiceItemId]))[0]?.id ?? crypto.randomUUID()
        await execute(`INSERT INTO practice_responses(id, practice_attempt_id, practice_item_id,
          answer_asset_path, status, created_at, updated_at) VALUES($1,$2,$3,$4,'captured',$5,$5)
          ON CONFLICT(practice_attempt_id, practice_item_id) DO UPDATE SET answer_asset_path=$4,
          extracted_answer_json=NULL, corrected_answer_json=NULL, grading_result_json=NULL,
          status='captured', updated_at=$5`, [
          responseId, scan.practiceAttemptId, response.practiceItemId, response.answerAssetPath, now,
        ])
        persistedResponses.push({ ...response, regionId: responseId })
      }
      await execute('COMMIT')
      return {
        id: scan.practiceAttemptId, practiceSetId, status: 'captured', startedAt: now,
        submittedAt: now, correctedAssetPath: scan.correctedAssetPath,
        orientationDegrees: scan.orientationDegrees, responses: persistedResponses,
      }
    } catch (error) {
      try { await execute('ROLLBACK') } catch { /* original error wins */ }
      throw error
    }
  })
}

export async function capturePracticeAnswerSheet(practiceSetId: string, sourcePath: string) {
  const context = await captureContext(practiceSetId)
  const scan = await processPracticeScan(sourcePath, context.attemptId, context.layouts)
  return persistCapture(practiceSetId, scan)
}

export async function getLatestPracticeAttempt(practiceSetId: string): Promise<PracticeAttempt | null> {
  const attempts = await select<Array<{
    id: string; status: PracticeAttempt['status']; started_at: number; submitted_at: number | null
    corrected_asset_path: string; orientation_degrees: number
  }>>(`SELECT attempt.id, attempt.status, attempt.started_at, attempt.submitted_at,
    page.corrected_asset_path, page.orientation_degrees
    FROM practice_attempts attempt
    JOIN practice_attempt_pages page ON page.practice_attempt_id=attempt.id
    WHERE attempt.practice_set_id=$1 ORDER BY attempt.updated_at DESC, page.created_at DESC LIMIT 1`, [practiceSetId])
  const attempt = attempts[0]
  if (!attempt) return null
  const responses = await select<Array<{
    id: string; practice_item_id: string; answer_asset_path: string
    extracted_answer_json: string | null; corrected_answer_json: string | null; grading_result_json: string | null
  }>>(`SELECT id, practice_item_id, answer_asset_path, extracted_answer_json,
    corrected_answer_json, grading_result_json FROM practice_responses
    WHERE practice_attempt_id=$1 ORDER BY created_at, id`, [attempt.id])
  return {
    id: attempt.id, practiceSetId, status: attempt.status, startedAt: Number(attempt.started_at),
    submittedAt: attempt.submitted_at === null ? null : Number(attempt.submitted_at),
    correctedAssetPath: attempt.corrected_asset_path, orientationDegrees: Number(attempt.orientation_degrees),
    responses: responses.map((response, index) => ({
      regionId: response.id, practiceItemId: response.practice_item_id, regionIndex: index,
      answerAssetPath: response.answer_asset_path, pixelWidth: 0, pixelHeight: 0,
      extractedAnswer: response.corrected_answer_json
        ? JSON.parse(response.corrected_answer_json) : response.extracted_answer_json ? JSON.parse(response.extracted_answer_json) : null,
      gradingResult: response.grading_result_json ? JSON.parse(response.grading_result_json) : null,
    })),
  }
}

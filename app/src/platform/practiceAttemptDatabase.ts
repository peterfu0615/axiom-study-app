import { invoke } from '@tauri-apps/api/core'
import type { PracticeAttempt, PracticeScanResult } from '../domain/practiceAttempt'
import { normalizePracticeGradingResult } from '../domain/practiceGrading'
import {
  processPracticeScan,
  processPracticeScanForPage,
  type PracticeScanLayout,
} from './native'
import { withTransactionLock } from './transactionLock'
import { transitionPracticeSessionForSet } from './practiceSessionDatabase'

interface ExecuteResult { rowsAffected: number; lastInsertId: number }
interface LayoutRow {
  attempt_id: string
  page_id: string
  page_index: number
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
      pageId: row.page_id, pageIndex: Number(row.page_index), pageIdentity: row.page_identity, qrPayload: row.qr_payload,
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

export interface PracticeSubmissionPageOption {
  pageId: string
  pageIndex: number
  pageIdentity: string
  responseCount: number
}

export interface PracticeAnswerSubmission {
  sourcePath: string
  practiceDocumentPageId?: string
  submissionGroupId?: string
  sourceKind?: 'image' | 'annotated_pdf' | 'camera_scan'
  originalAssetPath?: string
  sourcePageIndex?: number
  pageCount?: number
  annotationsPreserved?: boolean
  liveDetectionConfidence?: number
}

export class PracticeSubmissionMatchError extends Error {
  readonly submissions: PracticeAnswerSubmission[]
  readonly pageOptions: PracticeSubmissionPageOption[]

  constructor(message: string, submissions: PracticeAnswerSubmission[], pageOptions: PracticeSubmissionPageOption[]) {
    super(message)
    this.name = 'PracticeSubmissionMatchError'
    this.submissions = submissions
    this.pageOptions = pageOptions
  }
}

async function captureContext(practiceSetId: string) {
  const rows = await select<LayoutRow[]>(`SELECT document.attempt_id, page.id AS page_id, page.page_index,
    page.page_identity, page.qr_payload, page.width_points, page.height_points,
    region.id AS region_id, region.practice_item_id, region.region_index,
    region.x, region.y, region.width, region.height
    FROM practice_documents document
    JOIN practice_document_pages page ON page.practice_document_id=document.id
    LEFT JOIN practice_answer_regions region ON region.practice_document_page_id=page.id
    WHERE document.practice_set_id=$1 AND document.document_type='complete' AND document.status='ready'
    ORDER BY document.updated_at DESC, page.page_index, region.region_index`, [practiceSetId])
  if (!rows.length) throw new Error('请先生成完整练习文档，再导入作答照片')
  const attemptId = rows[0].attempt_id
  const attemptRows = rows.filter((row) => row.attempt_id === attemptId)
  const capturedPages = await select<Array<{ practice_document_page_id: string }>>(
    `SELECT practice_document_page_id FROM practice_attempt_pages
     WHERE practice_attempt_id=$1 AND status='captured'`,
    [attemptId],
  )
  return {
    attemptId,
    layouts: groupScanLayouts(attemptRows),
    pageOptions: [...new Map(attemptRows.map((row) => [row.page_id, {
      pageId: row.page_id,
      pageIndex: Number(row.page_index),
      pageIdentity: row.page_identity,
      responseCount: attemptRows.filter((candidate) => candidate.page_id === row.page_id && candidate.region_id).length,
    }])).values()].sort((left, right) => left.pageIndex - right.pageIndex),
    capturedPageIds: new Set(capturedPages.map((row) => row.practice_document_page_id)),
  }
}

export async function getPracticeSubmissionLayouts(practiceSetId: string) {
  const context = await captureContext(practiceSetId)
  return { layouts: context.layouts, pageOptions: context.pageOptions }
}

async function ensureSubmissionAsset(practiceAttemptId: string, submission: PracticeAnswerSubmission) {
  if (!submission.submissionGroupId || !submission.sourceKind) return null
  const now = Date.now()
  await execute(`INSERT INTO practice_submission_assets(
    id,practice_attempt_id,source_kind,original_asset_path,page_count,
    annotations_preserved,metadata_json,status,created_at,updated_at
  ) VALUES($1,$2,$3,$4,$5,$6,$7,'processing',$8,$8)
  ON CONFLICT(id) DO UPDATE SET status='processing',updated_at=excluded.updated_at`, [
    submission.submissionGroupId, practiceAttemptId, submission.sourceKind,
    submission.originalAssetPath ?? submission.sourcePath, submission.pageCount ?? 1,
    Number(submission.annotationsPreserved ?? false), JSON.stringify({ importedBy: 'practice_submission_v2' }), now,
  ])
  return submission.submissionGroupId
}

async function persistCapture(
  practiceSetId: string,
  scan: PracticeScanResult,
  submission: PracticeAnswerSubmission,
): Promise<PracticeAttempt> {
  const now = Date.now()
  return withTransactionLock(async () => {
    await execute('BEGIN IMMEDIATE')
    try {
      await execute(`INSERT INTO practice_attempts(id, practice_set_id, status, started_at, submitted_at, created_at, updated_at)
        VALUES($1,$2,'captured',$3,$3,$3,$3)
        ON CONFLICT(id) DO UPDATE SET status='captured', submitted_at=$3, error_message=NULL, updated_at=$3`,
      [scan.practiceAttemptId, practiceSetId, now])
      const submissionAssetId = await ensureSubmissionAsset(scan.practiceAttemptId, submission)
      const existingPage = (await select<Array<{ id: string }>>(`SELECT id FROM practice_attempt_pages
        WHERE practice_attempt_id=$1 AND practice_document_page_id=$2 LIMIT 1`,
      [scan.practiceAttemptId, scan.practiceDocumentPageId]))[0]
      const pageId = existingPage?.id ?? crypto.randomUUID()
      if (existingPage) {
        await execute(`UPDATE practice_attempt_pages SET source_asset_path=$1, corrected_asset_path=$2,
          qr_payload=$3, orientation_degrees=$4, geometry_json=$5, status='captured', created_at=$6,
          submission_asset_id=$8,source_page_index=$9,live_detection_confidence=$10 WHERE id=$7`, [
          scan.sourceAssetPath, scan.correctedAssetPath, scan.qrPayload, scan.orientationDegrees,
          JSON.stringify({ pageDetected: scan.pageDetected, corners: scan.corners, stages: scan.stages }), now, pageId,
          submissionAssetId, submission.sourcePageIndex ?? null, submission.liveDetectionConfidence ?? scan.detectionConfidence,
        ])
      } else {
        await execute(`INSERT INTO practice_attempt_pages(id, practice_attempt_id, practice_document_page_id,
          source_asset_path, corrected_asset_path, qr_payload, orientation_degrees, geometry_json, status, created_at,
          submission_asset_id,source_page_index,live_detection_confidence)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,'captured',$9,$10,$11,$12)`, [
          pageId, scan.practiceAttemptId, scan.practiceDocumentPageId, scan.sourceAssetPath,
          scan.correctedAssetPath, scan.qrPayload, scan.orientationDegrees,
          JSON.stringify({ pageDetected: scan.pageDetected, corners: scan.corners, stages: scan.stages }), now,
          submissionAssetId, submission.sourcePageIndex ?? null, submission.liveDetectionConfidence ?? scan.detectionConfidence,
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
  return capturePracticeAnswerPages(practiceSetId, [{ sourcePath }])
}

export async function capturePracticeAnswerPages(
  practiceSetId: string,
  submissions: PracticeAnswerSubmission[],
) {
  try {
    const context = await captureContext(practiceSetId)
    if (!submissions.length) throw new Error('请选择至少一页作答文件')
    for (const [index, submission] of submissions.entries()) {
      try {
        const scan = submission.practiceDocumentPageId
          ? await processPracticeScanForPage(
            submission.sourcePath,
            context.attemptId,
            context.layouts,
            submission.practiceDocumentPageId,
          )
          : await processPracticeScan(submission.sourcePath, context.attemptId, context.layouts)
        await persistCapture(practiceSetId, scan, submission)
        if (submission.submissionGroupId) {
          await execute("UPDATE practice_submission_assets SET status='completed',updated_at=$1 WHERE id=$2", [Date.now(), submission.submissionGroupId])
        }
        context.capturedPageIds.add(scan.practiceDocumentPageId)
      } catch (reason) {
        if (submission.submissionGroupId) {
          await execute("UPDATE practice_submission_assets SET status='failed',updated_at=$1 WHERE id=$2", [Date.now(), submission.submissionGroupId]).catch(() => undefined)
        }
        const remainingOptions = context.pageOptions.filter(
          (option) => !context.capturedPageIds.has(option.pageId),
        )
        throw new PracticeSubmissionMatchError(
          String(reason),
          submissions.slice(index),
          remainingOptions.length ? remainingOptions : context.pageOptions,
        )
      }
    }
    const attempt = await getLatestPracticeAttempt(practiceSetId)
    if (!attempt) throw new Error('作答页已保存，但无法重新读取 PracticeAttempt')
    await transitionPracticeSessionForSet(practiceSetId, {
      to: 'submitted', safeCode: 'answer_sheet_captured',
      metadata: {
        attemptId: attempt.id,
        pageCount: submissions.length,
        responseCount: attempt.responses.length,
      },
    })
    return attempt
  } catch (reason) {
    try {
      await transitionPracticeSessionForSet(practiceSetId, { to: 'upload_failed', safeCode: 'answer_capture_failed' })
    } catch { /* preserve the capture error */ }
    throw reason
  }
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
  const submissionAssets = await select<Array<{
    id: string; source_kind: 'image' | 'annotated_pdf' | 'camera_scan'; original_asset_path: string
    page_count: number; annotations_preserved: number
  }>>(`SELECT id,source_kind,original_asset_path,page_count,annotations_preserved
    FROM practice_submission_assets WHERE practice_attempt_id=$1 ORDER BY created_at,id`, [attempt.id])
  const responses = await select<Array<{
    id: string; practice_item_id: string; answer_asset_path: string
    effective_answer_json: string | null; effective_grading_json: string | null
  }>>(`SELECT response.id, response.practice_item_id, response.answer_asset_path,
    effective.effective_answer_json, effective.effective_grading_json
    FROM practice_responses response
    JOIN practice_effective_responses effective ON effective.response_id=response.id
    WHERE response.practice_attempt_id=$1 ORDER BY response.created_at, response.id`, [attempt.id])
  return {
    id: attempt.id, practiceSetId, status: attempt.status, startedAt: Number(attempt.started_at),
    submittedAt: attempt.submitted_at === null ? null : Number(attempt.submitted_at),
    correctedAssetPath: attempt.corrected_asset_path, orientationDegrees: Number(attempt.orientation_degrees),
    submissionAssets: submissionAssets.map((asset) => ({
      id: asset.id, sourceKind: asset.source_kind, originalAssetPath: asset.original_asset_path,
      pageCount: Number(asset.page_count), annotationsPreserved: Boolean(asset.annotations_preserved),
    })),
    responses: responses.map((response, index) => ({
      regionId: response.id, practiceItemId: response.practice_item_id, regionIndex: index,
      answerAssetPath: response.answer_asset_path, pixelWidth: 0, pixelHeight: 0,
      extractedAnswer: response.effective_answer_json ? JSON.parse(response.effective_answer_json) : null,
      gradingResult: response.effective_grading_json
        ? normalizePracticeGradingResult(JSON.parse(response.effective_grading_json))
        : null,
    })),
  }
}

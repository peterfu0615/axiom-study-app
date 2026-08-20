import { invoke } from '@tauri-apps/api/core'

const select = <T>(sql: string, params: unknown[] = []) => invoke<T>('db_select', { sql, params })

export interface ProblemReviewHistoryEntry {
  attemptId: string
  createdAt: number
  rating: string | null
  overallResult: string
  firstErrorStep: number | null
  errorCategory: string | null
  answerImagePath: string | null
  gradingConfidence: number
  evidence: Array<{ tagName: string; result: string; evidenceText: string; confidence: number }>
}

export async function getProblemReviewHistory(problemId: string): Promise<ProblemReviewHistoryEntry[]> {
  const [attempts, evidenceRows] = await Promise.all([
    select<Array<{
      id: string; created_at: number; rating: string | null; overall_result: string
      first_error_step: number | null; error_category: string | null
      answer_image_path: string | null; grading_confidence: number
    }>>(`SELECT attempt.id,attempt.created_at,attempt.rating,
        CASE attempt.rating WHEN 'good' THEN 'correct' WHEN 'easy' THEN 'correct'
          WHEN 'hard' THEN 'partial' ELSE attempt.overall_result END AS overall_result,
        attempt.first_error_step,attempt.error_category,attempt.answer_image_path,attempt.grading_confidence
      FROM review_attempts attempt
      JOIN question_instances instance ON instance.id=attempt.question_instance_id
      WHERE instance.source_problem_id=$1 ORDER BY attempt.created_at DESC,attempt.id`, [problemId]),
    select<Array<{
      review_attempt_id: string; tag_name: string; result: string; evidence_text: string; confidence: number
    }>>(`SELECT evidence.review_attempt_id,
        COALESCE(definition.canonical_name,evidence.tag_id) AS tag_name,
        evidence.result,evidence.evidence_text,evidence.confidence
      FROM tag_evidences evidence
      JOIN review_attempts attempt ON attempt.id=evidence.review_attempt_id
      JOIN question_instances instance ON instance.id=attempt.question_instance_id
      LEFT JOIN tag_definitions definition ON definition.id=evidence.tag_id AND definition.subject=evidence.subject
      WHERE instance.source_problem_id=$1 ORDER BY evidence.created_at,evidence.id`, [problemId]),
  ])
  return attempts.map((attempt) => ({
    attemptId: attempt.id, createdAt: Number(attempt.created_at), rating: attempt.rating,
    overallResult: attempt.overall_result, firstErrorStep: attempt.first_error_step === null ? null : Number(attempt.first_error_step),
    errorCategory: attempt.error_category, answerImagePath: attempt.answer_image_path,
    gradingConfidence: Number(attempt.grading_confidence),
    evidence: evidenceRows.filter((row) => row.review_attempt_id === attempt.id).map((row) => ({
      tagName: row.tag_name, result: row.result, evidenceText: row.evidence_text, confidence: Number(row.confidence),
    })),
  }))
}

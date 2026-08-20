import { invoke } from '@tauri-apps/api/core'
import { getStudentAttemptProvidersForRun, getSubjectivePracticeGradingProviders } from '../ai/provider'
import {
  SUBJECTIVE_PRACTICE_GRADING_PROMPT_VERSION,
  SUBJECTIVE_PRACTICE_GRADING_SCHEMA_VERSION,
} from '../ai/practiceGradingContract'
import type { PracticeItem, PracticeSet } from '../domain/practice'
import type { PracticeAttempt } from '../domain/practiceAttempt'
import {
  gradePracticeAnswer,
  gradingRequiresReview,
  type PracticeCorrectness,
  type PracticeGradingResult,
  type StructuredStudentAnswer,
  type SubjectivePracticeGradingInput,
} from '../domain/practiceGrading'
import type { ReviewTag } from '../domain/review'
import { getLatestPracticeAttempt } from './practiceAttemptDatabase'
import { rebuildLearningStateInTransaction } from './reviewMaintenance'
import { withTransactionLock } from './transactionLock'
import { transitionPracticeSessionForSet } from './practiceSessionDatabase'

interface ExecuteResult { rowsAffected: number; lastInsertId: number }
const execute = (sql: string, params: unknown[] = []) => invoke<ExecuteResult>('db_execute', { sql, params })
const select = <T>(sql: string, params: unknown[] = []) => invoke<T>('db_select', { sql, params })

function status(result: PracticeGradingResult) {
  return result.requiresReview ? 'needs_review' : 'graded'
}

function canonicalSolution(item: PracticeItem) {
  try {
    const parsed = JSON.parse(item.solutionJson) as { contentMarkdown?: string; steps?: Array<{ content?: string; contentMarkdown?: string; content_markdown?: string }> }
    return parsed.contentMarkdown ?? parsed.steps?.map((step) => step.content ?? step.contentMarkdown ?? step.content_markdown ?? '').filter(Boolean).join('\n') ?? ''
  } catch { return '' }
}

function safeGradingErrorCode(reason: unknown) {
  const message = String(reason).toLowerCase()
  if (message.includes('provider') || message.includes('模型')) return 'grading_provider_unavailable'
  if (message.includes('json') || message.includes('契约') || message.includes('标签')) return 'grading_contract_invalid'
  return 'grading_failed'
}

async function grade(responseId: string, item: PracticeItem, answer: StructuredStudentAnswer) {
  const deterministic = gradePracticeAnswer(item, answer)
  if (!deterministic.requiresReview) return deterministic
  const providers = getSubjectivePracticeGradingProviders()
  const input: SubjectivePracticeGradingInput = {
    subject: item.subject, statementMarkdown: item.statementMarkdown, canonicalAnswer: item.canonicalAnswer,
    canonicalSolution: canonicalSolution(item), rubric: item.gradingRubric, studentAnswer: answer,
    targetTags: item.targetTags, skillBundleId: item.targetSkillBundleId, difficulty: item.difficulty,
    sourceType: item.sourceType, usedHint: false,
  }
  let lastFailure: unknown = new Error('没有可用的练习批改 Provider')
  for (const provider of providers) {
    const runId = crypto.randomUUID()
    const startedAt = Date.now()
    await execute(`INSERT INTO practice_grading_model_runs(
      id,practice_response_id,provider,model,prompt_version,schema_version,input_hash,status,started_at
    ) VALUES($1,$2,$3,$4,$5,$6,$7,'running',$8)`, [
      runId, responseId, provider.id, provider.model, SUBJECTIVE_PRACTICE_GRADING_PROMPT_VERSION,
      SUBJECTIVE_PRACTICE_GRADING_SCHEMA_VERSION, operationKey('grading_input', JSON.stringify(input)), startedAt,
    ])
    try {
      const grading = { ...(await provider.gradeSubjectivePractice(input)).grading, modelRunId: runId }
      grading.requiresReview = gradingRequiresReview(grading)
      await execute(`UPDATE practice_grading_model_runs SET status='succeeded',result_json=$1,completed_at=$2
        WHERE id=$3 AND status='running'`, [JSON.stringify(grading), Date.now(), runId])
      return grading
    } catch (reason) {
      lastFailure = reason
      await execute(`UPDATE practice_grading_model_runs SET status='failed',safe_error_code=$1,completed_at=$2
        WHERE id=$3 AND status='running'`, [safeGradingErrorCode(reason), Date.now(), runId])
    }
  }
  throw lastFailure
}

async function persistAIExtraction(responseId: string, answer: StructuredStudentAnswer, result: PracticeGradingResult) {
  await execute(`UPDATE practice_responses SET extracted_answer_json=$1, corrected_answer_json=NULL,
    grading_result_json=$2, status=$3, updated_at=$4 WHERE id=$5`,
  [JSON.stringify(answer), JSON.stringify(result), status(result), Date.now(), responseId])
}

function operationKey(kind: 'regrade' | 'manual_override' | 'grading_input', value: string) {
  let hash = 2166136261
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 16777619)
  }
  return `${kind}:${(hash >>> 0).toString(16)}`
}

interface EffectiveRow {
  response_id: string
  practice_attempt_id: string
  effective_answer_json: string | null
  effective_grading_json: string | null
  latest_revision_index: number | null
}

async function reconcilePracticeLoop(responseId: string, grading: PracticeGradingResult, now: number) {
  const attempt = (await select<Array<{ practice_attempt_id: string }>>(
    'SELECT practice_attempt_id FROM practice_responses WHERE id=$1 LIMIT 1', [responseId],
  ))[0]
  if (!attempt) return
  const loop = (await select<Array<{ id: string; item_budget: number; consumed_items: number }>>(`
    SELECT loop.id, loop.item_budget, loop.consumed_items FROM practice_loops loop
    JOIN practice_loop_rounds round ON round.practice_loop_id=loop.id
    JOIN practice_attempts attempt ON attempt.practice_set_id=round.practice_set_id
    WHERE attempt.id=$1 LIMIT 1`, [attempt.practice_attempt_id]))[0]
  if (!loop) return
  const grades = await select<Array<{ effective_grading_json: string | null }>>(`
    SELECT effective_grading_json FROM practice_effective_responses
    WHERE practice_attempt_id=$1`, [attempt.practice_attempt_id])
  const results = grades.flatMap((row) => {
    if (!row.effective_grading_json) return []
    try { return [JSON.parse(row.effective_grading_json) as PracticeGradingResult] } catch { return [] }
  })
  if (!results.length) return
  const allCorrect = results.every((result) => result.correctness === 'correct')
  const status = allCorrect ? 'mastered' : 'needs_reinforcement'
  await execute(`UPDATE practice_loops SET status=$1, stop_reason=$2, updated_at=$3 WHERE id=$4`, [
    status, allCorrect ? 'all_correct' : null, now, loop.id,
  ])
  if (allCorrect) {
    await execute(`UPDATE practice_loop_rounds SET superseded_at=$1
      WHERE practice_loop_id=$2 AND status='active' AND superseded_at IS NULL`, [now, loop.id])
  }
  void grading
}

async function persistCorrection(input: {
  responseId: string
  type: 'regrade' | 'manual_override'
  answer: StructuredStudentAnswer | null
  grading: PracticeGradingResult
  operationKey: string
}) {
  return withTransactionLock(async () => {
    await execute('BEGIN IMMEDIATE')
    try {
      const row = (await select<Array<EffectiveRow & { has_evidence: number; corrected_answer_json: string | null; extracted_answer_json: string | null; grading_result_json: string | null }>>(`
        SELECT effective.response_id, effective.practice_attempt_id, effective.effective_answer_json,
          effective.effective_grading_json, effective.latest_revision_index,
          response.corrected_answer_json, response.extracted_answer_json, response.grading_result_json,
          EXISTS(SELECT 1 FROM practice_evidences evidence WHERE evidence.practice_response_id=response.id) AS has_evidence
        FROM practice_effective_responses effective
        JOIN practice_responses response ON response.id=effective.response_id
        WHERE effective.response_id=$1 LIMIT 1`, [input.responseId]))[0]
      if (!row) throw new Error('找不到需要修正的作答')
      const currentAnswer = row.effective_answer_json ? JSON.parse(row.effective_answer_json) as StructuredStudentAnswer : null
      const currentGrading = row.effective_grading_json ? JSON.parse(row.effective_grading_json) as PracticeGradingResult : null
      if (currentGrading && JSON.stringify(currentGrading) === JSON.stringify(input.grading)
        && (!input.answer || JSON.stringify(currentAnswer) === JSON.stringify(input.answer))) {
        await execute('COMMIT')
        return { answer: currentAnswer, grading: currentGrading }
      }
      if (!row.has_evidence) {
        await execute(`UPDATE practice_responses SET corrected_answer_json=$1, grading_result_json=$2,
          status=$3, updated_at=$4 WHERE id=$5`, [
          input.answer ? JSON.stringify(input.answer) : row.corrected_answer_json,
          JSON.stringify(input.grading), status(input.grading), Date.now(), input.responseId,
        ])
        await execute('COMMIT')
        return { answer: input.answer ?? currentAnswer, grading: input.grading }
      }
      const operation = `${input.operationKey}:from:${row.latest_revision_index ?? 0}`
      const duplicate = (await select<Array<{ revision_index: number; new_grading_json: string; corrected_answer_json: string | null }>>(`
        SELECT revision_index, new_grading_json, corrected_answer_json FROM practice_grading_revisions
        WHERE practice_response_id=$1 AND operation_key=$2 LIMIT 1`, [input.responseId, operation]))[0]
      if (duplicate) {
        await execute('COMMIT')
        return {
          answer: duplicate.corrected_answer_json ? JSON.parse(duplicate.corrected_answer_json) as StructuredStudentAnswer : currentAnswer,
          grading: JSON.parse(duplicate.new_grading_json) as PracticeGradingResult,
        }
      }
      const revisionIndex = Number(row.latest_revision_index ?? 0) + 1
      const now = Date.now()
      await execute(`INSERT INTO practice_grading_revisions(
        id, practice_attempt_id, practice_response_id, revision_index, revision_type,
        previous_grading_json, new_grading_json, corrected_answer_json, operation_key, created_at
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [
        crypto.randomUUID(), row.practice_attempt_id, input.responseId, revisionIndex, input.type,
          JSON.stringify(currentGrading ?? {}), JSON.stringify(input.grading), JSON.stringify(input.answer ?? currentAnswer),
        operation, now,
      ])
      await rebuildLearningStateInTransaction()
      await reconcilePracticeLoop(input.responseId, input.grading, now)
      await execute('COMMIT')
      return { answer: input.answer ?? currentAnswer, grading: input.grading }
    } catch (error) {
      try { await execute('ROLLBACK') } catch { /* original error wins */ }
      throw error
    }
  })
}

export async function extractAndGradePracticeAttempt(practiceSet: PracticeSet, attempt: PracticeAttempt) {
  await execute("UPDATE practice_attempts SET status='extracting', error_message=NULL, updated_at=$1 WHERE id=$2", [Date.now(), attempt.id])
  try {
    await transitionPracticeSessionForSet(practiceSet.id, {
      to: 'processing', safeCode: 'grading_started', metadata: { attemptId: attempt.id },
    })
    const provider = getStudentAttemptProvidersForRun('', '')[0]
    let needsReview = false
    for (const response of attempt.responses) {
      const item = practiceSet.items.find((candidate) => candidate.id === response.practiceItemId)
      if (!item) throw new Error(`PracticeResponse ${response.regionId} 找不到对应题目`)
      await execute("UPDATE practice_responses SET status='extracting', updated_at=$1 WHERE id=$2", [Date.now(), response.regionId])
      const extracted = await provider.extractStudentAttempt({
        problemId: item.id, answerImagePaths: [response.answerAssetPath], questionImagePath: item.questionImagePath ?? '',
        subject: item.subject, problemContext: item.statementMarkdown,
        choices: item.options?.map((text, index) => ({ label: String.fromCharCode(65 + index), text })) ?? [], subQuestions: [],
      })
      const answer: StructuredStudentAnswer = { ...extracted.attempt, source: 'ai' }
      const result = await grade(response.regionId, item, answer)
      needsReview ||= result.requiresReview
      await persistAIExtraction(response.regionId, answer, result)
    }
    await execute("UPDATE practice_attempts SET status='extracted', error_message=NULL, updated_at=$1 WHERE id=$2", [Date.now(), attempt.id])
    await transitionPracticeSessionForSet(practiceSet.id, {
      to: needsReview ? 'needs_review' : 'graded',
      safeCode: needsReview ? 'grading_requires_confirmation' : 'grading_completed',
      metadata: { attemptId: attempt.id },
    })
  } catch (error) {
    await execute("UPDATE practice_attempts SET status='failed', error_message=$1, updated_at=$2 WHERE id=$3", [String(error), Date.now(), attempt.id])
    try {
      await transitionPracticeSessionForSet(practiceSet.id, { to: 'grading_failed', safeCode: 'grading_failed' })
    } catch { /* preserve the grading error */ }
    throw error
  }
  return getLatestPracticeAttempt(practiceSet.id)
}

export async function correctAndRegradePracticeResponse(responseId: string, item: PracticeItem, rawMarkdown: string) {
  const lines = rawMarkdown.split(/\n+/).map((line) => line.trim()).filter(Boolean)
  const answer: StructuredStudentAnswer = {
    rawMarkdown: rawMarkdown.trim(), source: 'user',
    steps: (lines.length ? lines : ['未检测到作答内容']).map((contentMarkdown, index) => ({ index: index + 1, contentMarkdown })),
  }
  const grading = await grade(responseId, item, answer)
  return persistCorrection({
    responseId, type: 'regrade', answer, grading,
    operationKey: operationKey('regrade', rawMarkdown.trim()),
  })
}

export async function overridePracticeGrade(responseId: string, correctness: Exclude<PracticeCorrectness, 'needs_review'>) {
  const score = correctness === 'correct' ? 100 : correctness === 'partial' ? 50 : 0
  const context = (await select<Array<{
    effective_grading_json: string | null; target_tags_json: string; target_skill_bundle_id: string | null
    difficulty: PracticeItem['difficulty']; source_type: PracticeItem['sourceType']
  }>>(`SELECT effective.effective_grading_json,item.target_tags_json,item.target_skill_bundle_id,
      item.difficulty,item.source_type
    FROM practice_effective_responses effective
    JOIN practice_responses response ON response.id=effective.response_id
    JOIN practice_items item ON item.id=response.practice_item_id
    WHERE effective.response_id=$1 LIMIT 1`, [responseId]))[0]
  if (!context) throw new Error('找不到需要确认的批改结果')
  const previous = context.effective_grading_json
    ? JSON.parse(context.effective_grading_json) as PracticeGradingResult
    : null
  const tags = JSON.parse(context.target_tags_json) as ReviewTag[]
  const previousByTag = new Map(previous?.tagEvidence.map((entry) => [`${entry.tagType}:${entry.tagId}`, entry]))
  const tagEvidence = tags.flatMap((tag) => {
    if (!tag.id || tag.type === 'error') return []
    const existing = previousByTag.get(`${tag.type}:${tag.id}`)
    if (existing) return [{ ...existing, confidence: 1 }]
    return [{
      tagId: tag.id, tagType: tag.type,
      result: tag.type === 'knowledge' ? (correctness === 'correct' ? 'demonstrated' as const : 'contradicted' as const) : 'insufficient' as const,
      confidence: 1, evidence: '用户确认了本题总体批改结果。', weight: tag.type === 'knowledge' ? .8 : 0,
    }]
  })
  const grading: PracticeGradingResult = {
    modelRunId: previous?.modelRunId ?? null,
    correctness, score, method: 'manual', errorCategory: correctness === 'correct' ? null : 'user_confirmed_error',
    processComplete: previous?.processComplete ?? false,
    firstErrorStep: correctness === 'correct' ? null : previous?.firstErrorStep ?? 1,
    errorReason: correctness === 'correct' ? null : previous?.errorReason ?? '用户确认本题存在错误。',
    correctAlternativeStep: correctness === 'correct' ? null : previous?.correctAlternativeStep ?? '请按标准解核对首个错误步骤。',
    usedTargetMethod: previous?.usedTargetMethod ?? null,
    appliedTargetKnowledge: correctness === 'correct', matchedTargetModel: previous?.matchedTargetModel ?? null,
    independentCompletion: previous?.independentCompletion ?? true, usedHint: previous?.usedHint ?? false,
    evidence: ['用户已检查作答与标准答案'], tagEvidence,
    bundleEvidence: previous?.bundleEvidence ?? {
      skillBundleId: context.target_skill_bundle_id,
      result: correctness === 'correct' ? 'demonstrated' : correctness === 'partial' ? 'insufficient' : 'contradicted',
      transfer: context.source_type === 'generated_variant', difficulty: context.difficulty, confidence: 1,
    },
    explanation: '本结果由用户确认，优先于自动批改。', overallConfidence: 1,
    requiresReview: false, userConfirmed: true,
  }
  return persistCorrection({
    responseId, type: 'manual_override', answer: null, grading,
    operationKey: operationKey('manual_override', correctness),
  }).then((result) => result.grading)
}

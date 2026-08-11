import { invoke } from '@tauri-apps/api/core'
import type { DifficultyLevel } from '../domain/models'
import type { ReviewSkillState, ReviewTag } from '../domain/review'
import { REVIEW_SCHEDULER_VERSION, applyReviewRating, initialReviewSkillState, ratingEvidence } from '../domain/review'
import type { PracticeSet } from '../domain/practice'
import type { PracticeAttempt } from '../domain/practiceAttempt'
import type { PracticeGradingResult, StructuredStudentAnswer } from '../domain/practiceGrading'
import { decidePracticeLoop, practiceRating, type PracticeLoop, type PracticeLoopStopReason, type PracticeLoopStatus } from '../domain/practiceLoop'
import { getOrCreatePracticeSetFromPracticeAttempt } from './practiceDatabase'
import { withTransactionLock } from './transactionLock'

interface ExecuteResult { rowsAffected: number; lastInsertId: number }
const execute = (sql: string, params: unknown[] = []) => invoke<ExecuteResult>('db_execute', { sql, params })
const select = <T>(sql: string, params: unknown[] = []) => invoke<T>('db_select', { sql, params })
const uuid = () => crypto.randomUUID()
const number = (value: unknown, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback
const nullableNumber = (value: unknown) => value == null ? null : number(value)
const parseJSON = <T>(value: unknown, fallback: T): T => {
  if (typeof value !== 'string' || !value.trim()) return fallback
  try { return JSON.parse(value) as T } catch { return fallback }
}

interface LoopRow {
  id: string; root_practice_set_id: string; current_practice_set_id: string
  status: PracticeLoopStatus; round_index: number; item_budget: number
  consumed_items: number; stop_reason: PracticeLoopStopReason; updated_at: number
  next_practice_set_id: string | null
}

function loopFromRow(row: LoopRow): PracticeLoop {
  return {
    id: row.id, rootPracticeSetId: row.root_practice_set_id,
    currentPracticeSetId: row.current_practice_set_id, status: row.status,
    roundIndex: number(row.round_index, 1), itemBudget: number(row.item_budget),
    consumedItems: number(row.consumed_items), stopReason: row.stop_reason,
    nextPracticeSetId: row.next_practice_set_id, updatedAt: number(row.updated_at),
  }
}

const loopSelect = `SELECT loop.*,
  (SELECT round.practice_set_id FROM practice_loop_rounds round
    WHERE round.practice_loop_id=loop.id AND round.status='active'
    ORDER BY round.round_index DESC LIMIT 1) AS next_practice_set_id
  FROM practice_loops loop`

export async function getPracticeLoopForSet(practiceSetId: string): Promise<PracticeLoop | null> {
  const row = (await select<LoopRow[]>(`${loopSelect} WHERE loop.id=(
    SELECT practice_loop_id FROM practice_loop_rounds WHERE practice_set_id=$1 LIMIT 1
  ) OR loop.root_practice_set_id=$1 LIMIT 1`, [practiceSetId]))[0]
  return row ? loopFromRow(row) : null
}

function skillFromRow(row: Record<string, unknown>): ReviewSkillState {
  return {
    masteryEstimate: number(row.mastery_estimate, .45), stability: number(row.stability, 1),
    retrievability: number(row.retrievability, .65), evidenceCount: number(row.evidence_count),
    successCount: number(row.success_count), failureCount: number(row.failure_count),
    transferScore: number(row.transfer_score), maxStableDifficulty: (row.max_stable_difficulty as DifficultyLevel | null) ?? null,
    lastPracticedAt: nullableNumber(row.last_practiced_at), nextReviewAt: nullableNumber(row.next_review_at),
    uncertainty: number(row.uncertainty, 1),
  }
}

const skillParams = (state: ReviewSkillState) => [
  state.masteryEstimate, state.stability, state.retrievability, state.evidenceCount,
  state.successCount, state.failureCount, state.transferScore, state.maxStableDifficulty,
  state.lastPracticedAt, state.nextReviewAt, state.uncertainty,
]

async function applyPracticeEvidence(input: {
  loopId: string; attemptId: string; responseId: string; subject: string
  itemId: string; sourceProblemId: string; skillBundleId: string; difficulty: DifficultyLevel
  targetTags: ReviewTag[]; answer: StructuredStudentAnswer; answerImagePath: string
  grading: PracticeGradingResult; reviewedAt: number
}) {
  const resultKey = `practice:${input.responseId}`
  const existing = await select<Array<{ id: string }>>('SELECT id FROM review_attempts WHERE result_key=$1 LIMIT 1', [resultKey])
  if (existing.length) return false
  const question = (await select<Array<{ id: string }>>(`SELECT instance.id FROM question_instances instance
    JOIN review_modules module ON module.id=instance.review_module_id
    WHERE instance.source_problem_id=$1 AND module.skill_bundle_id=$2
    ORDER BY instance.created_at DESC LIMIT 1`, [input.sourceProblemId, input.skillBundleId]))[0]
    ?? (await select<Array<{ id: string }>>(`SELECT id FROM question_instances
      WHERE source_problem_id=$1 ORDER BY created_at DESC LIMIT 1`, [input.sourceProblemId]))[0]
  if (!question) throw new Error(`练习题 ${input.itemId} 缺少可追溯的 Review Question 快照`)
  const rating = practiceRating(input.grading)
  const evidence = ratingEvidence(rating)
  const reviewAttemptId = uuid()
  await execute(`INSERT INTO review_attempts(
    id,subject,question_instance_id,answer_text,answer_image_path,is_correct,error_category,
    duration_seconds,used_hint,grading_confidence,created_at,rating,result_key,evidence_source
  ) VALUES($1,$2,$3,$4,$5,$6,$7,0,0,1,$8,$9,$10,'practice_attempt')`, [
    reviewAttemptId, input.subject, question.id, input.answer.rawMarkdown, input.answerImagePath,
    input.grading.correctness === 'correct' ? 1 : 0, input.grading.errorCategory,
    input.reviewedAt, rating, resultKey,
  ])
  for (const tag of input.targetTags) {
    if (!tag.id || tag.type === 'error') continue
    const row = (await select<Array<Record<string, unknown>>>(
      'SELECT * FROM skill_states WHERE subject=$1 AND tag_id=$2 LIMIT 1', [input.subject, tag.id],
    ))[0]
    const current = row ? skillFromRow(row) : initialReviewSkillState()
    const next = applyReviewRating(current, rating, input.difficulty, input.reviewedAt)
    if (row) await execute(`UPDATE skill_states SET mastery_estimate=$1,stability=$2,retrievability=$3,
      evidence_count=$4,success_count=$5,failure_count=$6,transfer_score=$7,max_stable_difficulty=$8,
      last_practiced_at=$9,next_review_at=$10,uncertainty=$11,scheduler_version=$12,updated_at=$13
      WHERE subject=$14 AND tag_id=$15`, [
      ...skillParams(next), REVIEW_SCHEDULER_VERSION, input.reviewedAt, input.subject, tag.id,
    ])
    await execute(`INSERT INTO tag_evidences(id,subject,review_attempt_id,tag_id,skill_bundle_id,result,
      confidence,weight,evidence_text,transfer_flag,difficulty_context,user_verified,created_at)
      VALUES($1,$2,$3,$4,$5,$6,1,$7,$8,0,$9,$10,$11)`, [
      uuid(), input.subject, reviewAttemptId, tag.id, input.skillBundleId, evidence.result,
      evidence.weight, `Practice Attempt：${input.grading.explanation}`, input.difficulty,
      input.grading.userConfirmed ? 1 : 0, input.reviewedAt,
    ])
  }
  const bundleRow = (await select<Array<Record<string, unknown>>>(
    'SELECT * FROM skill_bundle_states WHERE subject=$1 AND skill_bundle_id=$2 LIMIT 1', [input.subject, input.skillBundleId],
  ))[0]
  const previousBundle = bundleRow ? skillFromRow(bundleRow) : initialReviewSkillState()
  const nextBundle = applyReviewRating(previousBundle, rating, input.difficulty, input.reviewedAt)
  if (bundleRow) await execute(`UPDATE skill_bundle_states SET mastery_estimate=$1,stability=$2,
    retrievability=$3,transfer_score=$4,evidence_count=$5,last_practiced_at=$6,next_review_at=$7,
    uncertainty=$8,scheduler_version=1,updated_at=$9 WHERE subject=$10 AND skill_bundle_id=$11`, [
    nextBundle.masteryEstimate, nextBundle.stability, nextBundle.retrievability,
    nextBundle.transferScore, nextBundle.evidenceCount, nextBundle.lastPracticedAt,
    nextBundle.nextReviewAt, nextBundle.uncertainty, input.reviewedAt, input.subject, input.skillBundleId,
  ])
  await execute(`INSERT INTO horizon_review_logs(id,review_attempt_id,subject,skill_bundle_id,rating,
    previous_state_json,evidence_json,new_state_json,scheduler_version,reviewed_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [
    uuid(), reviewAttemptId, input.subject, input.skillBundleId, rating,
    JSON.stringify(previousBundle), JSON.stringify({ ...evidence, source: 'practice_attempt', grading: input.grading }),
    JSON.stringify(nextBundle), REVIEW_SCHEDULER_VERSION, input.reviewedAt,
  ])
  await execute(`INSERT INTO practice_evidences(id,practice_loop_id,practice_attempt_id,
    practice_response_id,review_attempt_id,grading_snapshot_json,created_at)
    VALUES($1,$2,$3,$4,$5,$6,$7)`, [
    uuid(), input.loopId, input.attemptId, input.responseId, reviewAttemptId,
    JSON.stringify(input.grading), input.reviewedAt,
  ])
  return true
}

export async function finalizePracticeAttempt(practiceSet: PracticeSet, attempt: PracticeAttempt, itemBudget = 6) {
  const finalized = await withTransactionLock(async () => {
    await execute('BEGIN IMMEDIATE')
    try {
      const now = Date.now()
      let loopRow = (await select<LoopRow[]>(`${loopSelect} WHERE loop.id=(
        SELECT practice_loop_id FROM practice_loop_rounds WHERE practice_set_id=$1 LIMIT 1
      ) OR loop.root_practice_set_id=$1 LIMIT 1`, [practiceSet.id]))[0]
      if (!loopRow) {
        const loopId = uuid()
        const budget = Math.max(practiceSet.items.length, Math.min(36, Math.round(itemBudget)))
        await execute(`INSERT INTO practice_loops(id,root_practice_set_id,current_practice_set_id,status,
          round_index,item_budget,consumed_items,created_at,updated_at)
          VALUES($1,$2,$2,'active',1,$3,0,$4,$4)`, [loopId, practiceSet.id, budget, now])
        await execute(`INSERT INTO practice_loop_rounds(id,practice_loop_id,practice_set_id,round_index,status,created_at)
          VALUES($1,$2,$3,1,'active',$4)`, [uuid(), loopId, practiceSet.id, now])
        loopRow = (await select<LoopRow[]>(`${loopSelect} WHERE loop.id=$1`, [loopId]))[0]
      }
      const loopId = loopRow.id
      const contexts = await select<Array<{
        response_id: string; answer_asset_path: string; corrected_answer_json: string | null
        extracted_answer_json: string | null; grading_result_json: string | null
        item_id: string; subject: string; source_problem_id: string | null
        target_skill_bundle_id: string | null; target_tags_json: string; difficulty: DifficultyLevel
      }>>(`SELECT response.id AS response_id,response.answer_asset_path,response.corrected_answer_json,
        response.extracted_answer_json,response.grading_result_json,item.id AS item_id,item.subject,
        item.source_problem_id,item.target_skill_bundle_id,item.target_tags_json,item.difficulty
        FROM practice_responses response JOIN practice_items item ON item.id=response.practice_item_id
        WHERE response.practice_attempt_id=$1 ORDER BY item.order_index`, [attempt.id])
      if (!contexts.length || contexts.length !== practiceSet.items.length) throw new Error('作答区域不完整，不能提交学习证据')
      const grades = contexts.map((row) => parseJSON<PracticeGradingResult | null>(row.grading_result_json, null))
      if (grades.some((grade) => !grade || grade.correctness === 'needs_review')) throw new Error('仍有未完成或待确认的批改结果')
      let inserted = 0
      for (const [index, row] of contexts.entries()) {
        if (!row.source_problem_id || !row.target_skill_bundle_id) throw new Error(`练习题 ${row.item_id} 缺少 SkillBundle 或原题快照`)
        const answer = parseJSON<StructuredStudentAnswer | null>(row.corrected_answer_json, null)
          ?? parseJSON<StructuredStudentAnswer | null>(row.extracted_answer_json, null)
        if (!answer) throw new Error(`练习题 ${row.item_id} 缺少可提交的学生答案`)
        if (await applyPracticeEvidence({
          loopId, attemptId: attempt.id, responseId: row.response_id, subject: row.subject,
          itemId: row.item_id, sourceProblemId: row.source_problem_id, skillBundleId: row.target_skill_bundle_id,
          difficulty: row.difficulty, targetTags: parseJSON(row.target_tags_json, []), answer,
          answerImagePath: row.answer_asset_path, grading: grades[index]!, reviewedAt: now,
        })) inserted += 1
      }
      const consumedItems = Math.min(loopRow.item_budget, loopRow.consumed_items + inserted)
      const bundleStates = await select<Array<Record<string, unknown>>>(`SELECT state.* FROM skill_bundle_states state
        WHERE state.skill_bundle_id IN (SELECT DISTINCT target_skill_bundle_id FROM practice_items WHERE practice_set_id=$1)`, [practiceSet.id])
      const decision = decidePracticeLoop({
        results: grades as PracticeGradingResult[], targetStates: bundleStates.map(skillFromRow),
        consumedItems, itemBudget: loopRow.item_budget,
      })
      await execute(`UPDATE practice_attempts SET status='completed',submitted_at=$1,error_message=NULL,updated_at=$1 WHERE id=$2`, [now, attempt.id])
      await execute(`UPDATE practice_loop_rounds SET status='completed',completed_at=$1
        WHERE practice_loop_id=$2 AND practice_set_id=$3`, [now, loopId, practiceSet.id])
      await execute(`UPDATE practice_loops SET status=$1,consumed_items=$2,stop_reason=$3,updated_at=$4 WHERE id=$5`, [
        decision.status, consumedItems, decision.stopReason, now, loopId,
      ])
      await execute('COMMIT')
      const row = (await select<LoopRow[]>(`${loopSelect} WHERE loop.id=$1`, [loopId]))[0]
      return loopFromRow(row)
    } catch (error) {
      try { await execute('ROLLBACK') } catch { /* original error wins */ }
      throw error
    }
  })
  if (finalized.status !== 'needs_reinforcement' || finalized.nextPracticeSetId) return finalized
  try {
    const next = await getOrCreatePracticeSetFromPracticeAttempt(attempt.id, Math.min(3, finalized.itemBudget - finalized.consumedItems))
    const now = Date.now()
    await withTransactionLock(async () => {
      await execute('BEGIN IMMEDIATE')
      try {
        await execute(`INSERT OR IGNORE INTO practice_loop_rounds(id,practice_loop_id,practice_set_id,round_index,source_attempt_id,status,created_at)
          VALUES($1,$2,$3,$4,$5,'active',$6)`, [uuid(), finalized.id, next.id, finalized.roundIndex + 1, attempt.id, now])
        await execute(`UPDATE practice_loops SET current_practice_set_id=$1,status='active',round_index=round_index+1,updated_at=$2 WHERE id=$3 AND current_practice_set_id!=$1`, [next.id, now, finalized.id])
        await execute('COMMIT')
      } catch (error) { try { await execute('ROLLBACK') } catch { /* original error wins */ } throw error }
    })
  } catch {
    await execute(`UPDATE practice_loops SET status='stopped',stop_reason='no_distinct_items',updated_at=$1 WHERE id=$2`, [Date.now(), finalized.id])
  }
  return (await getPracticeLoopForSet(practiceSet.id))!
}

export async function stopPracticeLoop(loopId: string) {
  await execute(`UPDATE practice_loops SET status='stopped',stop_reason='user_stopped',updated_at=$1
    WHERE id=$2 AND status IN ('active','needs_reinforcement')`, [Date.now(), loopId])
}

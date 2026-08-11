import { invoke } from '@tauri-apps/api/core'
import { getStudentAttemptProvidersForRun, getSubjectivePracticeGradingProviders } from '../ai/provider'
import type { PracticeItem, PracticeSet } from '../domain/practice'
import type { PracticeAttempt } from '../domain/practiceAttempt'
import { gradePracticeAnswer, type PracticeCorrectness, type PracticeGradingResult, type StructuredStudentAnswer } from '../domain/practiceGrading'
import { getLatestPracticeAttempt } from './practiceAttemptDatabase'

interface ExecuteResult { rowsAffected: number; lastInsertId: number }
const execute = (sql: string, params: unknown[] = []) => invoke<ExecuteResult>('db_execute', { sql, params })

function status(result: PracticeGradingResult) {
  return result.requiresReview ? 'needs_review' : 'graded'
}

function canonicalSolution(item: PracticeItem) {
  try {
    const parsed = JSON.parse(item.solutionJson) as { contentMarkdown?: string; steps?: Array<{ content?: string; contentMarkdown?: string; content_markdown?: string }> }
    return parsed.contentMarkdown ?? parsed.steps?.map((step) => step.content ?? step.contentMarkdown ?? step.content_markdown ?? '').filter(Boolean).join('\n') ?? ''
  } catch { return '' }
}

async function grade(item: PracticeItem, answer: StructuredStudentAnswer) {
  const deterministic = gradePracticeAnswer(item, answer)
  if (!deterministic.requiresReview) return deterministic
  const provider = getSubjectivePracticeGradingProviders()[0]
  return (await provider.gradeSubjectivePractice({
    subject: item.subject, statementMarkdown: item.statementMarkdown, canonicalAnswer: item.canonicalAnswer,
    canonicalSolution: canonicalSolution(item), rubric: item.gradingRubric, studentAnswer: answer,
  })).grading
}

async function persistAIExtraction(responseId: string, answer: StructuredStudentAnswer, result: PracticeGradingResult) {
  await execute(`UPDATE practice_responses SET extracted_answer_json=$1, corrected_answer_json=NULL,
    grading_result_json=$2, status=$3, updated_at=$4 WHERE id=$5`,
  [JSON.stringify(answer), JSON.stringify(result), status(result), Date.now(), responseId])
}

export async function extractAndGradePracticeAttempt(practiceSet: PracticeSet, attempt: PracticeAttempt) {
  await execute("UPDATE practice_attempts SET status='extracting', error_message=NULL, updated_at=$1 WHERE id=$2", [Date.now(), attempt.id])
  try {
    const provider = getStudentAttemptProvidersForRun('', '')[0]
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
      await persistAIExtraction(response.regionId, answer, await grade(item, answer))
    }
    await execute("UPDATE practice_attempts SET status='extracted', error_message=NULL, updated_at=$1 WHERE id=$2", [Date.now(), attempt.id])
  } catch (error) {
    await execute("UPDATE practice_attempts SET status='failed', error_message=$1, updated_at=$2 WHERE id=$3", [String(error), Date.now(), attempt.id])
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
  const grading = await grade(item, answer)
  await execute(`UPDATE practice_responses SET corrected_answer_json=$1, grading_result_json=$2,
    status=$3, updated_at=$4 WHERE id=$5`,
  [JSON.stringify(answer), JSON.stringify(grading), status(grading), Date.now(), responseId])
  return { answer, grading }
}

export async function overridePracticeGrade(responseId: string, correctness: Exclude<PracticeCorrectness, 'needs_review'>) {
  const score = correctness === 'correct' ? 100 : correctness === 'partial' ? 50 : 0
  const grading: PracticeGradingResult = {
    correctness, score, method: 'manual', errorCategory: correctness === 'correct' ? null : 'user_confirmed_error',
    evidence: ['用户已检查作答与标准答案'], explanation: '本结果由用户确认，优先于自动批改。',
    requiresReview: false, userConfirmed: true,
  }
  await execute("UPDATE practice_responses SET grading_result_json=$1, status='graded', updated_at=$2 WHERE id=$3",
    [JSON.stringify(grading), Date.now(), responseId])
  return grading
}

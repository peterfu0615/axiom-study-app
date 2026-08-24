import { invoke } from '@tauri-apps/api/core'
import {
  getPracticeVariantGenerationProviders,
  getPracticeVariantVerificationProviders,
} from '../ai/provider'
import { classifyAIError } from '../domain/aiError'
import type { DifficultyLevel } from '../domain/models'
import type { PracticeProblemCandidate } from '../domain/practice'
import {
  createPracticeVariantPlan,
  validatePracticeVariant,
  variantPlanEligibilityErrors,
  type PracticeVariantCandidate,
  type PracticeVariantPlan,
  type PracticeVariantVerification,
} from '../domain/variantPractice'

interface ExecuteResult { rowsAffected: number; lastInsertId: number }
const execute = (sql: string, params: unknown[] = []) => invoke<ExecuteResult>('db_execute', { sql, params })
const select = <T>(sql: string, params: unknown[] = []) => invoke<T>('db_select', { sql, params })
const uuid = () => crypto.randomUUID()

export interface PreparedPracticeVariant {
  plan: PracticeVariantPlan
  candidate: PracticeVariantCandidate
  verification: PracticeVariantVerification
  provider: string
  model: string
  generationModelRunId: string
  verificationModelRunId: string
}

export interface PracticeVariantPreparationOutcome {
  planId: string
  variant: PreparedPracticeVariant | null
  fallbackCode: string | null
}

interface CachedVariantRow {
  plan_id: string; subject: string; source_problem_id: string; skill_bundle_id: string | null
  target_tags_json: string; target_difficulty: DifficultyLevel; invariants_json: string
  allowed_changes_json: string; forbidden_changes_json: string; source_input_hash: string
  prompt_version: PracticeVariantPlan['promptVersion']; schema_version: PracticeVariantPlan['schemaVersion']
  plan_created_at: number; candidate_json: string; verification_json: string
  provider: string; model: string; generation_run_id: string; verification_run_id: string
}

async function findCachedVariant(plan: PracticeVariantPlan): Promise<PreparedPracticeVariant | null> {
  const rows = await select<CachedVariantRow[]>(
    `SELECT plan.id AS plan_id,plan.subject,plan.source_problem_id,plan.skill_bundle_id,
      plan.target_tags_json,plan.target_difficulty,plan.invariants_json,plan.allowed_changes_json,
      plan.forbidden_changes_json,plan.source_input_hash,plan.prompt_version,plan.schema_version,
      plan.created_at AS plan_created_at,candidate.candidate_json,candidate.verification_json,
      generation.provider,generation.model,generation.id AS generation_run_id,
      verification.id AS verification_run_id
     FROM variant_plans plan
     JOIN variant_candidates candidate ON candidate.id=plan.selected_candidate_id AND candidate.status='verified'
     JOIN variant_model_runs generation ON generation.id=candidate.generation_model_run_id
     JOIN variant_model_runs verification ON verification.id=candidate.verification_model_run_id
     WHERE plan.source_problem_id=$1 AND plan.target_difficulty=$2 AND plan.source_input_hash=$3
       AND plan.prompt_version=$4 AND plan.schema_version=$5 AND plan.status='verified'
       AND NOT EXISTS (
         SELECT 1 FROM practice_items used_item
         JOIN practice_responses used_response ON used_response.practice_item_id=used_item.id
         JOIN practice_evidences used_evidence ON used_evidence.practice_response_id=used_response.id
         WHERE used_item.variant_plan_id=plan.id
       )
     ORDER BY plan.updated_at DESC LIMIT 1`,
    [plan.sourceProblemId, plan.targetDifficulty, plan.sourceInputHash, plan.promptVersion, plan.schemaVersion],
  )
  const row = Array.isArray(rows) ? rows[0] : undefined
  if (!row) return null
  return {
    plan: {
      id: row.plan_id, subject: row.subject, sourceProblemId: row.source_problem_id,
      skillBundleId: row.skill_bundle_id, targetTags: JSON.parse(row.target_tags_json),
      targetDifficulty: row.target_difficulty, invariants: JSON.parse(row.invariants_json),
      allowedChanges: JSON.parse(row.allowed_changes_json), forbiddenChanges: JSON.parse(row.forbidden_changes_json),
      sourceInputHash: row.source_input_hash, promptVersion: row.prompt_version,
      schemaVersion: row.schema_version, createdAt: Number(row.plan_created_at),
    },
    candidate: JSON.parse(row.candidate_json), verification: JSON.parse(row.verification_json),
    provider: row.provider, model: row.model, generationModelRunId: row.generation_run_id,
    verificationModelRunId: row.verification_run_id,
  }
}

async function persistPlan(plan: PracticeVariantPlan) {
  await execute(`INSERT INTO variant_plans(
    id,subject,source_problem_id,skill_bundle_id,target_tags_json,target_difficulty,
    invariants_json,allowed_changes_json,forbidden_changes_json,source_input_hash,
    prompt_version,schema_version,status,created_at,updated_at
  ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'planned',$13,$13)`, [
    plan.id, plan.subject, plan.sourceProblemId, plan.skillBundleId, JSON.stringify(plan.targetTags),
    plan.targetDifficulty, JSON.stringify(plan.invariants), JSON.stringify(plan.allowedChanges),
    JSON.stringify(plan.forbiddenChanges), plan.sourceInputHash, plan.promptVersion, plan.schemaVersion, plan.createdAt,
  ])
}

async function updatePlan(planId: string, status: 'generating' | 'verified' | 'rejected' | 'failed', input: {
  candidateId?: string | null
  failureCode?: string | null
} = {}) {
  await execute(`UPDATE variant_plans SET status=$1,selected_candidate_id=$2,failure_code=$3,updated_at=$4
    WHERE id=$5 AND status!='verified'`, [status, input.candidateId ?? null, input.failureCode ?? null, Date.now(), planId])
}

async function beginRun(plan: PracticeVariantPlan, stage: 'generation' | 'verification', provider: string, model: string) {
  const id = uuid()
  const createdAt = Date.now()
  await execute(`INSERT INTO variant_model_runs(
    id,variant_plan_id,stage,provider,model,prompt_version,schema_version,input_hash,status,created_at
  ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'processing',$9)`, [
    id, plan.id, stage, provider, model, plan.promptVersion, plan.schemaVersion,
    `${plan.sourceInputHash}:${stage}`, createdAt,
  ])
  return { id, createdAt }
}

async function completeRun(run: { id: string; createdAt: number }, output: unknown, rawOutput: string) {
  await execute(`UPDATE variant_model_runs SET output_json=$1,raw_output=$2,latency_ms=$3,
    status='completed',finished_at=$4 WHERE id=$5`, [
    JSON.stringify(output), rawOutput, Math.max(0, Date.now() - run.createdAt), Date.now(), run.id,
  ])
}

async function failRun(run: { id: string; createdAt: number }, reason: unknown) {
  const error = classifyAIError(reason, { runId: run.id })
  const rawOutput = reason && typeof reason === 'object' && 'rawOutput' in reason
    && typeof (reason as { rawOutput?: unknown }).rawOutput === 'string'
    ? (reason as { rawOutput: string }).rawOutput
    : ''
  await execute(`UPDATE variant_model_runs SET raw_output=$1,latency_ms=$2,status='failed',
    safe_error_code=$3,finished_at=$4 WHERE id=$5`, [
    rawOutput, Math.max(0, Date.now() - run.createdAt), error.code, Date.now(), run.id,
  ])
  return error.code
}

async function insertCandidate(planId: string, generationRunId: string, candidate: PracticeVariantCandidate) {
  const id = uuid()
  await execute(`INSERT INTO variant_candidates(
    id,variant_plan_id,generation_model_run_id,candidate_json,status,created_at
  ) VALUES($1,$2,$3,$4,'generated',$5)`, [id, planId, generationRunId, JSON.stringify(candidate), Date.now()])
  return id
}

async function rejectCandidate(candidateId: string, verificationRunId: string | null, verification: PracticeVariantVerification | null, errors: string[]) {
  await execute(`UPDATE variant_candidates SET verification_model_run_id=$1,verification_json=$2,
    validation_errors_json=$3,status='rejected' WHERE id=$4 AND status='generated'`, [
    verificationRunId, verification ? JSON.stringify(verification) : null, JSON.stringify(errors), candidateId,
  ])
}

async function verifyCandidate(candidateId: string, verificationRunId: string, verification: PracticeVariantVerification) {
  await execute(`UPDATE variant_candidates SET verification_model_run_id=$1,verification_json=$2,
    validation_errors_json='[]',status='verified' WHERE id=$3 AND status='generated'`, [
    verificationRunId, JSON.stringify(verification), candidateId,
  ])
}

export async function generateVerifiedPracticeVariant(input: {
  source: PracticeProblemCandidate
  targetDifficulty: DifficultyLevel
}): Promise<PracticeVariantPreparationOutcome> {
  const plan = createPracticeVariantPlan({ id: uuid(), source: input.source, targetDifficulty: input.targetDifficulty })
  const cached = await findCachedVariant(plan)
  if (cached) return { planId: cached.plan.id, variant: cached, fallbackCode: null }
  await persistPlan(plan)
  const eligibilityErrors = variantPlanEligibilityErrors(plan)
  if (eligibilityErrors.length) {
    const fallbackCode = eligibilityErrors.join(',')
    await updatePlan(plan.id, 'rejected', { failureCode: fallbackCode })
    return { planId: plan.id, variant: null, fallbackCode }
  }
  const generationProviders = getPracticeVariantGenerationProviders()
  const verificationProviders = getPracticeVariantVerificationProviders()
  if (!generationProviders.length) {
    await updatePlan(plan.id, 'rejected', { failureCode: 'no_variant_provider' })
    return { planId: plan.id, variant: null, fallbackCode: 'no_variant_provider' }
  }
  if (!verificationProviders.length) {
    await updatePlan(plan.id, 'rejected', { failureCode: 'no_variant_verification_provider' })
    return { planId: plan.id, variant: null, fallbackCode: 'no_variant_verification_provider' }
  }
  await updatePlan(plan.id, 'generating')
  let lastFailureCode = 'provider_exhausted'
  let hadValidationRejection = false
  for (const provider of generationProviders) {
    const generationRun = await beginRun(plan, 'generation', provider.id, provider.model)
    let candidate: PracticeVariantCandidate
    try {
      const generated = await provider.generatePracticeVariant({
        plan,
        source: {
          statementMarkdown: input.source.statementMarkdown,
          options: input.source.options,
          canonicalAnswer: input.source.canonicalAnswer,
          solutionJson: input.source.solutionJson,
          diagramImagePaths: input.source.diagramImagePaths,
        },
      })
      candidate = generated.candidate
      await completeRun(generationRun, candidate, generated.rawOutput)
    } catch (reason) {
      lastFailureCode = await failRun(generationRun, reason)
      continue
    }
    const candidateId = await insertCandidate(plan.id, generationRun.id, candidate)
    const verifiers = [
      ...verificationProviders.filter((candidateProvider) => candidateProvider.id !== provider.id),
      ...verificationProviders.filter((candidateProvider) => candidateProvider.id === provider.id),
    ]
    let verificationFailureCode = 'verification_provider_exhausted'
    for (const verifier of verifiers) {
      const verificationRun = await beginRun(plan, 'verification', verifier.id, verifier.model)
      try {
        const verified = await verifier.verifyPracticeVariant({ plan, candidate })
        await completeRun(verificationRun, verified.verification, verified.rawOutput)
        const errors = validatePracticeVariant(plan, input.source, candidate, verified.verification)
        if (errors.length) {
          await rejectCandidate(candidateId, verificationRun.id, verified.verification, errors)
          lastFailureCode = errors.join(',')
          hadValidationRejection = true
          break
        }
        await verifyCandidate(candidateId, verificationRun.id, verified.verification)
        await updatePlan(plan.id, 'verified', { candidateId })
        return {
          planId: plan.id,
          fallbackCode: null,
          variant: {
            plan, candidate, verification: verified.verification,
            provider: provider.id, model: provider.model,
            generationModelRunId: generationRun.id, verificationModelRunId: verificationRun.id,
          },
        }
      } catch (reason) {
        verificationFailureCode = await failRun(verificationRun, reason)
      }
    }
    if (!hadValidationRejection && verificationFailureCode !== 'verification_provider_exhausted') lastFailureCode = verificationFailureCode
    await rejectCandidate(candidateId, null, null, [verificationFailureCode])
  }
  await updatePlan(plan.id, hadValidationRejection ? 'rejected' : 'failed', { failureCode: lastFailureCode })
  return { planId: plan.id, variant: null, fallbackCode: lastFailureCode }
}

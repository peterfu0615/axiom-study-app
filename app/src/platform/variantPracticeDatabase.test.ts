import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { MockAIProvider, setAIProviderForTests, type AIProvider } from '../ai/provider'
import type { PracticeProblemCandidate } from '../domain/practice'
import { generateVerifiedPracticeVariant, listProblemVariantCandidates, stableVariantFingerprint } from './variantPracticeDatabase'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

const mockedInvoke = vi.mocked(invoke)
const source: PracticeProblemCandidate = {
  problemId: 'problem-1', targetSkillBundleId: 'bundle-1', subject: '数学',
  statementMarkdown: '解方程 $2x+1=5$', options: null, canonicalAnswer: 'x=2',
  solutionJson: JSON.stringify({ steps: [{ content: '移项得 2x=4' }, { content: 'x=2' }] }),
  targetTags: [
    { id: 'knowledge-1', name: '一元一次方程', type: 'knowledge', role: 'primary' },
    { id: 'method-1', name: '移项', type: 'method', role: 'primary' },
    { id: 'model-1', name: '解方程', type: 'model', role: 'primary' },
  ],
  diagramIds: [], questionImagePath: null, diagramImagePaths: [], originalDifficulty: 'basic', relevance: 1,
}

function provider(independentAnswer = 'y=3'): AIProvider {
  return {
    id: 'variant-provider', model: 'variant-model', supportsVision: false, supportsText: true,
    analyzeProblemImage: async () => { throw new Error('unused') },
    generatePracticeVariant: async () => ({
      candidate: {
        subject: '数学', statementMarkdown: '解方程 $3y+2=11$', options: null, canonicalAnswer: 'y=3',
        solutionJson: JSON.stringify({ contentMarkdown: '移项得 3y=9，所以 y=3。' }), difficulty: 'basic',
        targetTagIds: ['knowledge-1', 'method-1', 'model-1'],
        changes: [{ kind: 'numeric_values', summary: '修改系数和常数' }], diagramPolicy: 'none',
      },
      rawOutput: '{"candidate":true}',
    }),
    verifyPracticeVariant: async () => ({
      verification: {
        independentAnswer, independentSolutionJson: JSON.stringify({ contentMarkdown: 'y=3' }),
        conditionComplete: true, uniqueAnswer: true, preservesCoreKnowledge: true, preservesCoreMethod: true,
        preservesCoreModel: true, targetTagIds: ['knowledge-1', 'method-1', 'model-1'], difficulty: 'basic',
        diagramCompatible: true, usesOutOfScopeKnowledge: false,
        requiredStepCoverage: [
          { step: '移项得 2x=4', covered: true, evidence: '移项得 3y=9' },
          { step: 'x=2', covered: true, evidence: 'y=3' },
        ], notes: [],
      },
      rawOutput: '{"verification":true}',
    }),
  }
}

describe('variant practice persistence pipeline', () => {
  beforeEach(() => {
    mockedInvoke.mockReset().mockResolvedValue({ rowsAffected: 1, lastInsertId: 0 })
  })

  it('publishes only a separately verified candidate', async () => {
    setAIProviderForTests(provider())
    const outcome = await generateVerifiedPracticeVariant({ source, targetDifficulty: 'basic' })
    expect(outcome.fallbackCode).toBeNull()
    expect(outcome.variant?.candidate.statementMarkdown).toContain('3y')
    expect(outcome.variant?.generationModelRunId).not.toBe(outcome.variant?.verificationModelRunId)
    expect(mockedInvoke.mock.calls.some(([, input]) => String((input as { sql?: unknown }).sql).includes("status='verified'"))).toBe(true)
    expect(mockedInvoke.mock.calls.some(([, input]) => String((input as { sql?: unknown }).sql).includes('variation_level'))).toBe(true)
  })

  it('normalizes equivalent candidate surfaces into one instance fingerprint', () => {
    const candidate = provider().generatePracticeVariant
    expect(candidate).toBeTypeOf('function')
    const left = { subject: '数学', statementMarkdown: '解方程 $3x = 9$', options: null, canonicalAnswer: 'x = 3' }
    const right = { subject: ' 数学 ', statementMarkdown: '解方程\n$3x=9$', options: null, canonicalAnswer: 'x=3' }
    expect(stableVariantFingerprint(left)).toBe(stableVariantFingerprint(right))
  })

  it('lists every saved status with difficulty, variation level and provenance', async () => {
    mockedInvoke.mockResolvedValueOnce([{ id: 'candidate-1', plan_id: 'plan-1', plan_status: 'verified',
      candidate_status: 'verified', target_difficulty: 'advanced', variation_level: 'rebuild',
      candidate_json: JSON.stringify({ subject: '数学', statementMarkdown: '新题', options: null, canonicalAnswer: '1', solutionJson: '{}', difficulty: 'advanced', targetTagIds: [], changes: [], diagramPolicy: 'none' }),
      verification_json: null, validation_errors_json: '[]', instance_fingerprint: 'fingerprint-1',
      failure_code: null, created_at: 10 }])
    await expect(listProblemVariantCandidates('problem-1')).resolves.toMatchObject([
      { id: 'candidate-1', targetDifficulty: 'advanced', variationLevel: 'rebuild', instanceFingerprint: 'fingerprint-1' },
    ])
  })

  it('rejects an independently inconsistent answer and returns the original-question fallback', async () => {
    setAIProviderForTests(provider('y=4'))
    const outcome = await generateVerifiedPracticeVariant({ source, targetDifficulty: 'basic' })
    expect(outcome.variant).toBeNull()
    expect(outcome.fallbackCode).toContain('independent_answer_mismatch')
    expect(mockedInvoke.mock.calls.some(([, input]) => String((input as { sql?: unknown }).sql).includes("status='rejected'"))).toBe(true)
  })

  it('records an explicit fallback when no configured provider supports the task', async () => {
    setAIProviderForTests(new MockAIProvider(0))
    const outcome = await generateVerifiedPracticeVariant({ source, targetDifficulty: 'basic' })
    expect(outcome).toMatchObject({ variant: null, fallbackCode: 'no_variant_provider' })
  })
})

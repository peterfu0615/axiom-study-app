import { describe, expect, it } from 'vitest'
import {
  isCompleteCurriculumCheckpoint,
  clearsCurriculumCheckpoint,
  newCurriculumImportAction,
  nextSafeCurriculumStage,
  selectSingleCurriculumCheckpoint,
  shouldPersistCurriculumCheckpoint,
  type CurriculumCheckpointCandidate,
} from './curriculumImportPolicy'

function checkpoint(overrides: Partial<CurriculumCheckpointCandidate> = {}): CurriculumCheckpointCandidate {
  return {
    id: 'job-1', status: 'ai_analyzing_structure', resumeStage: 'ai_analyzing_structure',
    sourcePath: '/tmp/book.pdf', contentHash: 'hash', extractionJSON: '{}',
    provider: 'provider', model: 'model', promptVersion: 'prompt-v1',
    schemaVersion: 'schema-v1', updatedAt: 1, ...overrides,
  }
}

describe('single curriculum resume slot', () => {
  it.each(['select_file', 'extracting', 'vision_ocr', 'assembling_text', 'estimating_context'])(
    'does not treat pre-AI stage %s as resumable',
    (status) => expect(isCompleteCurriculumCheckpoint(checkpoint({ status }))).toBe(false),
  )

  it.each([
    'ai_analyzing_structure', 'ai_generating_tags', 'ai_auditing',
    'waiting_for_review', 'ai_failed_recoverable',
  ])('accepts the persisted AI state %s', (status) => {
    const resumeStage = status === 'ai_failed_recoverable' ? 'ai_generating_tags' : status
    expect(isCompleteCurriculumCheckpoint(checkpoint({ status, resumeStage }))).toBe(true)
  })

  it('keeps only the newest complete historical checkpoint', () => {
    const selected = selectSingleCurriculumCheckpoint([
      checkpoint({ id: 'old', updatedAt: 10 }),
      checkpoint({ id: 'broken-new', contentHash: null, updatedAt: 30 }),
      checkpoint({ id: 'valid-new', updatedAt: 20 }),
    ])
    expect(selected?.id).toBe('valid-new')
  })

  it('restarts the latest safe stage instead of claiming token-level continuation', () => {
    expect(nextSafeCurriculumStage('ai_analyzing_structure')).toBe('ai_analyzing_structure')
    expect(nextSafeCurriculumStage('ai_generating_tags')).toBe('ai_generating_tags')
    expect(nextSafeCurriculumStage('ai_auditing')).toBe('ai_auditing')
    expect(nextSafeCurriculumStage('waiting_for_review')).toBe('waiting_for_review')
  })

  it('does not recover when the app closes during OCR', () => {
    expect(shouldPersistCurriculumCheckpoint('vision_ocr', false)).toBe(false)
  })

  it('does not recover after extraction but before AI dispatch', () => {
    expect(shouldPersistCurriculumCheckpoint('assembling_text', false)).toBe(false)
  })

  it('shows one resume entry after an AI request is dispatched', () => {
    expect(shouldPersistCurriculumCheckpoint('ai_analyzing_structure', true)).toBe(true)
  })

  it('requires confirmation before a new import replaces the slot', () => {
    expect(newCurriculumImportAction(true)).toBe('confirm_abandon')
    expect(newCurriculumImportAction(false)).toBe('start')
  })

  it('retains retryable AI failure but clears abandoned and saved checkpoints', () => {
    expect(clearsCurriculumCheckpoint('retryable_failure')).toBe(false)
    expect(clearsCurriculumCheckpoint('abandoned')).toBe(true)
    expect(clearsCurriculumCheckpoint('saved')).toBe(true)
  })
})

import type { CurriculumImportStage, CurriculumImportStatus } from '../../domain/horizon'

export const recoverableCurriculumStatuses: readonly CurriculumImportStatus[] = [
  'ai_analyzing_structure',
  'ai_generating_tags',
  'ai_auditing',
  'waiting_for_review',
  'ai_failed_recoverable',
]

export interface CurriculumCheckpointCandidate {
  id: string
  status: string
  resumeStage: string
  sourcePath: string | null
  contentHash: string | null
  extractionJSON: string | null
  provider: string | null
  model: string | null
  promptVersion: string | null
  schemaVersion: string | null
  updatedAt: number
}

export function isCompleteCurriculumCheckpoint(candidate: CurriculumCheckpointCandidate) {
  return recoverableCurriculumStatuses.includes(candidate.status as CurriculumImportStatus) &&
    ['ai_analyzing_structure', 'ai_generating_tags', 'ai_auditing', 'waiting_for_review']
      .includes(candidate.resumeStage as CurriculumImportStage) &&
    Boolean(candidate.sourcePath && candidate.contentHash && candidate.extractionJSON &&
      candidate.provider && candidate.model && candidate.promptVersion && candidate.schemaVersion)
}

export function selectSingleCurriculumCheckpoint(candidates: CurriculumCheckpointCandidate[]) {
  return candidates
    .filter(isCompleteCurriculumCheckpoint)
    .sort((left, right) => right.updatedAt - left.updatedAt)[0] ?? null
}

export function nextSafeCurriculumStage(stage: CurriculumImportStage) {
  if (stage === 'ai_analyzing_structure') return 'ai_analyzing_structure'
  if (stage === 'ai_generating_tags') return 'ai_generating_tags'
  if (stage === 'ai_auditing') return 'ai_auditing'
  return 'waiting_for_review'
}

export function shouldPersistCurriculumCheckpoint(
  stage: string,
  extractionPersisted: boolean,
) {
  // The durable checkpoint is written as soon as the extraction result has
  // been stored on the job row — before any AI request is submitted — so a
  // crash between OCR and AI dispatch cannot lose the whole-book extraction.
  // Recovery then reuses the persisted extractionJSON and never re-extracts.
  return extractionPersisted &&
    recoverableCurriculumStatuses.includes(stage as CurriculumImportStatus)
}

export function newCurriculumImportAction(hasResumeSlot: boolean) {
  return hasResumeSlot ? 'confirm_abandon' : 'start' as const
}

export function clearsCurriculumCheckpoint(event: 'abandoned' | 'saved' | 'retryable_failure') {
  return event !== 'retryable_failure'
}

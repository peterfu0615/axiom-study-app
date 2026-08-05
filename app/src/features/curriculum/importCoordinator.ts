import type { CurriculumImportJob } from '../../domain/horizon'
import {
  getCurriculumImportJob,
  reconcileCurriculumImportResumeSlot,
  runCurriculumImportJob,
} from '../../platform/horizonDatabase'
import { isCurriculumAnalysisRunning } from './curriculumAnalysisStatus'

const activeJobs = new Set<string>()
const resumeSettleListeners = new Set<(job: CurriculumImportJob) => void>()
let startupResume: Promise<CurriculumImportJob | null> | null = null

export async function startCurriculumImport(jobId: string, resumeAfterRestart = false) {
  if (activeJobs.has(jobId)) return getCurriculumImportJob(jobId)
  activeJobs.add(jobId)
  try {
    return await runCurriculumImportJob(jobId, {
      // A previous process cannot have a live local worker.  The native lease
      // atomically supersedes that stale request before re-dispatching it.
      restartActiveAttempt: resumeAfterRestart,
    })
  } finally {
    activeJobs.delete(jobId)
  }
}

export async function resumeCurriculumImports(
  onSettled?: (job: CurriculumImportJob) => void,
) {
  if (onSettled) resumeSettleListeners.add(onSettled)
  if (startupResume) return startupResume
  startupResume = (async () => {
    const slot = await reconcileCurriculumImportResumeSlot()
    if (slot && isCurriculumAnalysisRunning(slot)) {
      // App startup is the only implicit recovery signal. Opening the progress
      // page never reaches this coordinator and therefore cannot create an
      // attempt or redispatch a provider request.
      void startCurriculumImport(slot.id, true)
        .then((finished) => {
          // Publish the terminal state immediately instead of waiting for the
          // next poll tick: the store disarms its timer once the job stops
          // running, so completed/failed states must be pushed proactively.
          if (!finished) return
          for (const listener of [...resumeSettleListeners]) listener(finished)
        })
        .catch(() => {
          // The persisted row keeps the failure state; the status store picks
          // it up on its next refresh.  Only the listeners are dropped here.
        })
        .finally(() => {
          resumeSettleListeners.clear()
        })
    }
    return slot
  })()
  return startupResume
}

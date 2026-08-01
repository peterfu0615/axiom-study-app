import {
  getCurriculumImportJob,
  reconcileCurriculumImportResumeSlot,
  runCurriculumImportJob,
} from '../../platform/horizonDatabase'
import { isCurriculumAnalysisRunning } from './curriculumAnalysisStatus'

const activeJobs = new Set<string>()
let startupResume: Promise<Awaited<ReturnType<typeof getCurriculumImportJob>>> | null = null

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

export async function resumeCurriculumImports() {
  if (startupResume) return startupResume
  startupResume = (async () => {
    const slot = await reconcileCurriculumImportResumeSlot()
    if (slot && isCurriculumAnalysisRunning(slot)) {
      // App startup is the only implicit recovery signal. Opening the progress
      // page never reaches this coordinator and therefore cannot create an
      // attempt or redispatch a provider request.
      void startCurriculumImport(slot.id, true)
    }
    return slot
  })()
  return startupResume
}

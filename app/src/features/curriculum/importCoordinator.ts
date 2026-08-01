import {
  getCurriculumImportJob,
  reconcileCurriculumImportResumeSlot,
  runCurriculumImportJob,
} from '../../platform/horizonDatabase'

const activeJobs = new Set<string>()

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
  return reconcileCurriculumImportResumeSlot()
}

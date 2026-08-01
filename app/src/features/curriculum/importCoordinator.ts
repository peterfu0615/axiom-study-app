import {
  getCurriculumImportJob,
  reconcileCurriculumImportResumeSlot,
  runCurriculumImportJob,
} from '../../platform/horizonDatabase'

const activeJobs = new Set<string>()

export async function startCurriculumImport(jobId: string) {
  if (activeJobs.has(jobId)) return getCurriculumImportJob(jobId)
  activeJobs.add(jobId)
  try {
    return await runCurriculumImportJob(jobId)
  } finally {
    activeJobs.delete(jobId)
  }
}

export async function resumeCurriculumImports() {
  return reconcileCurriculumImportResumeSlot()
}

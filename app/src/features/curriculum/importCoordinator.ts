import {
  getCurriculumImportJob,
  listCurriculumImportJobs,
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
  const jobs = await listCurriculumImportJobs()
  await Promise.all(
    jobs
      .filter((job) => ['pending', 'extracting', 'recognizing'].includes(job.status))
      .map((job) => startCurriculumImport(job.id)),
  )
}

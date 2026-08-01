import { curriculumGlobalStatus } from './curriculumAnalysisStatus'
import { useCurriculumAnalysisStatus } from './CurriculumAnalysisContext'
import './CurriculumAnalysisStatus.css'

export function CurriculumAnalysisStatusButton({ onOpen }: { onOpen: () => void }) {
  const { job, openProgress } = useCurriculumAnalysisStatus()
  const status = curriculumGlobalStatus(job)
  if (!job || !status) return null
  return (
    <button
      aria-label={`${status.label}，查看分析进度`}
      className={`curriculum-analysis-status-button is-${status.kind}`}
      onClick={() => { openProgress(job.id); onOpen() }}
      title="查看分析进度"
      type="button"
    >
      {status.animated && <span aria-hidden="true" className="curriculum-analysis-status-button__glow" />}
      <span className="curriculum-analysis-status-button__copy">
        <strong>{status.label}</strong>
        {status.detail && <small>{status.detail}</small>}
      </span>
    </button>
  )
}

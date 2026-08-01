import { curriculumGlobalStatus } from './curriculumAnalysisStatus'
import { useCurriculumAnalysisStatus } from './CurriculumAnalysisContext'
import './CurriculumAnalysisStatus.css'

export function CurriculumAnalysisStatusPill({ onOpen }: { onOpen: () => void }) {
  const { job, openProgress } = useCurriculumAnalysisStatus()
  const status = curriculumGlobalStatus(job)
  if (!job || !status) return null
  return (
    <button
      aria-label={`${status.label}，查看分析进度`}
      className={`curriculum-analysis-status-pill is-${status.kind}`}
      onClick={() => { openProgress(job.id); onOpen() }}
      title="查看分析进度"
      type="button"
    >
      {status.animated && <span aria-hidden="true" className="curriculum-analysis-status-pill__glow" />}
      <span className="curriculum-analysis-status-pill__copy">
        <strong>{status.label}</strong>
        {status.detail && <small>{status.detail}</small>}
      </span>
    </button>
  )
}

/** @deprecated Use CurriculumAnalysisStatusPill in the curriculum header. */
export const CurriculumAnalysisStatusButton = CurriculumAnalysisStatusPill

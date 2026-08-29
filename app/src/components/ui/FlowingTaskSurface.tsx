import { useId, type ReactNode } from 'react'
import './FlowingTaskSurface.css'

export type FlowingTaskState =
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'idle'

export interface FlowingTaskSurfaceProps {
  state: FlowingTaskState
  title: string
  detail?: string | null
  progress?: number | null
  progressCurrent?: number | null
  progressTotal?: number | null
  progressLabel?: string | null
  compact?: boolean
  widthMode?: 'content' | 'full'
  actions?: ReactNode
  children?: ReactNode
}

function normalizedProgress(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return null
  return Math.min(1, Math.max(0, value))
}

export function FlowingTaskSurface({
  state,
  title,
  detail,
  progress,
  progressCurrent,
  progressTotal,
  progressLabel,
  compact = false,
  widthMode = 'content',
  actions,
  children,
}: FlowingTaskSurfaceProps) {
  const headingId = useId()
  const fraction = normalizedProgress(progress)
  const hasCount = Number.isFinite(progressCurrent) && Number.isFinite(progressTotal)
    && Number(progressTotal) > 1
  const determinate = fraction !== null
  const visibleProgressLabel = progressLabel && progressLabel !== title ? progressLabel : null

  return (
    <section
      aria-labelledby={headingId}
      className={`flowing-task-surface flowing-task-surface--${state}${compact ? ' is-compact' : ''}${widthMode === 'full' ? ' is-full-width' : ''}`}
    >
      <div className="flowing-task-surface__header">
        <div aria-atomic="true" aria-live="polite" className="flowing-task-surface__heading" role={state === 'failed' ? 'alert' : 'status'}>
          <h2 id={headingId}>{state === 'running' && <span aria-hidden="true" className="ax-spinner flowing-task-surface__spinner" />}{title}</h2>
          {detail && <p>{detail}</p>}
        </div>
        {state === 'paused' && <span className="flowing-task-surface__state">已暂停</span>}
        {state === 'completed' && <span className="flowing-task-surface__state">已完成</span>}
        {state === 'failed' && <span className="flowing-task-surface__state">失败</span>}
      </div>

      {determinate && (
        <div
          aria-label={progressLabel || title}
          aria-valuemax={1}
          aria-valuemin={0}
          aria-valuenow={fraction}
          className="flowing-task-surface__progress"
          role="progressbar"
        >
          <span style={{ width: `${fraction * 100}%` }} />
        </div>
      )}

      {(visibleProgressLabel || hasCount) && (
        <div className="flowing-task-surface__meta">
          {visibleProgressLabel && <span>{visibleProgressLabel}</span>}
          {hasCount && <span>{Number(progressCurrent)} / {Number(progressTotal)}</span>}
        </div>
      )}
      {children}
      {actions && <div className="flowing-task-surface__actions">{actions}</div>}
    </section>
  )
}

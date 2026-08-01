import type { CurriculumImportJob, CurriculumImportStatus } from '../../domain/horizon'

export const runningCurriculumStatuses: CurriculumImportStatus[] = [
  'ai_analyzing_structure',
  'ai_generating_tags',
  'ai_auditing',
]

export function isCurriculumAnalysisRunning(job: CurriculumImportJob | null) {
  return Boolean(job && runningCurriculumStatuses.includes(job.status))
}

export function curriculumAnalysisStageLabel(job: CurriculumImportJob) {
  if (job.status === 'ai_analyzing_structure') return '正在识别教材结构'
  if (job.status === 'ai_generating_tags') return '标签创建中'
  if (job.status === 'ai_auditing') return '正在检查分析结果'
  return '正在分析中'
}

export function curriculumAnalysisProgress(job: CurriculumImportJob) {
  const stageFallback = job.status === 'ai_analyzing_structure' ? .05
    : job.status === 'ai_generating_tags' ? .3
      : job.status === 'ai_auditing' ? .85
        : job.status === 'waiting_for_review' ? 1 : .05
  return Math.min(1, Math.max(0, Number.isFinite(job.progressFraction)
    ? Math.max(stageFallback, job.progressFraction)
    : stageFallback))
}

export type CurriculumGlobalStatusKind = 'running' | 'completed' | 'failed'

export function curriculumGlobalStatus(job: CurriculumImportJob | null): {
  kind: CurriculumGlobalStatusKind
  label: string
  detail: string | null
  animated: boolean
} | null {
  if (!job) return null
  if (isCurriculumAnalysisRunning(job)) {
    return {
      kind: 'running',
      label: '分析教材中',
      detail: curriculumAnalysisStageLabel(job),
      animated: true,
    }
  }
  if (job.status === 'waiting_for_review') {
    return { kind: 'completed', label: '分析完成', detail: null, animated: false }
  }
  return { kind: 'failed', label: '分析已暂停', detail: null, animated: false }
}

interface IntervalScheduler {
  set(callback: () => void, intervalMs: number): unknown
  clear(handle: unknown): void
}

const browserScheduler: IntervalScheduler = {
  set: (callback, intervalMs) => globalThis.setInterval(callback, intervalMs),
  clear: (handle) => globalThis.clearInterval(handle as ReturnType<typeof setInterval>),
}

/**
 * One store instance is mounted above every workspace.  It owns the only
 * curriculum status timer; route components subscribe but never start their
 * own poller or infer durable state from React memory.
 */
export class CurriculumAnalysisStatusStore {
  private job: CurriculumImportJob | null = null
  private listeners = new Set<() => void>()
  private timer: unknown = null
  private started = false
  private refreshPromise: Promise<CurriculumImportJob | null> | null = null
  private readonly loadSlot: () => Promise<CurriculumImportJob | null>
  private readonly pollIntervalMs: number
  private readonly scheduler: IntervalScheduler

  constructor(
    loadSlot: () => Promise<CurriculumImportJob | null>,
    pollIntervalMs = 900,
    scheduler: IntervalScheduler = browserScheduler,
  ) {
    this.loadSlot = loadSlot
    this.pollIntervalMs = pollIntervalMs
    this.scheduler = scheduler
  }

  getSnapshot = () => this.job

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async start(initializer: () => Promise<CurriculumImportJob | null> = this.loadSlot) {
    if (this.started) return this.job
    this.started = true
    const snapshotBeforeInitialization = this.job
    const job = await initializer()
    // A new import may be published while the startup read is still pending.
    // Never let an older empty snapshot erase that newly created single slot.
    if (this.started && (job || this.job === snapshotBeforeInitialization)) this.publish(job)
    return job
  }

  stop() {
    this.started = false
    this.disarm()
  }

  publish(job: CurriculumImportJob | null) {
    this.job = job
    for (const listener of this.listeners) listener()
    if (isCurriculumAnalysisRunning(job)) this.arm()
    else this.disarm()
  }

  async refresh() {
    if (this.refreshPromise) return this.refreshPromise
    this.refreshPromise = this.loadSlot()
      .then((job) => {
        this.publish(job)
        return job
      })
      .finally(() => { this.refreshPromise = null })
    return this.refreshPromise
  }

  private arm() {
    if (this.timer != null || !this.started) return
    this.timer = this.scheduler.set(() => { void this.refresh() }, this.pollIntervalMs)
  }

  private disarm() {
    if (this.timer == null) return
    this.scheduler.clear(this.timer)
    this.timer = null
  }
}

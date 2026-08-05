import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import type { CurriculumImportJob } from '../../domain/horizon'
import {
  getCurriculumImportResumeSlot,
  reconcileCurriculumImportResumeSlot,
} from '../../platform/horizonDatabase'
import { resumeCurriculumImports } from './importCoordinator'
import { CurriculumAnalysisStatusStore } from './curriculumAnalysisStatus'

interface CurriculumAnalysisContextValue {
  job: CurriculumImportJob | null
  openedJobId: string | null
  openProgress: (jobId?: string) => void
  closeProgress: () => void
  publishJob: (job: CurriculumImportJob | null) => void
  refresh: () => Promise<CurriculumImportJob | null>
}

const CurriculumAnalysisContext = createContext<CurriculumAnalysisContextValue | null>(null)

export function CurriculumAnalysisProvider({
  children,
  enabled = true,
  resumeOnMount = true,
  initialJob,
}: {
  children?: ReactNode
  enabled?: boolean
  resumeOnMount?: boolean
  initialJob?: CurriculumImportJob | null
}) {
  const storeRef = useRef<CurriculumAnalysisStatusStore | null>(null)
  if (!storeRef.current) {
    storeRef.current = new CurriculumAnalysisStatusStore(getCurriculumImportResumeSlot)
    if (initialJob !== undefined) storeRef.current.publish(initialJob)
  }
  const store = storeRef.current
  const job = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const [openedJobId, setOpenedJobId] = useState<string | null>(null)

  useEffect(() => {
    if (initialJob !== undefined) store.publish(initialJob)
    if (!enabled) return undefined
    void store.start(
      resumeOnMount
        // The resume worker publishes its terminal state so completed/failed
        // jobs surface immediately instead of waiting for the next poll tick.
        ? () => resumeCurriculumImports((finished) => store.publish(finished))
        : reconcileCurriculumImportResumeSlot,
    )
    return () => store.stop()
  }, [enabled, initialJob, resumeOnMount, store])

  useEffect(() => {
    if (openedJobId && (!job || openedJobId !== job.id)) setOpenedJobId(null)
  }, [job, openedJobId])

  const openProgress = useCallback((jobId?: string) => {
    const target = jobId ?? store.getSnapshot()?.id
    if (target) setOpenedJobId(target)
    // Opening the progress view is a direct user intent signal: force one
    // refresh so a job that settled between poll ticks is never shown stale.
    void store.refresh()
  }, [store])
  const closeProgress = useCallback(() => setOpenedJobId(null), [])
  const publishJob = useCallback((next: CurriculumImportJob | null) => store.publish(next), [store])
  const refresh = useCallback(() => store.refresh(), [store])
  const value = useMemo(() => ({
    job, openedJobId, openProgress, closeProgress, publishJob, refresh,
  }), [closeProgress, job, openProgress, openedJobId, publishJob, refresh])

  return <CurriculumAnalysisContext.Provider value={value}>{children}</CurriculumAnalysisContext.Provider>
}

// The hook intentionally shares this module's private Context with its Provider.
// oxlint-disable-next-line react/only-export-components
export function useCurriculumAnalysisStatus() {
  const value = useContext(CurriculumAnalysisContext)
  if (!value) throw new Error('useCurriculumAnalysisStatus 必须在 CurriculumAnalysisProvider 中使用')
  return value
}

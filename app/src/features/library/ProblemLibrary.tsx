import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type {
  ModelRun,
  NormalizedRect,
  ProblemAIStatus,
  ProblemRegionType,
  ReasoningAnalysis,
  SavedProblem,
  Solution,
  StudentAttempt,
} from '../../domain/models'
import {
  AI_STATUS_EVENT,
  runProblemAIWorker,
} from '../../ai/pipeline'
import {
  runSolutionWorker,
  SOLUTION_STATUS_EVENT,
} from '../../ai/solutionPipeline'
import {
  deleteProblem,
  cancelProblemAI,
  getProblemSolution,
  getProblemRegions,
  getReasoningAnalysis,
  getStudentAttempt,
  listProblemModelRuns,
  listProblemDuplicateDecisions,
  listSavedProblems,
  queueProblemAI,
  queueProblemSolution,
  queueStudentAttempt,
  restoreProblem,
  searchSavedProblemIds,
  setProblemFavorite,
  decideProblemDuplicate,
  ProblemSubjectChangeConflict,
  ProblemSubjectChangeTagConflict,
  setProblemArchived,
  updateProblemUserFields,
} from '../../platform/database'
import { preferredRegions } from '../../domain/problemRegions'
import type { ProblemRegion } from '../../domain/models'
import { mediaAssetUrl } from '../../platform/native'
import { Icon } from '../../components/Icon'
import { Toast } from '../../components/Toast'
import { Button, Dialog, DiscreteSlider, ErrorState, FlowingTaskSurface, IconButton, Input, ListboxSelect, PageHeader, SearchField, SegmentedControl, Textarea } from '../../components/ui'
import { classifyAIError } from '../../domain/aiError'
import { useToast } from '../../platform/useToast'
import { ProblemCropEditor } from './ProblemCropEditor'
import {
  ExplainableProblemMarkdown,
  SolutionComparison,
} from './SolutionComparison'
import './ProblemTags.css'
import {
  INTELLIGENCE_STATUS_EVENT,
  runIntelligenceWorker,
} from '../../ai/intelligencePipeline'
import { ProblemTags } from './ProblemTags'
import { getProblemReviewHistory, type ProblemReviewHistoryEntry } from '../../platform/problemHistoryDatabase'
import { findProblemDuplicateSuggestions } from '../../domain/problemDuplicates'
import {
  createRelabelBatch,
  listTextbooks,
  setProblemTextbookMatches,
} from '../../platform/horizonDatabase'
import { startRelabelBatchWorker } from '../curriculum/relabelWorker'
import type { Textbook } from '../../domain/horizon'
import type { PersistedGeometryScene } from '../../domain/geometryScene'
import type { Diagram } from '../../domain/diagram'
import { DiagramView } from '../../components/DiagramView'
import {
  GEOMETRY_SCENE_STATUS_EVENT,
  getLatestGeometryScene,
  reconstructGeometryScene,
} from '../../platform/geometrySceneDatabase'
import { getPreferredDiagram } from '../../platform/diagramDatabase'
import {
  prepareSingleProblemVariant,
  type SingleVariantPreview,
} from '../../platform/practiceDatabase'
import { MathMarkdown } from '../../components/MathMarkdown'
import {
  listProblemVariantCandidates,
  type StoredVariantCandidate,
} from '../../platform/variantPracticeDatabase'
import type { VariantLevel } from '../../domain/variantPractice'
import { problemTypeLabel } from './problemType'

type LibraryView = 'active' | 'archived' | 'trash'

const difficultyLabels = { basic: '基础', intermediate: '中档', advanced: '进阶' } as const
const difficultyValues = ['basic', 'intermediate', 'advanced'] as const
const variationValues = ['numeric', 'condition', 'rebuild'] as const
const variationLabels: Record<VariantLevel, string> = {
  numeric: '改变数字',
  condition: '调整已知条件',
  rebuild: '重新构建',
}

function variantSolutionMarkdown(value: string) {
  try {
    const parsed = JSON.parse(value) as {
      contentMarkdown?: string
      content_markdown?: string
      steps?: Array<{ content?: string; contentMarkdown?: string; content_markdown?: string }>
    }
    const content = parsed.contentMarkdown ?? parsed.content_markdown
    if (content?.trim()) return content
    return (parsed.steps ?? []).map((step) => step.content ?? step.contentMarkdown ?? step.content_markdown ?? '').filter(Boolean).join('\n\n')
  } catch { return value }
}

function variantStatusLabel(item: StoredVariantCandidate) {
  if (item.candidateStatus === 'verified') return '已保存'
  if (item.candidate) return '已生成'
  if (item.planStatus === 'generating') return '生成中'
  if (item.planStatus === 'failed' || item.planStatus === 'rejected') return '未生成'
  return '待生成'
}

function variantProductError(error: unknown) {
  const value = String(error instanceof Error ? error.message : error)
  if (value.includes('题目内容不可用')) return '题目内容不可用，请重新裁剪或整理后再试。'
  if (/401|unauthorized|api key|认证/iu.test(value)) return 'AI 服务认证失败，请在设置中检查 API Key。'
  if (/provider|模型|model|endpoint|端点/iu.test(value)) return '当前 AI 服务暂时无法生成变式，请检查模型设置或稍后重试。'
  return '这次没有生成可用的变式，请稍后重试。'
}

const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

const aiStatusLabels: Record<ProblemAIStatus, string> = {
  not_started: 'AI 未处理',
  pending: 'AI 解析中…',
  processing: 'AI 解析中…',
  completed: 'AI 解析完成',
  failed: 'AI 解析失败',
}

function AIStatusContent({ status }: { status: ProblemAIStatus }) {
  if (status === 'pending' || status === 'processing') {
    return (
      <>
        <Icon name="ai" size={12} />
        <span className="ai-scanning-text">AI 正在整理</span>
      </>
    )
  }
  return <>{aiStatusLabels[status]}</>
}

function isUsableDiagramRect(
  rect: NormalizedRect | null,
): rect is NormalizedRect {
  return Boolean(
    rect &&
      Number.isFinite(rect.x) &&
      Number.isFinite(rect.y) &&
      Number.isFinite(rect.width) &&
      Number.isFinite(rect.height) &&
      rect.width > 0.001 &&
      rect.height > 0.001,
  )
}

function ProblemImage({
  alt,
  className,
  path,
}: {
  alt: string
  className: string
  path: string
}) {
  const [failed, setFailed] = useState(false)

  useEffect(() => setFailed(false), [path])

  if (failed) {
    return (
      <div className={`${className} missing-problem-image`} role="img">
        <span>图片不可用</span>
        <small>文件可能已被移动或删除</small>
      </div>
    )
  }

  return (
    <img
      alt={alt}
      className={className}
      decoding="async"
      loading="lazy"
      onError={() => setFailed(true)}
      src={mediaAssetUrl(path)}
    />
  )
}

function ProblemDiagramImage({
  alt,
  croppedPath,
  path,
  rect,
}: {
  alt: string
  croppedPath: string | null
  path: string
  rect: NormalizedRect
}) {
  const [aspectRatio, setAspectRatio] = useState<number | null>(null)
  const [failed, setFailed] = useState(false)
  const x = Math.min(1, Math.max(0, rect.x))
  const y = Math.min(1, Math.max(0, rect.y))
  const width = Math.min(1 - x, Math.max(0, rect.width))
  const height = Math.min(1 - y, Math.max(0, rect.height))
  const valid = width > 0.001 && height > 0.001

  useEffect(() => {
    setAspectRatio(null)
    setFailed(false)
  }, [croppedPath, path, x, y, width, height])

  if (!valid || failed) return null

  return (
    <figure className="problem-diagram-figure">
      <div
        className={`problem-diagram-crop ${
          croppedPath ? 'is-extracted' : ''
        }`}
        style={
          !croppedPath && aspectRatio
            ? { aspectRatio, minHeight: 0 }
            : undefined
        }
      >
        <img
          alt={alt}
          decoding="async"
          loading="lazy"
          onError={() => setFailed(true)}
          onLoad={(event) => {
            if (croppedPath) return
            const image = event.currentTarget
            setAspectRatio(
              (image.naturalWidth * width) /
                (image.naturalHeight * height),
            )
          }}
          src={mediaAssetUrl(croppedPath || path)}
          style={
            croppedPath
              ? undefined
              : {
                  left: `${(-x / width) * 100}%`,
                  top: `${(-y / height) * 100}%`,
                  width: `${100 / width}%`,
                }
          }
        />
      </div>
    </figure>
  )
}

export function ProblemLibrary() {
  const [view, setView] = useState<LibraryView>('active')
  const [problems, setProblems] = useState<SavedProblem[]>([])
  const [query, setQuery] = useState('')
  const [searchMatchIds, setSearchMatchIds] = useState<Set<string> | null>(null)
  const [subjectFilter, setSubjectFilter] = useState('all')
  const [difficultyFilter, setDifficultyFilter] = useState('all')
  const [textbookFilter, setTextbookFilter] = useState('all')
  const [chapterFilter, setChapterFilter] = useState('all')
  const [knowledgeFilter, setKnowledgeFilter] = useState('all')
  const [methodFilter, setMethodFilter] = useState('all')
  const [modelFilter, setModelFilter] = useState('all')
  const [reviewFilter, setReviewFilter] = useState('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState(false)
  const [editing, setEditing] = useState(false)
  const [recropping, setRecropping] = useState(false)
  const [modelRuns, setModelRuns] = useState<ModelRun[]>([])
  const [solution, setSolution] = useState<Solution | null>(null)
  const [studentAttempt, setStudentAttempt] = useState<StudentAttempt | null>(null)
  const [reasoning, setReasoning] = useState<ReasoningAnalysis | null>(null)
  const [selectedRegions, setSelectedRegions] = useState<ProblemRegion[]>([])
  const [reviewHistory, setReviewHistory] = useState<ProblemReviewHistoryEntry[]>([])
  const [geometryScene, setGeometryScene] = useState<PersistedGeometryScene | null>(null)
  const [generatedDiagram, setGeneratedDiagram] = useState<Diagram | null>(null)
  const [diagramView, setDiagramView] = useState<'generated' | 'original'>('generated')
  const [geometrySceneBusy, setGeometrySceneBusy] = useState(false)
  const [geometryDialogOpen, setGeometryDialogOpen] = useState(false)
  const [variantBusy, setVariantBusy] = useState(false)
  const [variantDialogOpen, setVariantDialogOpen] = useState(false)
  const [variantDialogError, setVariantDialogError] = useState<string | null>(null)
  const [variantDraftDifficulty, setVariantDraftDifficulty] = useState<'basic' | 'intermediate' | 'advanced'>('intermediate')
  const [variantLevel, setVariantLevel] = useState<VariantLevel>('numeric')
  const [singleVariantPreview, setSingleVariantPreview] = useState<SingleVariantPreview | null>(null)
  const [storedVariants, setStoredVariants] = useState<StoredVariantCandidate[]>([])
  const [activeVariantKey, setActiveVariantKey] = useState('')
  const [duplicateDecisionIds, setDuplicateDecisionIds] = useState<Set<string>>(new Set())
  const [batchMode, setBatchMode] = useState(false)
  const [batchProblemIds, setBatchProblemIds] = useState<Set<string>>(new Set())
  const [batchTextbookId, setBatchTextbookId] = useState('')
  const [batchTextbooks, setBatchTextbooks] = useState<Textbook[]>([])
  const [batchRunning, setBatchRunning] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editSubject, setEditSubject] = useState('')
  const [editStemMarkdown, setEditStemMarkdown] = useState('')
  const [editKnowledgePoints, setEditKnowledgePoints] = useState('')
  const [subjectChangeConfirming, setSubjectChangeConfirming] = useState(false)
  const [deleteConfirming, setDeleteConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const { toast, notify, dismiss, pauseAutoDismiss, resumeAutoDismiss } = useToast()
  // Event listeners must not be re-armed on every selection change, so they
  // read the current selection/view through refs instead of closing over them.
  const selectedIdRef = useRef<string | null>(null)
  const viewRef = useRef<LibraryView>('active')
  // A quiet refresh failure leaves the list potentially stale.  Remember it so
  // the next event-driven refresh becomes a visible (non-quiet) one.
  const dirtyRef = useRef(false)
  // AI pipelines emit one status event per run start/end; during batch runs
  // that floods the workspace with full-list reloads.  Coalesce them into a
  // single trailing refresh.
  const refreshTimerRef = useRef<number | null>(null)

  useEffect(() => () => {
    if (refreshTimerRef.current !== null) window.clearTimeout(refreshTimerRef.current)
  }, [])

  useEffect(() => {
    selectedIdRef.current = selectedId
  }, [selectedId])
  useEffect(() => {
    viewRef.current = view
  }, [view])

  // Detail data is loaded from several independent tables. Clear every
  // selection-scoped snapshot before paint so a fast switch can never show
  // the previous problem's tags, solution, diagram, or variant state.
  useLayoutEffect(() => {
    setModelRuns([])
    setSolution(null)
    setStudentAttempt(null)
    setReasoning(null)
    setSelectedRegions([])
    setReviewHistory([])
    setGeometryScene(null)
    setGeneratedDiagram(null)
    setDiagramView('generated')
    setStoredVariants([])
    setActiveVariantKey('')
    setSingleVariantPreview(null)
    setVariantDialogError(null)
    setDuplicateDecisionIds(new Set())
    setGeometryDialogOpen(false)
    setVariantDialogOpen(false)
  }, [selectedId])

  const refresh = useCallback(async (
    nextView: LibraryView,
    quietly = false,
  ) => {
    if (!quietly) {
      setLoading(true)
      dismiss()
    }
    try {
      const next = await listSavedProblems(nextView === 'archived', nextView === 'trash')
      setProblems(next)
      dirtyRef.current = false
      setSelectedId((current) =>
        current && next.some((problem) => problem.id === current)
          ? current
          : (next[0]?.id ?? null),
      )
    } catch (error) {
      if (!quietly) {
        setProblems([])
        setSelectedId(null)
        notify(`读取错题库失败：${String(error)}`, 'error')
      } else {
        dirtyRef.current = true
        console.warn(
          '错题库静默刷新失败，将在下次交互时强制刷新：',
          error,
        )
      }
    } finally {
      if (!quietly) setLoading(false)
    }
  }, [dismiss, notify])

  useEffect(() => {
    void refresh(view)
  }, [refresh, view])

  const scheduleEventRefresh = useCallback(() => {
    if (refreshTimerRef.current !== null) return
    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = null
      void refresh(viewRef.current, !dirtyRef.current)
    }, 400)
  }, [refresh])

  useEffect(() => {
    const handleSolutionStatus = (event: Event) => {
      const problemId = (event as CustomEvent<{ problemId?: string }>).detail
        ?.problemId
      if (!problemId) return
      if (problemId === selectedIdRef.current) {
        void getProblemSolution(problemId)
          .then((nextSolution) => {
            // The user may have switched problems while the request was in
            // flight; only apply the result if it is still the selection.
            if (selectedIdRef.current === problemId) setSolution(nextSolution)
          })
          .catch((error) => {
            dirtyRef.current = true
            console.warn(
              `同步题目 ${problemId} 的解答失败，列表将强制刷新：`,
              error,
            )
          })
      }
      scheduleEventRefresh()
    }
    window.addEventListener(SOLUTION_STATUS_EVENT, handleSolutionStatus)
    return () =>
      window.removeEventListener(SOLUTION_STATUS_EVENT, handleSolutionStatus)
  }, [refresh, scheduleEventRefresh])

  useEffect(() => {
    const handleIntelligenceStatus = (event: Event) => {
      const problemId = (event as CustomEvent<{ problemId?: string }>).detail
        ?.problemId
      if (!problemId) return
      if (problemId === selectedIdRef.current) {
        void Promise.all([
          getStudentAttempt(problemId),
          getReasoningAnalysis(problemId),
        ])
          .then(([attempt, analysis]) => {
            if (selectedIdRef.current === problemId) {
              setStudentAttempt(attempt)
              setReasoning(analysis)
            }
          })
          .catch((error) => {
            dirtyRef.current = true
            console.warn(
              `同步题目 ${problemId} 的作答/解析失败，列表将强制刷新：`,
              error,
            )
          })
      }
      scheduleEventRefresh()
    }
    window.addEventListener(INTELLIGENCE_STATUS_EVENT, handleIntelligenceStatus)
    return () => window.removeEventListener(INTELLIGENCE_STATUS_EVENT, handleIntelligenceStatus)
  }, [refresh, scheduleEventRefresh])

  useEffect(() => {
    const handleAIStatus = () => scheduleEventRefresh()
    window.addEventListener(AI_STATUS_EVENT, handleAIStatus)
    return () => window.removeEventListener(AI_STATUS_EVENT, handleAIStatus)
  }, [scheduleEventRefresh])

  const subjects = useMemo(() => [...new Set(problems.map((problem) => problem.subject)
    .filter((value): value is string => Boolean(value)))]
    .sort((left, right) => left.localeCompare(right, 'zh-CN')), [problems])
  const metadataOptions = useMemo(() => {
    const values = (items: Array<string | null | undefined>) => [...new Set(items.filter((value): value is string => Boolean(value)))]
      .sort((left, right) => left.localeCompare(right, 'zh-CN'))
    const tags = (type: 'knowledge' | 'method' | 'model') => values(problems.flatMap((problem) =>
      problem.libraryMetadata.tags.filter((tag) => tag.type === type).map((tag) => tag.name)))
    return {
      textbooks: values(problems.map((problem) => problem.libraryMetadata.textbookTitle)),
      chapters: values(problems.flatMap((problem) => problem.libraryMetadata.chapters)),
      knowledge: tags('knowledge'), methods: tags('method'), models: tags('model'),
    }
  }, [problems])
  const filteredProblems = useMemo(() => {
    return problems.filter((problem) => (subjectFilter === 'all' || problem.subject === subjectFilter)
      && (difficultyFilter === 'all' || problem.libraryMetadata.difficulty === difficultyFilter)
      && (textbookFilter === 'all' || problem.libraryMetadata.textbookTitle === textbookFilter)
      && (chapterFilter === 'all' || problem.libraryMetadata.chapters.includes(chapterFilter))
      && (knowledgeFilter === 'all' || problem.libraryMetadata.tags.some((tag) => tag.type === 'knowledge' && tag.name === knowledgeFilter))
      && (methodFilter === 'all' || problem.libraryMetadata.tags.some((tag) => tag.type === 'method' && tag.name === methodFilter))
      && (modelFilter === 'all' || problem.libraryMetadata.tags.some((tag) => tag.type === 'model' && tag.name === modelFilter))
      && (reviewFilter === 'all'
        || reviewFilter === 'favorite' && problem.libraryMetadata.favorite
        || reviewFilter === 'unconfirmed' && !problem.libraryMetadata.confirmed
        || reviewFilter === 'due' && problem.libraryMetadata.nextReviewAt !== null && problem.libraryMetadata.nextReviewAt <= Date.now()
        || reviewFilter === 'stable' && (problem.libraryMetadata.masteryEstimate ?? 0) >= .75
        || reviewFilter === 'attention' && problem.libraryMetadata.masteryEstimate !== null && problem.libraryMetadata.masteryEstimate < .5)
      && (!query.trim() || searchMatchIds?.has(problem.id)))
  }, [chapterFilter, difficultyFilter, knowledgeFilter, methodFilter, modelFilter, problems, query, reviewFilter, searchMatchIds, subjectFilter, textbookFilter])

  useEffect(() => {
    const normalized = query.normalize('NFKC').trim()
    if (!normalized) {
      setSearchMatchIds(null)
      return
    }
    let cancelled = false
    // Keep the previous match set while the debounced search runs; clearing
    // immediately made the list flash an empty state on every keystroke.
    const timeout = window.setTimeout(() => {
      void searchSavedProblemIds(normalized, view === 'archived', view === 'trash')
        .then((ids) => {
          if (!cancelled) setSearchMatchIds(new Set(ids))
        })
        .catch((error) => {
          if (!cancelled) {
            console.warn('错题全文搜索失败', error)
            setSearchMatchIds(new Set())
          }
        })
    }, 120)
    return () => {
      cancelled = true
      window.clearTimeout(timeout)
    }
  }, [query, view])
  useEffect(() => {
    if (!filteredProblems.some((problem) => problem.id === selectedId)) setSelectedId(filteredProblems[0]?.id ?? null)
  }, [filteredProblems, selectedId])
  const selected = useMemo(
    () => problems.find((problem) => problem.id === selectedId) ?? null,
    [problems, selectedId],
  )
  const selectedDiagramRegion = preferredRegions(selectedRegions, 'diagram')[0] ?? null
  const selectedDiagramRect = selectedDiagramRegion?.rect ?? (
    selected?.aiHasDiagram && isUsableDiagramRect(selected.aiDiagramBBox)
      ? selected.aiDiagramBBox
      : null
  )
  const selectedDiagramPath = selectedDiagramRegion?.imagePath ?? selected?.aiDiagramImagePath ?? null
  const selectedHasDisplayDiagram =
    Boolean(selectedDiagramRect) &&
    Boolean(selected?.cropImagePath || selectedDiagramPath)
  const selectedIsProcessing =
    selected?.aiStatus === 'pending' || selected?.aiStatus === 'processing'
  const activeModelRun =
    modelRuns.find((run) => run.id === selected?.aiActiveModelRunId) ??
    modelRuns[0] ??
    null
  const duplicateSuggestions = useMemo(
    () => selected
      ? findProblemDuplicateSuggestions(selected, problems, duplicateDecisionIds)
      : [],
    [duplicateDecisionIds, problems, selected],
  )
  const savedVariantCount = storedVariants.filter((item) => Boolean(item.candidate)).length
  const preferredStoredVariant = storedVariants.find((item) => Boolean(item.candidate)) ?? storedVariants[0] ?? null
  const activeStoredVariant = storedVariants.find((item) => (item.id ?? item.planId) === activeVariantKey) ?? preferredStoredVariant
  const refreshStoredVariants = useCallback(async (problemId: string) => {
    const candidates = await listProblemVariantCandidates(problemId)
    if (selectedIdRef.current !== problemId) return
    setStoredVariants(candidates)
    setActiveVariantKey((current) => {
      if (candidates.some((item) => (item.id ?? item.planId) === current)) return current
      const preferred = candidates.find((item) => Boolean(item.candidate)) ?? candidates[0]
      return preferred?.id ?? preferred?.planId ?? ''
    })
  }, [])

  useEffect(() => {
    if (!selectedId) {
      setStoredVariants([])
      setActiveVariantKey('')
      return
    }
    void refreshStoredVariants(selectedId).catch(() => {
      if (selectedIdRef.current === selectedId) setStoredVariants([])
    })
  }, [refreshStoredVariants, selectedId])

  useEffect(() => {
    // Guard against out-of-order responses when switching problems quickly:
    // a slow response for the previous problem must not overwrite the
    // regions of the newly selected one.
    let cancelled = false
    if (!selectedId) { setSelectedRegions([]); return }
    void getProblemRegions(selectedId)
      .then((regions) => { if (!cancelled) setSelectedRegions(regions) })
      .catch(() => { if (!cancelled) setSelectedRegions([]) })
    return () => { cancelled = true }
  }, [selectedId, problems])

  useEffect(() => {
    let cancelled = false
    if (!selectedId) {
      setGeometryScene(null)
      setGeneratedDiagram(null)
      return
    }
    void Promise.all([getLatestGeometryScene(selectedId), getPreferredDiagram('problem', selectedId)])
      .then(([scene, diagram]) => {
        if (!cancelled) { setGeometryScene(scene); setGeneratedDiagram(diagram) }
      })
      .catch(() => {
        if (!cancelled) { setGeometryScene(null); setGeneratedDiagram(null) }
      })
    return () => { cancelled = true }
  }, [selectedId])

  useEffect(() => {
    const refresh = (event: Event) => {
      const problemId = (event as CustomEvent<{ problemId?: string }>).detail?.problemId
      if (!problemId || problemId !== selectedIdRef.current) return
      void Promise.all([getLatestGeometryScene(problemId), getPreferredDiagram('problem', problemId), listProblemModelRuns(problemId)])
        .then(([scene, diagram, runs]) => { setGeometryScene(scene); setGeneratedDiagram(diagram); setModelRuns(runs) })
        .catch(() => undefined)
    }
    window.addEventListener(GEOMETRY_SCENE_STATUS_EVENT, refresh)
    return () => window.removeEventListener(GEOMETRY_SCENE_STATUS_EVENT, refresh)
  }, [])

  useEffect(() => {
    let cancelled = false
    if (!selectedId) { setReviewHistory([]); return }
    void getProblemReviewHistory(selectedId)
      .then((history) => { if (!cancelled) setReviewHistory(history) })
      .catch(() => { if (!cancelled) setReviewHistory([]) })
    return () => { cancelled = true }
  }, [selectedId])

  useEffect(() => {
    let cancelled = false
    if (!selectedId) {
      setDuplicateDecisionIds(new Set())
      return
    }
    void listProblemDuplicateDecisions(selectedId)
      .then((decisions) => {
        if (!cancelled) {
          setDuplicateDecisionIds(new Set(decisions.map((decision) => decision.candidateProblemId)))
        }
      })
      .catch(() => { if (!cancelled) setDuplicateDecisionIds(new Set()) })
    return () => { cancelled = true }
  }, [selectedId])

  useEffect(() => {
    setBatchProblemIds(new Set())
    setBatchTextbookId('')
    if (subjectFilter === 'all') {
      setBatchMode(false)
      setBatchTextbooks([])
      return
    }
    void listTextbooks(subjectFilter)
      .then((books) => setBatchTextbooks(books.filter((book) => !book.archivedAt)))
      .catch(() => setBatchTextbooks([]))
  }, [subjectFilter])

  useEffect(() => {
    let cancelled = false
    setDeleteConfirming(false)
    if (!selectedId) {
      setModelRuns([])
      return
    }
    void listProblemModelRuns(selectedId)
      .then((runs) => {
        if (!cancelled) setModelRuns(runs)
      })
      .catch(() => {
        if (!cancelled) setModelRuns([])
      })
    return () => {
      cancelled = true
    }
  }, [selectedId, selected?.aiStatus])

  useEffect(() => {
    let cancelled = false
    if (!selectedId) {
      setSolution(null)
      setStudentAttempt(null)
      setReasoning(null)
      return
    }
    void getProblemSolution(selectedId)
      .then((nextSolution) => {
        if (!cancelled) setSolution(nextSolution)
      })
      .catch((error) => {
        if (!cancelled) {
          setSolution({
            id: '',
            problemId: selectedId,
            contentMarkdown: '',
            steps: [],
            keyMethod: null,
            usedFormulas: [],
            knowledgePoints: [],
            status: 'failed',
            activeModelRunId: null,
            errorMessage: `读取 Solution 失败：${String(error)}`,
            createdAt: 0,
            updatedAt: Date.now(),
          })
        }
      })
    void Promise.all([
      getStudentAttempt(selectedId),
      getReasoningAnalysis(selectedId),
    ]).then(([attempt, analysis]) => {
      if (!cancelled) {
        setStudentAttempt(attempt)
        setReasoning(analysis)
      }
    }).catch((error) => {
      if (!cancelled) {
        console.warn(`读取题目 ${selectedId} 的作答/解析失败：`, error)
      }
    })
    return () => {
      cancelled = true
    }
  }, [selectedId])

  const beginEditing = () => {
    if (!selected) return
    setEditTitle(selected.title)
    setEditSubject(selected.subject ?? '')
    setEditStemMarkdown(selected.stemMarkdown ?? '')
    setEditKnowledgePoints(selected.knowledgePoints.join('，'))
    setEditing(true)
    dismiss()
  }

  const cancelEditing = () => {
    setEditing(false)
    setSubjectChangeConfirming(false)
    dismiss()
  }

  const saveEdits = async (confirmTextbookReset = false) => {
    if (!selected) return
    if (!editTitle.trim()) {
      notify('保存失败：标题不能为空', 'error')
      return
    }
    setUpdating(true)
    dismiss()
    try {
      const updated = await updateProblemUserFields(selected.id, {
        title: editTitle,
        subject: editSubject,
        stemMarkdown: editStemMarkdown,
        knowledgePoints: editKnowledgePoints
          .split(/[,，、\n]/)
          .map((point) => point.trim())
          .filter(Boolean),
      }, { confirmTextbookReset })
      setProblems((current) =>
        current.map((problem) =>
          problem.id === updated.id ? updated : problem,
        ),
      )
      setEditing(false)
      setSubjectChangeConfirming(false)
      notify('修改已保存', 'success')
      void runSolutionWorker()
      setSolution(await getProblemSolution(selected.id))
    } catch (error) {
      if (error instanceof ProblemSubjectChangeConflict) {
        setSubjectChangeConfirming(true)
      } else if (error instanceof ProblemSubjectChangeTagConflict) {
        notify(error.message, 'error')
      } else {
        notify(`保存修改失败：${String(error)}`, 'error')
      }
    } finally {
      setUpdating(false)
    }
  }

  const retrySolution = async () => {
    if (!selected) return
    try {
      setSolution(await queueProblemSolution(selected.id))
      void runSolutionWorker()
    } catch (error) {
      notify(`无法重新生成：${String(error)}`, 'error')
    }
  }

  const rebuildGeometryScene = async () => {
    const imagePath = selectedDiagramPath || selected?.cropImagePath
    if (!selected || !imagePath) return
    setGeometrySceneBusy(true)
    try {
      const scene = await reconstructGeometryScene(selected.id)
      setGeometryScene(scene)
      setGeneratedDiagram(await getPreferredDiagram('problem', selected.id))
      setDiagramView('generated')
      notify(
        scene.validationStatus === 'validated'
          ? '几何图已重建；可随时回看原图'
          : '几何图置信度不足，已安全保留原图',
        scene.validationStatus === 'validated' ? 'success' : 'info',
      )
    } catch (error) {
      console.warn('几何图重建失败', error)
      notify('这次没有得到可靠的几何图，原图仍可正常使用。', 'info')
    } finally {
      setGeometrySceneBusy(false)
    }
  }
  const geometryRunBusy = modelRuns.some((run) => run.taskType === 'geometry_scene' && ['pending', 'processing'].includes(run.status))
  const geometryState = geometrySceneBusy || geometryRunBusy
    ? 'generating'
    : generatedDiagram?.freshnessStatus === 'fresh'
      ? 'ready'
      : geometryScene?.validationStatus === 'rejected'
        ? 'failed'
        : generatedDiagram || geometryScene?.inputHash
          ? 'stale'
          : 'available'
  const geometryStatus = {
    generating: { icon: 'ai' as const, title: '正在绘制', detail: '可以关闭窗口，完成后会自动保存。' },
    ready: { icon: 'check' as const, title: '图形已就绪', detail: '点击图形可对照原图或重新生成。' },
    failed: { icon: 'alert' as const, title: '已保留原图', detail: '这次没有得到可靠图形，可以再次尝试。' },
    stale: { icon: 'refresh' as const, title: '图形可以更新', detail: '题目内容有变化，建议重新生成。' },
    available: { icon: 'ai' as const, title: '可以绘制图形', detail: '根据题图与正解重绘清晰的矢量图。' },
  }[geometryState]

  const generateSingleVariant = async () => {
    if (!selected) return
    setVariantBusy(true)
    setVariantDialogError(null)
    try {
      setSingleVariantPreview(await prepareSingleProblemVariant(selected.id, variantDraftDifficulty, variantLevel))
      await refreshStoredVariants(selected.id)
    } catch (error) {
      setVariantDialogError(variantProductError(error))
    } finally {
      setVariantBusy(false)
    }
  }

  const openVariantDialog = () => {
    if (!selected) return
    setVariantDialogOpen(true)
    setSingleVariantPreview(null)
    setVariantDialogError(null)
  }

  const toggleArchive = async () => {
    if (!selected) return
    setUpdating(true)
    dismiss()
    try {
      await setProblemArchived(selected.id, !selected.archivedAt)
      const action = selected.archivedAt ? '已移回错题库' : '已归档'
      await refresh(view)
      notify(action, 'success')
    } catch (error) {
      notify(`更新失败：${String(error)}`, 'error')
    } finally {
      setUpdating(false)
    }
  }

  const toggleFavorite = async () => {
    if (!selected) return
    setUpdating(true)
    try {
      const updated = await setProblemFavorite(
        selected.id,
        !selected.libraryMetadata.favorite,
      )
      setProblems((current) => current.map((problem) =>
        problem.id === updated.id ? updated : problem))
      notify(updated.libraryMetadata.favorite ? '已收藏' : '已取消收藏', 'success')
    } catch (error) {
      notify(`收藏状态保存失败：${String(error)}`, 'error')
    } finally {
      setUpdating(false)
    }
  }

  // Keyboard operation: ↑/↓ move through the filtered list, Cmd/Ctrl+S saves
  // the edit form.  High-volume review workflows should not require the mouse.
  const keyboardNavRef = useRef(false)
  const keyboardSaveRef = useRef<() => void>(() => undefined)
  keyboardSaveRef.current = () => {
    if (editing) void saveEdits()
  }
  useEffect(() => {
    if (keyboardNavRef.current || !selectedId) return
    keyboardNavRef.current = false
    document
      .querySelector(`[data-problem-id="${CSS.escape(selectedId)}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [selectedId])
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        keyboardSaveRef.current()
        return
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
      const target = event.target
      const typing = target instanceof HTMLElement
        && (target.tagName === 'INPUT'
          || target.tagName === 'TEXTAREA'
          || target.tagName === 'SELECT'
          || target.isContentEditable)
      if (typing) return
      if (!filteredProblems.length) return
      event.preventDefault()
      const currentIndex = filteredProblems.findIndex((problem) => problem.id === selectedIdRef.current)
      const nextIndex = event.key === 'ArrowDown'
        ? Math.min(filteredProblems.length - 1, currentIndex + 1)
        : Math.max(0, currentIndex - 1)
      const nextId = filteredProblems[nextIndex]?.id ?? null
      if (nextId && nextId !== selectedIdRef.current) {
        keyboardNavRef.current = true
        setSelectedId(nextId)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [filteredProblems])

  const decideDuplicate = async (
    suggestion: (typeof duplicateSuggestions)[number],
    decision: 'keep_both' | 'merged',
  ) => {
    if (!selected) return
    setUpdating(true)
    try {
      await decideProblemDuplicate({
        problemId: selected.id,
        candidateProblemId: suggestion.candidate.id,
        decision,
        similarityScore: suggestion.score,
        signals: suggestion.signals,
      })
      setDuplicateDecisionIds((current) => new Set(current).add(suggestion.candidate.id))
      if (decision === 'merged') await refresh(view, true)
      notify(
        decision === 'merged' ? '重复项已归档，历史记录仍保留' : '已保留为两道独立错题',
        'success',
      )
    } catch (error) {
      notify(`重复题处理失败：${String(error)}`, 'error')
    } finally {
      setUpdating(false)
    }
  }

  const handleDelete = async () => {
    if (!selected) return
    setDeleting(true)
    dismiss()
    try {
      await deleteProblem(selected.id)
      setDeleteConfirming(false)
      await refresh(view)
      notify('已移入回收站，可随时恢复', 'success')
    } catch (error) {
      notify(`删除失败：${String(error)}`, 'error')
    } finally {
      setDeleting(false)
    }
  }

  const handleRestore = async () => {
    if (!selected) return
    setUpdating(true); dismiss()
    try {
      await restoreProblem(selected.id)
      await refresh(view)
      notify('错题已恢复', 'success')
    } catch (error) { notify(`恢复失败：${String(error)}`, 'error') }
    finally { setUpdating(false) }
  }

  const retryAI = async () => {
    if (!selected) return
    setUpdating(true)
    dismiss()
    try {
      const updated = await queueProblemAI(selected.id)
      setProblems((current) =>
        current.map((problem) =>
          problem.id === updated.id ? updated : problem,
        ),
      )
      setModelRuns(await listProblemModelRuns(selected.id))
      void runProblemAIWorker()
    } catch (error) {
      notify(`AI 重试失败：${String(error)}`, 'error')
    } finally {
      setUpdating(false)
    }
  }

  const cancelAI = async () => {
    if (!selected) return
    setUpdating(true)
    try {
      await cancelProblemAI(selected.id)
      await refresh(view, true)
      setModelRuns(await listProblemModelRuns(selected.id))
    } catch (error) {
      notify(`取消 AI 分析失败：${String(error)}`, 'error')
    } finally {
      setUpdating(false)
    }
  }

  const handleRecropSaved = async (
    updated: SavedProblem,
    changes: ProblemRegionType[],
  ) => {
    setProblems((current) =>
      current.map((problem) =>
        problem.id === updated.id ? updated : problem,
      ),
    )
    setRecropping(false)
    notify('新裁图已保存', 'success')
    try {
      setSolution(await getProblemSolution(updated.id))
      setStudentAttempt(await getStudentAttempt(updated.id))
      setReasoning(await getReasoningAnalysis(updated.id))
    } catch (error) {
      // The crop itself is already saved; only the detail-panel refresh
      // failed, so report it without discarding the success.
      notify(`刷新解答详情失败：${String(error)}`, 'error')
    }

    try {
      const needsProblemAnalysis =
        changes.includes('question') || changes.includes('diagram')
      if (!needsProblemAnalysis && changes.includes('answer')) {
        const queuedAttempt = await queueStudentAttempt(updated.id)
        setStudentAttempt(queuedAttempt)
        setReasoning(await getReasoningAnalysis(updated.id))
        if (queuedAttempt.status === 'pending') {
          void runIntelligenceWorker()
          notify('作答区域已保存，正在识别我的解答', 'success')
        } else {
          notify('作答区域已移除', 'info')
        }
        return
      }
      if (!needsProblemAnalysis) return
      const queued = await queueProblemAI(updated.id)
      setProblems((current) =>
        current.map((problem) =>
          problem.id === queued.id ? queued : problem,
        ),
      )
      setModelRuns(await listProblemModelRuns(updated.id))
      void runProblemAIWorker()
    } catch (error) {
      notify(`新裁图已保存，但 AI 重新排队失败：${String(error)}`, 'error')
    }
  }

  const toggleBatchProblem = (problemId: string) => {
    setBatchProblemIds((current) => {
      const next = new Set(current)
      if (next.has(problemId)) next.delete(problemId)
      else next.add(problemId)
      return next
    })
  }

  const startSelectedRelabel = async () => {
    if (subjectFilter === 'all' || !batchProblemIds.size) return
    setBatchRunning(true)
    try {
      const batchId = await createRelabelBatch(subjectFilter, [...batchProblemIds])
      void startRelabelBatchWorker(batchId)
      notify(`已为 ${batchProblemIds.size} 道${subjectFilter}错题启动重新标注`, 'success')
      setBatchProblemIds(new Set())
    } catch (error) {
      notify(`批量重新标注失败：${String(error)}`, 'error')
    } finally {
      setBatchRunning(false)
    }
  }

  const migrateSelectedTextbook = async () => {
    if (subjectFilter === 'all' || !batchProblemIds.size) return
    setBatchRunning(true)
    try {
      await setProblemTextbookMatches(
        [...batchProblemIds],
        subjectFilter,
        batchTextbookId || null,
      )
      await refresh(view, true)
      notify(
        batchTextbookId
          ? `已迁移 ${batchProblemIds.size} 道错题的教材体系`
          : `已清除 ${batchProblemIds.size} 道错题的教材匹配`,
        'success',
      )
      setBatchProblemIds(new Set())
    } catch (error) {
      notify(`批量迁移教材失败：${String(error)}`, 'error')
    } finally {
      setBatchRunning(false)
    }
  }

  if (recropping && selected) {
    return (
      <ProblemCropEditor
        onBack={() => setRecropping(false)}
        onSaved={(updated, changes) =>
          void handleRecropSaved(updated, changes)
        }
        problem={selected}
      />
    )
  }

  return (
    <main className="workspace library-workspace">
      <PageHeader
        actions={<SegmentedControl
          ariaLabel="错题库视图"
          onChange={(nextView) => {
            setView(nextView)
            setBatchMode(false)
            setBatchProblemIds(new Set())
          }}
          options={[
            { value: 'active', label: '错题', disabled: editing },
            { value: 'archived', label: '已归档', disabled: editing },
            { value: 'trash', label: '回收站', disabled: editing },
          ]}
          value={view}
        />}
        eyebrow="学习记录"
        title="错题库"
      />

      <section className="library-layout">
        <div className="problem-list-panel">
          <div className="problem-list-heading">
            <strong>{view === 'active' ? '全部错题' : view === 'archived' ? '归档错题' : '已删除错题'}</strong>
            <span>{filteredProblems.length} / {problems.length} 道</span>
            {view === 'active' && (
              <Button
                disabled={subjectFilter === 'all'}
                onClick={() => {
                  setBatchMode((current) => !current)
                  setBatchProblemIds(new Set())
                }}
                title={subjectFilter === 'all' ? '请先选择一个科目' : undefined}
                variant="ghost"
              >
                {batchMode ? '退出批量' : '批量操作'}
              </Button>
            )}
          </div>

          <div className="problem-list-filters">
            <SearchField label="搜索错题" onChange={(event) => setQuery(event.target.value)} placeholder="搜索题干、答案或标签" value={query} />
            <ListboxSelect
              ariaLabel="筛选科目"
              onValueChange={setSubjectFilter}
              options={[{ value: 'all', label: '全部科目' }, ...subjects.map((subject) => ({ value: subject, label: subject }))]}
              value={subjectFilter}
            />
            <details>
              <summary>更多筛选</summary>
              <div className="problem-list-filter-grid">
                <ListboxSelect ariaLabel="难度" onValueChange={setDifficultyFilter} options={[{ value: 'all', label: '全部难度' }, { value: 'basic', label: '基础' }, { value: 'intermediate', label: '中档' }, { value: 'advanced', label: '进阶' }]} value={difficultyFilter} />
                <ListboxSelect ariaLabel="教材" onValueChange={setTextbookFilter} options={[{ value: 'all', label: '全部教材' }, ...metadataOptions.textbooks.map((value) => ({ value, label: value }))]} value={textbookFilter} />
                <ListboxSelect ariaLabel="章节" onValueChange={setChapterFilter} options={[{ value: 'all', label: '全部章节' }, ...metadataOptions.chapters.map((value) => ({ value, label: value }))]} value={chapterFilter} />
                <ListboxSelect ariaLabel="知识点" onValueChange={setKnowledgeFilter} options={[{ value: 'all', label: '全部知识点' }, ...metadataOptions.knowledge.map((value) => ({ value, label: value }))]} value={knowledgeFilter} />
                <ListboxSelect ariaLabel="方法" onValueChange={setMethodFilter} options={[{ value: 'all', label: '全部方法' }, ...metadataOptions.methods.map((value) => ({ value, label: value }))]} value={methodFilter} />
                <ListboxSelect ariaLabel="题型模型" onValueChange={setModelFilter} options={[{ value: 'all', label: '全部模型' }, ...metadataOptions.models.map((value) => ({ value, label: value }))]} value={modelFilter} />
                <ListboxSelect ariaLabel="复习状态" onValueChange={setReviewFilter} options={[{ value: 'all', label: '全部复习状态' }, { value: 'favorite', label: '我的收藏' }, { value: 'due', label: '已到复习时间' }, { value: 'stable', label: '掌握较稳定' }, { value: 'attention', label: '需要关注' }, { value: 'unconfirmed', label: '尚未确认' }]} value={reviewFilter} />
              </div>
            </details>
          </div>

          {batchMode && subjectFilter !== 'all' && (
            <div className="problem-batch-toolbar" role="region" aria-label="错题批量操作">
              <strong>已选 {batchProblemIds.size} 道 · {subjectFilter}</strong>
              <Button
                disabled={batchRunning || !filteredProblems.length}
                onClick={() => setBatchProblemIds(new Set(filteredProblems.map((problem) => problem.id)))}
              >
                选择当前结果
              </Button>
              <Button
                disabled={batchRunning || !batchProblemIds.size}
                onClick={() => void startSelectedRelabel()}
              >
                批量重新标注
              </Button>
              <ListboxSelect
                ariaLabel="批量迁移到教材"
                disabled={batchRunning}
                onValueChange={setBatchTextbookId}
                options={[{ value: '', label: '清除教材匹配' }, ...batchTextbooks.map((book) => ({ value: book.id, label: book.title }))]}
                value={batchTextbookId}
              />
              <Button
                disabled={batchRunning || !batchProblemIds.size}
                onClick={() => void migrateSelectedTextbook()}
              >
                应用教材迁移
              </Button>
            </div>
          )}

          <div className="problem-card-list">
            {loading ? (
              <div className="library-empty">正在读取本地错题…</div>
            ) : filteredProblems.length ? (
              filteredProblems.map((problem) => (
                <button
                  aria-pressed={batchMode ? batchProblemIds.has(problem.id) : undefined}
                  className={`problem-card ${
                    selectedId === problem.id ? 'active' : ''
                  } ${batchProblemIds.has(problem.id) ? 'batch-selected' : ''}`}
                  data-problem-id={problem.id}
                  key={problem.id}
                  disabled={editing}
                  onClick={() => {
                    if (batchMode) {
                      toggleBatchProblem(problem.id)
                      return
                    }
                    setSelectedId(problem.id)
                  }}
                  type="button"
                >
                  <ProblemImage
                    alt=""
                    className="problem-card-image"
                    path={problem.cropImagePath}
                  />
                  {problem.libraryMetadata.favorite && (
                    <span aria-label="已收藏" className="problem-card-favorite">
                      <Icon filled name="favorite" size={14} />
                    </span>
                  )}
                  <span className="problem-card-copy">
                    <strong>{problem.title}</strong>
                    <small>{dateFormatter.format(problem.createdAt)}</small>
                    <span className="problem-card-statuses">
                      <span className="problem-status">
                        {problem.deletedAt ? '回收站' : problem.archivedAt ? '已归档' : '已保存'}
                      </span>
                      <span
                        className={`problem-ai-status ${problem.aiStatus}`}
                      >
                        <AIStatusContent status={problem.aiStatus} />
                      </span>
                    </span>
                  </span>
                </button>
              ))
            ) : (
              <div className="library-empty">
                <strong>
                  {problems.length ? '没有符合筛选条件的错题' : view === 'active' ? '还没有保存错题' : view === 'archived' ? '没有归档错题' : '回收站为空'}
                </strong>
                <p>
                  {problems.length ? '尝试清除搜索词或切换科目。' : view === 'active'
                    ? '在采集页面确认题块后，点击“保存为错题”。'
                    : view === 'archived' ? '归档后的错题会显示在这里。' : '删除的错题会保留复习记录与媒体，可在这里恢复。'}
                </p>
              </div>
            )}
          </div>
        </div>

        <article className="problem-detail-panel">
          {selected ? (
            <>
              <div className="problem-detail-heading">
                <div>
                  <p className="eyebrow">错题详情</p>
                  <h2>{editing ? '编辑错题信息' : selected.title}</h2>
                </div>
                <div className="problem-detail-actions">
                  {selected.deletedAt ? (
                    <Button className="primary-button" disabled={updating} loading={updating} onClick={() => void handleRestore()} variant="primary">
                      {updating ? '恢复中…' : '恢复到错题库'}
                    </Button>
                  ) : editing ? (
                    <>
                      <Button
                        className="secondary-action"
                        disabled={updating}
                        onClick={cancelEditing}
                      >
                        取消
                      </Button>
                      <Button
                        className="primary-button"
                        disabled={updating || !editTitle.trim()}
                        loading={updating}
                        onClick={() => void saveEdits()}
                        variant="primary"
                      >
                        {updating ? '保存中…' : '保存修改'}
                      </Button>
                    </>
                  ) : (
                    <>
                      <IconButton
                        aria-pressed={selected.libraryMetadata.favorite}
                        className={selected.libraryMetadata.favorite ? 'is-favorite' : ''}
                        disabled={updating}
                        label={selected.libraryMetadata.favorite ? '取消收藏' : '收藏错题'}
                        onClick={() => void toggleFavorite()}
                      >
                        <Icon filled={selected.libraryMetadata.favorite} name="favorite" size={18} />
                      </IconButton>
                      <Button
                        className="secondary-action"
                        disabled={updating}
                        onClick={beginEditing}
                      >
                        编辑
                      </Button>
                      <Button
                        className="secondary-action"
                        disabled={updating || !selected.correctedImagePath}
                        onClick={() => {
                          dismiss()
                          setRecropping(true)
                        }}
                      >
                        重新裁剪
                      </Button>
                      <Button
                        className="secondary-action"
                        disabled={updating}
                        onClick={() => void toggleArchive()}
                      >
                        {updating
                          ? '更新中…'
                          : selected.archivedAt
                            ? '取消归档'
                            : '归档'}
                      </Button>
                    </>
                  )}
                </div>
              </div>

              {editing ? (
                <div className="problem-detail-content">
                  <ProblemImage
                    alt={selected.title}
                    className="problem-detail-image"
                    path={selected.cropImagePath}
                  />
                  <div className="problem-edit-form">
                    <Input autoFocus disabled={updating} label="标题" onChange={(event) => setEditTitle(event.target.value)} required value={editTitle} />
                    <Input disabled={updating} label="科目" onChange={(event) => setEditSubject(event.target.value)} placeholder="例如：数学" value={editSubject} />
                    <Textarea
                      disabled={updating}
                      label="题干 / 备注"
                      onChange={(event) => setEditStemMarkdown(event.target.value)}
                      placeholder="补充题干或解题背景"
                      rows={6}
                      value={editStemMarkdown}
                    />
                    <Textarea
                      disabled={updating}
                      label="知识点"
                      onChange={(event) => setEditKnowledgePoints(event.target.value)}
                      placeholder="多个知识点用逗号或换行分隔"
                      rows={3}
                      value={editKnowledgePoints}
                    />
                  </div>
                </div>
              ) : (
                <>
                  <div className="problem-detail-content">
                    <div className="problem-learning-page">
                      <section className="problem-reading-section">
                        <header className="problem-reading-header">
                          <div>
                            <p className="eyebrow">题目</p>
                            <h3>题目内容</h3>
                          </div>
                          <div className="problem-ai-notice">
                            <span
                              aria-hidden="true"
                              className={`problem-ai-dot ${selected.aiStatus}`}
                            />
                            <AIStatusContent status={selected.aiStatus} />
                            {['not_started', 'completed'].includes(
                              selected.aiStatus,
                            ) && (
                              <Button
                                className="problem-ai-notice__action"
                                disabled={updating}
                                onClick={() => void retryAI()}
                                variant="ghost"
                              >
                                {selected.aiStatus === 'completed'
                                  ? '重新整理'
                                  : '开始整理'}
                              </Button>
                            )}
                            {selectedIsProcessing && (
                              <Button className="problem-ai-notice__action" disabled={updating} onClick={() => void cancelAI()} variant="ghost">
                                取消分析
                              </Button>
                            )}
                          </div>
                        </header>

                          <div
                          aria-busy={selectedIsProcessing}
                          className={`problem-reading-layout ${
                            selectedHasDisplayDiagram ? 'with-diagram' : ''
                          } ${selectedIsProcessing ? 'ai-content-processing' : ''}`}
                        >
                          <div className="problem-formal-content">
                            <ExplainableProblemMarkdown
                              attempt={studentAttempt}
                              className={
                                selected.stemMarkdown
                                  ? 'problem-formal-stem'
                                  : 'problem-formal-stem empty'
                              }
                              problem={selected}
                              solution={solution}
                            >
                              {selected.stemMarkdown ||
                                '题干尚未整理，可点击“编辑”补充题目内容。'}
                            </ExplainableProblemMarkdown>

                            {selected.aiChoices.length > 0 && (
                              <ol className="problem-choice-list">
                                {selected.aiChoices.map((choice) => (
                                  <li key={`${choice.label}-${choice.text}`}>
                                    <strong>{choice.label}</strong>
                                    <ExplainableProblemMarkdown
                                      attempt={studentAttempt}
                                      className="problem-choice-content"
                                      problem={selected}
                                      solution={solution}
                                    >
                                      {choice.text}
                                    </ExplainableProblemMarkdown>
                                  </li>
                                ))}
                              </ol>
                            )}

                            {selected.aiSubQuestions.length > 0 && (
                              <ol className="problem-sub-question-list">
                                {selected.aiSubQuestions.map((question) => (
                                  <li key={`${question.index}-${question.content}`}>
                                    <span
                                      aria-label={`第 ${question.index} 小问`}
                                      className="sub-question-index"
                                    >
                                      {question.index}
                                    </span>
                                    <ExplainableProblemMarkdown
                                      attempt={studentAttempt}
                                      className="problem-sub-question-content"
                                      problem={selected}
                                      solution={solution}
                                    >
                                      {question.content}
                                    </ExplainableProblemMarkdown>
                                  </li>
                                ))}
                              </ol>
                            )}
                          </div>

                          {selectedDiagramRect && selectedHasDisplayDiagram && (
                            <div className="problem-geometry-scene">
                              {generatedDiagram && diagramView === 'generated'
                                ? <DiagramView
                                    alt={`${selected.title}的 TikZ 几何图`}
                                    diagram={generatedDiagram}
                                    onActivate={selected.aiDiagramKind === 'geometry' ? () => setGeometryDialogOpen(true) : undefined}
                                    showCaption={false}
                                  />
                                : selected.aiDiagramKind === 'geometry'
                                  ? <div
                                      aria-label="打开题目图形工具"
                                      className="problem-geometry-scene__media"
                                      onClick={() => setGeometryDialogOpen(true)}
                                      onKeyDown={(event) => {
                                        if (event.key !== 'Enter' && event.key !== ' ') return
                                        event.preventDefault()
                                        setGeometryDialogOpen(true)
                                      }}
                                      role="button"
                                      tabIndex={0}
                                    >
                                      <ProblemDiagramImage
                                        alt={`${selected.title}中的题目原图`}
                                        croppedPath={selectedDiagramPath}
                                        path={selected.cropImagePath}
                                        rect={selectedDiagramRect}
                                      />
                                    </div>
                                  : <ProblemDiagramImage
                                      alt={`${selected.title}中的题目原图`}
                                      croppedPath={selectedDiagramPath}
                                      path={selected.cropImagePath}
                                      rect={selectedDiagramRect}
                                    />}
                              {selected.aiDiagramKind === 'geometry' && (
                                <div className="problem-geometry-scene__actions">
                                  {generatedDiagram && <SegmentedControl
                                    ariaLabel="图形版本"
                                    onChange={(value) => setDiagramView(value as 'generated' | 'original')}
                                    options={[{ value: 'generated', label: 'TikZ' }, { value: 'original', label: '原图' }]}
                                    value={diagramView}
                                  />}
                                  {geometryState !== 'ready' && <IconButton
                                    appearance="plain"
                                    className={`problem-geometry-scene__trigger is-${geometryState}`}
                                    disabled={geometryState === 'generating'}
                                    label={geometryStatus.title}
                                    onClick={() => setGeometryDialogOpen(true)}
                                  >
                                    {geometryState === 'generating'
                                      ? <span className="ax-spinner" />
                                      : <Icon name={geometryStatus.icon} size={17} />}
                                  </IconButton>}
                                </div>
                              )}
                            </div>
                          )}
                          {selectedIsProcessing && (
                            <div
                              aria-live="polite"
                              className="problem-ai-scan-overlay"
                              role="status"
                            >
                              <span className="ai-scan-icon">
                                <Icon name="ai" size={22} />
                              </span>
                              <span className="ai-scanning-text">
                                AI 正在识别并整理题目
                              </span>
                            </div>
                          )}
                        </div>

                        {selected.aiStatus === 'failed' && (
                          <ErrorState
                            error={activeModelRun?.error ?? classifyAIError(
                              activeModelRun?.errorMessage || 'AI 服务未返回错误详情',
                              { runId: activeModelRun?.id ?? null },
                            )}
                            secondaryAction={
                              /* 报错与取消都始终提供重试入口，位于错误卡片内部右侧 */
                              <Button
                                disabled={updating}
                                loading={updating}
                                onClick={() => void retryAI()}
                                variant="secondary"
                              >
                                重试解析
                              </Button>
                            }
                          />
                        )}
                      </section>

                      <section className="problem-content-information">
                        <div className="problem-content-facts">
                          <div>
                            <span>科目</span>
                            <strong>{selected.subject || '待补充'}</strong>
                          </div>
                          <div>
                            <span>题型</span>
                            <strong>
                              {problemTypeLabel(selected.aiProblemType)}
                            </strong>
                          </div>
                          <div>
                            <span>图形</span>
                            <strong>
                              {selected.aiHasDiagram
                                ? {
                                    geometry: '几何图',
                                    function: '函数图',
                                    chart: '统计图',
                                    table: '表格',
                                    other: '其他图形',
                                    unknown: '图形（未分类）',
                                  }[selected.aiDiagramKind || 'unknown']
                                : '未检测到'}
                            </strong>
                          </div>
                        </div>

                        {selected.knowledgePoints.length > 0 && (
                          <div className="problem-knowledge-summary">
                            <span>知识点</span>
                            <div className="ai-tag-list">
                              {selected.knowledgePoints.map((point) => (
                                <span key={point}>{point}</span>
                              ))}
                            </div>
                          </div>
                        )}
                      </section>

                      <ProblemTags
                        key={selected.id}
                        problemId={selected.id}
                        subjectId={selected.subjectId}
                        subject={selected.subject}
                      />

                      {duplicateSuggestions.length > 0 && (
                        <section className="problem-duplicate-section">
                          <div>
                            <p className="eyebrow">可能重复</p>
                            <h3>请确认是否为同一道题</h3>
                            <p>只比较同一科目的题目；Axiom 不会自动删除或合并。</p>
                          </div>
                          <ul>
                            {duplicateSuggestions.slice(0, 3).map((suggestion) => (
                              <li key={suggestion.candidate.id}>
                                <ProblemImage
                                  alt="可能重复的题块"
                                  className="problem-duplicate-image"
                                  path={suggestion.candidate.cropImagePath}
                                />
                                <div>
                                  <strong>{suggestion.candidate.title}</strong>
                                  <small>
                                    相似度 {Math.round(suggestion.score * 100)}%
                                    {suggestion.signals.length ? ` · ${suggestion.signals.join('、')}` : ''}
                                  </small>
                                  <div className="problem-duplicate-actions">
                                    <Button disabled={updating} onClick={() => setSelectedId(suggestion.candidate.id)}>
                                      查看候选
                                    </Button>
                                    <Button disabled={updating} onClick={() => void decideDuplicate(suggestion, 'keep_both')}>
                                      保留两题
                                    </Button>
                                    <Button disabled={updating} onClick={() => void decideDuplicate(suggestion, 'merged')} variant="primary">
                                      合并并归档重复项
                                    </Button>
                                  </div>
                                </div>
                              </li>
                            ))}
                          </ul>
                        </section>
                      )}

                      <SolutionComparison
                        attempt={studentAttempt}
                        problem={selected}
                        reasoning={reasoning}
                        solution={solution}
                        onRetrySolution={() => void retrySolution()}
                      />

                      <section className="model-run-history problem-review-history">
                        <p className="eyebrow">学习记录</p>
                        <h3>复习表现</h3>
                        {reviewHistory.length ? <ul>
                          {reviewHistory.map((entry) => <li key={entry.attemptId}>
                            <div>
                              <strong>{entry.overallResult === 'correct' ? '正确' : entry.overallResult === 'partial' ? '部分正确' : '错误'}</strong>
                              <small>{dateFormatter.format(entry.createdAt)} · 可信度 {Math.round(entry.gradingConfidence * 100)}%</small>
                            </div>
                            {entry.firstErrorStep && <p>首错：第 {entry.firstErrorStep} 步{entry.errorCategory ? ` · ${entry.errorCategory}` : ''}</p>}
                            {entry.answerImagePath && <ProblemImage alt="本次复习的用户作答图" className="problem-review-history__answer" path={entry.answerImagePath} />}
                            {entry.evidence.length > 0 && <div className="problem-review-history__evidence">{entry.evidence.map((evidence) => <span key={`${entry.attemptId}:${evidence.tagName}`}>{evidence.tagName} · {evidence.result}</span>)}</div>}
                          </li>)}
                        </ul> : <p>完成练习后，这里会显示你的复习记录。</p>}
                      </section>

                      {!selected.deletedAt && <section className="problem-delete-section">
                        <p className="eyebrow">管理题目</p>
                        <h3>移入回收站</h3>
                        <p>题目会从学习安排中移除，解答、复习证据与相关图片都会保留，可从回收站恢复。</p>
                        {deleteConfirming ? (
                          <div className="problem-delete-confirm">
                            <span>确认要把这道错题移入回收站吗？</span>
                            <div className="problem-delete-confirm-actions">
                              <Button className="problem-delete-cancel" disabled={deleting} onClick={() => setDeleteConfirming(false)} variant="ghost">取消</Button>
                              <Button className="problem-delete-confirm-button" disabled={deleting} loading={deleting} onClick={() => void handleDelete()} variant="danger">
                                {deleting ? '处理中…' : '移入回收站'}
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <Button className="problem-delete-button" disabled={deleting} onClick={() => setDeleteConfirming(true)} variant="danger">移入回收站</Button>
                        )}
                      </section>}

                      <section className="problem-variant-summary-card">
                        <button onClick={openVariantDialog} type="button">
                          <div>
                            <p className="eyebrow">变式题</p>
                            <h3>{savedVariantCount ? `已保存 ${savedVariantCount} 道变式` : '创建第一道变式'}</h3>
                            <p>{savedVariantCount
                              ? '查看不同难度和变化方式的题目，或继续生成。'
                              : storedVariants.length
                                ? '上次没有生成可用题目，可以重新选择难度与变化方式。'
                                : '选择难度与变化方式，生成后保存到本题。'}</p>
                          </div>
                          <span className="problem-variant-summary-card__status">
                            {activeStoredVariant ? variantStatusLabel(activeStoredVariant) : '尚未生成'}
                            <Icon name="chevron" size={18} />
                          </span>
                        </button>
                      </section>
                    </div>
                  </div>
                </>
              )}
            </>
          ) : (
            <div className="library-empty detail-empty">
              <strong>选择一道错题查看详情</strong>
              <p>题块图片和基础信息会显示在这里。</p>
            </div>
          )}
        </article>
      </section>

      <Dialog
        onClose={() => setGeometryDialogOpen(false)}
        open={geometryDialogOpen}
        title="TikZ 几何图"
      >
        <div className="geometry-generation-dialog">
          <div aria-live="polite" className={`geometry-generation-dialog__status is-${geometryState}`} role="status">
            <span className="geometry-generation-dialog__status-icon" aria-hidden="true">
              {geometryState === 'generating'
                ? <span className="ax-spinner" />
                : <Icon name={geometryStatus.icon} size={21} />}
            </span>
            <div>
              <strong>{geometryStatus.title}</strong>
              <span>{geometryStatus.detail}</span>
            </div>
          </div>
          <div className="geometry-generation-dialog__compare">
            <section>
              <strong>题目原图</strong>
              {selected && selectedDiagramRect && <ProblemDiagramImage
                alt={`${selected.title}中的题目原图`}
                croppedPath={selectedDiagramPath}
                path={selected.cropImagePath}
                rect={selectedDiagramRect}
              />}
            </section>
            <section>
              <strong>当前 TikZ</strong>
              {generatedDiagram
                ? <DiagramView alt={`${selected?.title ?? '题目'}的 TikZ 几何图`} diagram={generatedDiagram} showCaption={false} />
                : <div className="geometry-generation-dialog__empty" aria-hidden="true"><Icon name="image" size={30} /></div>}
            </section>
          </div>
          <div className="curriculum-dialog-actions">
            <Button disabled={geometryRunBusy} loading={geometrySceneBusy} onClick={() => void rebuildGeometryScene()} variant="primary">
              {generatedDiagram ? '重新生成' : '生成 TikZ'}
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog
        onClose={() => setVariantDialogOpen(false)}
        open={variantDialogOpen}
        title="变式题"
      >
        <div className="problem-variant-dialog">
          <section className="problem-variant-create-card">
            <div>
              <p className="eyebrow">创建变式</p>
              <h3>选择变化幅度</h3>
              <p>只有点击生成按钮后才会开始；生成结果会保存到本题，不会自动开始练习。</p>
            </div>
            <DiscreteSlider
              ariaLabel="难度"
              disabled={variantBusy}
              onChange={setVariantDraftDifficulty}
              options={difficultyValues.map((value) => ({ value, label: difficultyLabels[value] }))}
              value={variantDraftDifficulty}
            />
            <DiscreteSlider
              ariaLabel="变化"
              disabled={variantBusy}
              onChange={setVariantLevel}
              options={variationValues.map((value) => ({ value, label: variationLabels[value] }))}
              value={variantLevel}
            />
            <Button disabled={variantBusy} loading={variantBusy} onClick={() => void generateSingleVariant()} variant="primary">
              生成变式
            </Button>
          </section>

          {variantBusy && <FlowingTaskSurface compact detail="正在出题并检查答案是否完整" state="running" title="正在生成变式题" />}
          {variantDialogError && !variantBusy && <div className="problem-variant-error" role="alert">
            <strong>暂时没有生成成功</strong>
            <p>{variantDialogError}</p>
            <Button onClick={() => void generateSingleVariant()} variant="secondary">重试</Button>
          </div>}
          {singleVariantPreview?.outcome.variant && !variantBusy && <div className="problem-variant-success" role="status">
            <Icon name="check" size={18} />
            <span>新变式已保存，可以继续生成或查看下方内容。</span>
          </div>}

          {storedVariants.length ? <section className="problem-variant-library">
            <SegmentedControl
              ariaLabel="已保存变式"
              onChange={setActiveVariantKey}
              options={storedVariants.map((item, index) => ({
                value: item.id ?? item.planId,
                label: `变式 ${index + 1} · ${difficultyLabels[item.targetDifficulty]}`,
              }))}
              value={activeStoredVariant?.id ?? activeStoredVariant?.planId ?? ''}
            />
            {activeStoredVariant && <article className="problem-variant-candidate">
              <header>
                <div>
                  <p className="eyebrow">{variationLabels[activeStoredVariant.variationLevel]} · {difficultyLabels[activeStoredVariant.targetDifficulty]}</p>
                  <h3>{variantStatusLabel(activeStoredVariant)}</h3>
                </div>
                <small>{dateFormatter.format(activeStoredVariant.createdAt)}</small>
              </header>
              {activeStoredVariant.candidate ? <>
                <section><h4>题干</h4><MathMarkdown>{activeStoredVariant.candidate.statementMarkdown}</MathMarkdown></section>
                <section><h4>答案</h4><MathMarkdown>{activeStoredVariant.candidate.canonicalAnswer}</MathMarkdown></section>
                <section><h4>解答</h4><MathMarkdown>{variantSolutionMarkdown(activeStoredVariant.candidate.solutionJson)}</MathMarkdown></section>
              </> : <p>{activeStoredVariant.planStatus === 'generating' ? '正在生成，请稍候。' : '这道变式暂时不可用，可以重新生成。'}</p>}
            </article>}
          </section> : !variantBusy && <div className="empty-detail-state">
            <strong>还没有变式</strong>
            <p>选择难度和变化幅度，然后点击“生成变式”。</p>
          </div>}
        </div>
      </Dialog>
      <Dialog
        onClose={() => { if (!updating) setSubjectChangeConfirming(false) }}
        open={subjectChangeConfirming}
        title="确认更改题目科目"
      >
        <div className="problem-edit-form">
          <p>更改科目后，Axiom 会按新科目重新整理本题标签。</p>
          <div className="curriculum-dialog-actions">
            <Button onClick={() => setSubjectChangeConfirming(false)} variant="ghost">取消</Button>
            <Button loading={updating} onClick={() => void saveEdits(true)} variant="primary">继续更改</Button>
          </div>
        </div>
      </Dialog>
      <Toast toast={toast} onClose={dismiss} onPause={pauseAutoDismiss} onResume={resumeAutoDismiss} />
    </main>
  )
}

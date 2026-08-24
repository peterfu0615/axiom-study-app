import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { Button, Dialog, ErrorState, FlowingTaskSurface, IconButton, ListboxSelect, PageHeader, SegmentedControl, Textarea } from '../../components/ui'
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
  setUserProblemDifficulty,
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
  createPracticeSetFromVariantPreview,
  getSingleVariantPrerequisites,
  prepareSingleProblemVariant,
  type SingleVariantPrerequisites,
  type SingleVariantPreview,
} from '../../platform/practiceDatabase'
import type { PracticeSet } from '../../domain/practice'
import { PracticeSetView } from '../practice/PracticeSetView'
import { MathMarkdown } from '../../components/MathMarkdown'

type LibraryView = 'active' | 'archived' | 'trash'
type DetailTab = 'content' | 'info'

const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

const modelRunTaskLabels: Record<string, string> = {
  analyze_problem_image: '题目理解',
  geometry_scene: '几何图重建',
  generate_solution: '正解生成',
  extract_student_attempt: '作答识别',
  analyze_student_reasoning: '错因推理',
  explain_selection: '局部解释',
}

function modelRunMetrics(run: ModelRun) {
  const metrics: string[] = []
  if (run.latencyMs != null) {
    metrics.push(run.latencyMs >= 1000
      ? `${(run.latencyMs / 1000).toFixed(1)} 秒`
      : `${run.latencyMs} ms`)
  }
  if (run.usage?.totalTokens != null) {
    const breakdown = run.usage.promptTokens != null && run.usage.completionTokens != null
      ? `（输入 ${run.usage.promptTokens.toLocaleString('zh-CN')} / 输出 ${run.usage.completionTokens.toLocaleString('zh-CN')}）`
      : ''
    metrics.push(`${run.usage.totalTokens.toLocaleString('zh-CN')} tokens${breakdown}`)
  }
  if (run.estimatedCostUsd != null) {
    metrics.push(`约 $${run.estimatedCostUsd.toFixed(6)}`)
  } else if (run.usage?.totalTokens != null) {
    metrics.push('成本未配置')
  }
  return metrics.join(' · ')
}

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
  const [detailTab, setDetailTab] = useState<DetailTab>('content')
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
  const [variantBusy, setVariantBusy] = useState(false)
  const [variantDialogOpen, setVariantDialogOpen] = useState(false)
  const [variantPrerequisites, setVariantPrerequisites] = useState<SingleVariantPrerequisites | null>(null)
  const [variantDialogError, setVariantDialogError] = useState<string | null>(null)
  const [variantDraftSubject, setVariantDraftSubject] = useState('')
  const [variantDraftStem, setVariantDraftStem] = useState('')
  const [variantDraftDifficulty, setVariantDraftDifficulty] = useState<'basic' | 'intermediate' | 'advanced'>('intermediate')
  const [singleVariantPreview, setSingleVariantPreview] = useState<SingleVariantPreview | null>(null)
  const [activePracticeSet, setActivePracticeSet] = useState<PracticeSet | null>(null)
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
      void Promise.all([getLatestGeometryScene(problemId), getPreferredDiagram('problem', problemId)])
        .then(([scene, diagram]) => { setGeometryScene(scene); setGeneratedDiagram(diagram) })
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
      const scene = await reconstructGeometryScene({
        problemId: selected.id,
        imagePath,
        stemMarkdown: selected.stemMarkdown ?? '',
      })
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
      notify(`几何图重建失败，已保留原图：${String(error)}`, 'error')
    } finally {
      setGeometrySceneBusy(false)
    }
  }

  const generateSingleVariant = async () => {
    if (!selected) return
    setVariantBusy(true)
    setVariantDialogError(null)
    try {
      setSingleVariantPreview(await prepareSingleProblemVariant(selected.id))
    } catch (error) {
      setVariantDialogError(String(error instanceof Error ? error.message : error))
    } finally {
      setVariantBusy(false)
    }
  }

  const refreshVariantPrerequisites = async (autoGenerate = false) => {
    if (!selected) return null
    const snapshot = await getSingleVariantPrerequisites(selected.id)
    setVariantPrerequisites(snapshot)
    setVariantDraftSubject((current) => current || snapshot.subject)
    setVariantDraftStem((current) => current || snapshot.stemMarkdown)
    if (snapshot.difficulty) setVariantDraftDifficulty(snapshot.difficulty)
    if (autoGenerate && snapshot.missing.length === 0 && !variantBusy && !singleVariantPreview) {
      await generateSingleVariant()
    }
    return snapshot
  }

  const openVariantDialog = async () => {
    if (!selected) return
    setVariantDialogOpen(true)
    setSingleVariantPreview(null)
    setVariantDialogError(null)
    setVariantPrerequisites(null)
    setVariantDraftSubject(selected.subject ?? '')
    setVariantDraftStem(selected.stemMarkdown ?? '')
    try { await refreshVariantPrerequisites(true) }
    catch (error) { setVariantDialogError(`无法检查生成条件：${String(error)}`) }
  }

  const completeVariantProblemFields = async () => {
    if (!selected) return
    setVariantBusy(true); setVariantDialogError(null)
    try {
      const updated = await updateProblemUserFields(selected.id, {
        title: selected.title,
        subject: variantDraftSubject,
        stemMarkdown: variantDraftStem,
        knowledgePoints: selected.knowledgePoints,
      })
      setProblems((current) => current.map((problem) => problem.id === updated.id ? updated : problem))
      setVariantBusy(false)
      await refreshVariantPrerequisites(true)
    } catch (error) {
      setVariantDialogError(error instanceof ProblemSubjectChangeConflict
        ? '更改科目需要先在题目编辑页确认教材与标签重置。'
        : String(error))
      setVariantBusy(false)
    }
  }

  const completeVariantDifficulty = async () => {
    if (!selected) return
    setVariantBusy(true); setVariantDialogError(null)
    try {
      await setUserProblemDifficulty(selected.id, variantDraftSubject || selected.subject || '', variantDraftDifficulty)
      setVariantBusy(false)
      await refreshVariantPrerequisites(true)
    } catch (error) { setVariantDialogError(String(error)); setVariantBusy(false) }
  }

  const completeVariantSolution = async () => {
    if (!selected) return
    setVariantDialogError(null)
    try {
      setSolution(await queueProblemSolution(selected.id))
      void runSolutionWorker()
    } catch (error) { setVariantDialogError(`无法生成解答：${String(error)}`) }
  }

  useEffect(() => {
    if (!variantDialogOpen || solution?.status !== 'completed' || variantBusy || singleVariantPreview) return
    void refreshVariantPrerequisites(true).catch((error) => setVariantDialogError(String(error)))
    // The completed solution event is the only trigger needed here; the
    // prerequisite refresh itself updates local dialog state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [solution?.status, variantDialogOpen])

  const startSingleVariantPractice = async () => {
    if (!singleVariantPreview) return
    setVariantBusy(true)
    try {
      setActivePracticeSet(await createPracticeSetFromVariantPreview(singleVariantPreview))
      setSingleVariantPreview(null)
      setVariantDialogOpen(false)
    } catch (error) {
      notify(`无法创建单题练习：${String(error)}`, 'error')
    } finally {
      setVariantBusy(false)
    }
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

  if (activePracticeSet) {
    return <PracticeSetView
      onBack={() => setActivePracticeSet(null)}
      onOpenPracticeSet={setActivePracticeSet}
      practiceSet={activePracticeSet}
    />
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
              <button
                disabled={subjectFilter === 'all'}
                onClick={() => {
                  setBatchMode((current) => !current)
                  setBatchProblemIds(new Set())
                }}
                title={subjectFilter === 'all' ? '请先选择一个科目' : undefined}
                type="button"
              >
                {batchMode ? '退出批量' : '批量操作'}
              </button>
            )}
          </div>

          <div className="problem-list-filters">
            <label><span className="sr-only">搜索错题</span><input onChange={(event) => setQuery(event.target.value)} placeholder="搜索题干、答案或标签" type="search" value={query} /></label>
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
              <button
                disabled={batchRunning || !filteredProblems.length}
                onClick={() => setBatchProblemIds(new Set(filteredProblems.map((problem) => problem.id)))}
                type="button"
              >
                选择当前结果
              </button>
              <button
                disabled={batchRunning || !batchProblemIds.size}
                onClick={() => void startSelectedRelabel()}
                type="button"
              >
                批量重新标注
              </button>
              <ListboxSelect
                ariaLabel="批量迁移到教材"
                disabled={batchRunning}
                onValueChange={setBatchTextbookId}
                options={[{ value: '', label: '清除教材匹配' }, ...batchTextbooks.map((book) => ({ value: book.id, label: book.title }))]}
                value={batchTextbookId}
              />
              <button
                disabled={batchRunning || !batchProblemIds.size}
                onClick={() => void migrateSelectedTextbook()}
                type="button"
              >
                应用教材迁移
              </button>
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
                    setDetailTab('content')
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
                    <button className="primary-button" disabled={updating} onClick={() => void handleRestore()} type="button">
                      {updating ? '恢复中…' : '恢复到错题库'}
                    </button>
                  ) : editing ? (
                    <>
                      <button
                        className="secondary-action"
                        disabled={updating}
                        onClick={cancelEditing}
                        type="button"
                      >
                        取消
                      </button>
                      <button
                        className="primary-button"
                        disabled={updating || !editTitle.trim()}
                        onClick={() => void saveEdits()}
                        type="button"
                      >
                        {updating ? '保存中…' : '保存修改'}
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        className="secondary-action"
                        disabled={updating || variantBusy}
                        onClick={() => void openVariantDialog()}
                        title="生成并独立审校一道变式题"
                        type="button"
                      >
                        {variantBusy ? '生成中…' : '生成变式'}
                      </button>
                      <IconButton
                        aria-pressed={selected.libraryMetadata.favorite}
                        className={selected.libraryMetadata.favorite ? 'is-favorite' : ''}
                        disabled={updating}
                        label={selected.libraryMetadata.favorite ? '取消收藏' : '收藏错题'}
                        onClick={() => void toggleFavorite()}
                      >
                        <Icon filled={selected.libraryMetadata.favorite} name="favorite" size={18} />
                      </IconButton>
                      <button
                        className="secondary-action"
                        disabled={updating}
                        onClick={beginEditing}
                        type="button"
                      >
                        编辑
                      </button>
                      <button
                        className="secondary-action"
                        disabled={updating || !selected.correctedImagePath}
                        onClick={() => {
                          dismiss()
                          setRecropping(true)
                        }}
                        type="button"
                      >
                        重新裁剪
                      </button>
                      <button
                        className="secondary-action"
                        disabled={updating}
                        onClick={() => void toggleArchive()}
                        type="button"
                      >
                        {updating
                          ? '更新中…'
                          : selected.archivedAt
                            ? '取消归档'
                            : '归档'}
                      </button>
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
                    <label>
                      <span>标题</span>
                      <input
                        autoFocus
                        disabled={updating}
                        onChange={(event) => setEditTitle(event.target.value)}
                        required
                        value={editTitle}
                      />
                    </label>
                    <label>
                      <span>科目</span>
                      <input
                        disabled={updating}
                        onChange={(event) =>
                          setEditSubject(event.target.value)
                        }
                        placeholder="例如：数学"
                        value={editSubject}
                      />
                    </label>
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
                  <SegmentedControl
                    ariaLabel="错题详情视图"
                    onChange={setDetailTab}
                    options={[{ value: 'content', label: '题目内容' }, { value: 'info', label: '信息' }]}
                    value={detailTab}
                  />

                  <div className="problem-detail-content">
                  {detailTab === 'content' ? (
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
                              <button
                                className="problem-ai-notice__action"
                                disabled={updating}
                                onClick={() => void retryAI()}
                                type="button"
                              >
                                {selected.aiStatus === 'completed'
                                  ? '重新整理'
                                  : '开始整理'}
                              </button>
                            )}
                            {selectedIsProcessing && (
                              <button className="problem-ai-notice__action" disabled={updating} onClick={() => void cancelAI()} type="button">
                                取消分析
                              </button>
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
                                ? <DiagramView alt={`${selected.title}的 TikZ 几何图`} diagram={generatedDiagram} />
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
                                  <Button
                                    disabled={geometrySceneBusy}
                                    onClick={() => void rebuildGeometryScene()}
                                    variant="secondary"
                                  >
                                    {geometrySceneBusy
                                      ? '正在重建…'
                                      : generatedDiagram
                                        ? '重新生成 TikZ'
                                        : '生成 TikZ 几何图'}
                                  </Button>
                                  {geometryScene?.validationStatus === 'rejected' && (
                                    <small>{geometryScene.validationErrors[0]}</small>
                                  )}
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
                              {selected.aiProblemType || '待识别'}
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

                    </div>
                  ) : (
                    <div className="problem-information-page">
                      <dl className="problem-metadata">
                        <div>
                          <dt>状态</dt>
                          <dd>
                            {selected.deletedAt ? '回收站' : selected.archivedAt ? '已归档' : '已保存'}
                          </dd>
                        </div>
                        <div>
                          <dt>科目</dt>
                          <dd title={selected.subject || '待补充'}>
                            {selected.subject || '待补充'}
                          </dd>
                        </div>
                        <div>
                          <dt>AI 状态</dt>
                          <dd>{aiStatusLabels[selected.aiStatus]}</dd>
                        </div>
                        <div>
                          <dt>Model Runs</dt>
                          <dd>{modelRuns.length}</dd>
                        </div>
                        <div>
                          <dt>创建时间</dt>
                          <dd>{dateFormatter.format(selected.createdAt)}</dd>
                        </div>
                        <div>
                          <dt>最近更新</dt>
                          <dd>{dateFormatter.format(selected.updatedAt)}</dd>
                        </div>
                        <div>
                          <dt>来源页面</dt>
                          <dd title={selected.sourceDocumentId}>
                            {selected.sourceDocumentId.slice(0, 8)}
                          </dd>
                        </div>
                      </dl>

                      <section className="problem-source-information">
                        <div>
                          <p className="eyebrow">题目图片</p>
                          <h3>保存的完整题块</h3>
                          <p>
                            内容页仅在检测到图形时展示 AI 标注区域；这里保留完整裁图。
                          </p>
                        </div>
                        <ProblemImage
                          alt={selected.title}
                          className="problem-source-image"
                          path={selected.cropImagePath}
                        />
                      </section>

                      <section className="problem-source-information">
                        <div><p className="eyebrow">采集来源</p><h3>原图与校正图</h3><p>这些媒体与题块图分别保留，删除到回收站后仍可恢复。</p></div>
                        <div className="problem-source-variants">
                          <figure><ProblemImage alt={`${selected.title}原始采集页`} className="problem-source-image" path={selected.originalImagePath} /><figcaption>原图</figcaption></figure>
                          {selected.correctedImagePath && <figure><ProblemImage alt={`${selected.title}校正页`} className="problem-source-image" path={selected.correctedImagePath} /><figcaption>校正图</figcaption></figure>}
                        </div>
                      </section>

                      <section className="problem-ai-information">
                        <p className="eyebrow">AI 解析信息</p>
                        <h3>结构化结果</h3>
                        <dl>
                          <div>
                            <dt>状态</dt>
                            <dd>{aiStatusLabels[selected.aiStatus]}</dd>
                          </div>
                          <div>
                            <dt>AI 标题</dt>
                            <dd>{selected.aiTitle || '未生成'}</dd>
                          </div>
                          <div>
                            <dt>AI 科目</dt>
                            <dd>{selected.aiSubject || '未识别'}</dd>
                          </div>
                          <div>
                            <dt>题型</dt>
                            <dd>{selected.aiProblemType || '未识别'}</dd>
                          </div>
                          <div>
                            <dt>图形识别</dt>
                            <dd>
                              {selected.aiHasDiagram
                                ? selected.aiDiagramImagePath
                                  ? '已检测并抠图'
                                  : '已检测（边界回退）'
                                : '未检测到'}
                            </dd>
                          </div>
                          <div>
                            <dt>图形区域</dt>
                            <dd>
                              {selected.aiDiagramBBox
                                ? JSON.stringify(selected.aiDiagramBBox)
                                : '—'}
                            </dd>
                          </div>
                        </dl>

                        {selected.aiWarnings.length > 0 && (
                          <div className="ai-warning-list">
                            {selected.aiWarnings.map((warning) => (
                              <p key={warning}>{warning}</p>
                            ))}
                          </div>
                        )}
                      </section>

                      <section className="ocr-information">
                        <p className="eyebrow">Apple Vision OCR</p>
                        <h3>本地识别结果</h3>
                        <dl>
                          <div>
                            <dt>标题</dt>
                            <dd>{selected.ocrTitle}</dd>
                          </div>
                          <div>
                            <dt>科目</dt>
                            <dd>{selected.ocrSubject || '未识别'}</dd>
                          </div>
                          <div>
                            <dt>题干</dt>
                            <dd>{selected.ocrStemMarkdown || '未识别'}</dd>
                          </div>
                        </dl>
                      </section>

                      <section className="model-run-history">
                        <p className="eyebrow">Model Run 历史</p>
                        <h3>每次执行独立保留</h3>
                        {modelRuns.length ? (
                          <ul>
                            {modelRuns.map((run) => (
                              <li key={run.id}>
                                <div>
                                  <strong>
                                    {modelRunTaskLabels[run.taskType] ?? run.taskType} · {run.provider} / {run.model}
                                  </strong>
                                  <small>
                                    {dateFormatter.format(run.createdAt)}
                                  </small>
                                  {modelRunMetrics(run) && (
                                    <small>{modelRunMetrics(run)}</small>
                                  )}
                                </div>
                                <span className={run.status}>
                                  {run.status}
                                </span>
                                {(run.rawOutput || run.repairStrategy) && (
                                  <details className="model-run-output">
                                    <summary>查看模型原始输出</summary>
                                    {run.repairStrategy && (
                                      <small>
                                        修复策略：{run.repairStrategy}
                                      </small>
                                    )}
                                    <pre>{run.rawOutput || '（没有模型输出）'}</pre>
                                  </details>
                                )}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p>暂无调用记录。</p>
                        )}
                      </section>

                      <section className="model-run-history problem-review-history">
                        <p className="eyebrow">学习证据</p>
                        <h3>复习记录</h3>
                        {reviewHistory.length ? <ul>
                          {reviewHistory.map((entry) => <li key={entry.attemptId}>
                            <div><strong>{entry.overallResult === 'correct' ? '正确' : entry.overallResult === 'partial' ? '部分正确' : '错误'}</strong><small>{dateFormatter.format(entry.createdAt)} · 批改置信度 {Math.round(entry.gradingConfidence * 100)}%</small></div>
                            {entry.firstErrorStep && <p>首错：第 {entry.firstErrorStep} 步{entry.errorCategory ? ` · ${entry.errorCategory}` : ''}</p>}
                            {entry.answerImagePath && <ProblemImage alt="本次复习的用户作答图" className="problem-review-history__answer" path={entry.answerImagePath} />}
                            {entry.evidence.length > 0 && <div className="problem-review-history__evidence">{entry.evidence.map((evidence) => <span key={`${entry.attemptId}:${evidence.tagName}`}>{evidence.tagName} · {evidence.result}</span>)}</div>}
                          </li>)}
                        </ul> : <p>暂无复习作答或标签证据。</p>}
                      </section>

                      {!selected.deletedAt && <section className="problem-delete-section">
                        <p className="eyebrow">危险操作</p>
                        <h3>移入回收站</h3>
                        <p>
                          题目将从学习安排中移除，但解答、AI 分析、复习证据与相关图片都会保留，可从回收站恢复。
                        </p>
                        {deleteConfirming ? (
                          <div className="problem-delete-confirm">
                            <span>确认要把这道错题移入回收站吗？</span>
                            <div className="problem-delete-confirm-actions">
                              <button
                                className="problem-delete-cancel"
                                disabled={deleting}
                                onClick={() => setDeleteConfirming(false)}
                                type="button"
                              >
                                取消
                              </button>
                              <button
                                className="problem-delete-confirm-button"
                                disabled={deleting}
                                onClick={() => void handleDelete()}
                                type="button"
                              >
                                {deleting ? '处理中…' : '移入回收站'}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            className="problem-delete-button"
                            disabled={deleting}
                            onClick={() => setDeleteConfirming(true)}
                            type="button"
                          >
                            移入回收站
                          </button>
                        )}
                      </section>}
                    </div>
                  )}
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
        onClose={() => { if (!variantBusy) { setVariantDialogOpen(false); setSingleVariantPreview(null) } }}
        open={variantDialogOpen}
        title={singleVariantPreview ? '变式题预览' : '生成变式'}
      >
        {!variantPrerequisites && !variantDialogError && <FlowingTaskSurface compact state="running" title="正在检查题目条件" />}
        {variantBusy && !singleVariantPreview && <FlowingTaskSurface compact detail="正在生成、独立求解并校验题目" state="running" title="正在生成变式题" />}
        {!variantBusy && solution && ['pending', 'processing'].includes(solution.status) && variantPrerequisites?.missing.includes('solution') && <FlowingTaskSurface compact detail="完成后会自动继续生成变式" state="running" title="正在准备有效解答" />}
        {!variantBusy && variantPrerequisites && variantPrerequisites.missing.length > 0 && <div className="problem-edit-form">
          <p>请在这里完成缺少的信息；最后一项完成后会自动开始生成。</p>
          {(variantPrerequisites.missing.includes('subject') || variantPrerequisites.missing.includes('stem')) && <section>
            <h3>题目信息</h3>
            {variantPrerequisites.missing.includes('subject') && <label><span>科目</span><input onChange={(event) => setVariantDraftSubject(event.target.value)} placeholder="例如：数学" value={variantDraftSubject} /></label>}
            {variantPrerequisites.missing.includes('stem') && <Textarea label="完整题干" onChange={(event) => setVariantDraftStem(event.target.value)} rows={6} value={variantDraftStem} />}
            <Button disabled={!variantDraftSubject.trim() || !variantDraftStem.trim()} onClick={() => void completeVariantProblemFields()} variant="secondary">完成题目信息</Button>
          </section>}
          {variantPrerequisites.missing.includes('solution') && <section>
            <h3>有效解答</h3><p>变式审校需要一份完整解答作为不变量依据。</p>
            <Button disabled={solution?.status === 'pending' || solution?.status === 'processing'} onClick={() => void completeVariantSolution()} variant="secondary">生成并完成解答</Button>
          </section>}
          {variantPrerequisites.missing.includes('difficulty') && <section>
            <h3>题目难度</h3>
            <ListboxSelect ariaLabel="题目难度" onValueChange={(value) => setVariantDraftDifficulty(value as typeof variantDraftDifficulty)} options={[{ value: 'basic', label: '基础' }, { value: 'intermediate', label: '中档' }, { value: 'advanced', label: '进阶' }]} value={variantDraftDifficulty} />
            <Button onClick={() => void completeVariantDifficulty()} variant="secondary">确认难度</Button>
          </section>}
          {variantPrerequisites.missing.includes('tags') && selected && <section>
            <h3>已确认标签</h3><p>确认或添加至少一个知识、方法或模型标签。</p>
            <ProblemTags onChange={() => void refreshVariantPrerequisites(true)} problemId={selected.id} subject={selected.subject} subjectId={selected.subjectId} />
          </section>}
          <div className="curriculum-dialog-actions"><Button onClick={() => setVariantDialogOpen(false)} variant="ghost">关闭</Button></div>
        </div>}
        {variantDialogError && !variantBusy && <div className="problem-edit-form">
          <ErrorState error={classifyAIError(variantDialogError)} />
          <div className="curriculum-dialog-actions"><Button onClick={() => setVariantDialogOpen(false)} variant="ghost">关闭</Button><Button onClick={() => void refreshVariantPrerequisites(true)} variant="primary">重试</Button></div>
        </div>}
        {singleVariantPreview?.outcome.variant && <div className="problem-edit-form">
          <p>该变式已通过独立求解、标签、难度和必要步骤审校。</p>
          <section>
            <small>原题</small>
            <MathMarkdown>{singleVariantPreview.source.statementMarkdown}</MathMarkdown>
          </section>
          <section>
            <small>变式题</small>
            <MathMarkdown>{singleVariantPreview.outcome.variant.candidate.statementMarkdown}</MathMarkdown>
          </section>
          <div>
            {singleVariantPreview.outcome.variant.candidate.changes.map((change) => (
              <small key={`${change.kind}:${change.summary}`}>{change.summary}</small>
            ))}
          </div>
          <div className="curriculum-dialog-actions">
            <Button disabled={variantBusy} onClick={() => { setSingleVariantPreview(null); setVariantDialogOpen(false) }} variant="ghost">关闭</Button>
            <Button loading={variantBusy} onClick={() => void startSingleVariantPractice()} variant="primary">加入今日练习并开始</Button>
          </div>
        </div>}
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

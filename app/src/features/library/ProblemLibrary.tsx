import { useCallback, useEffect, useMemo, useState } from 'react'
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
  getProblemSolution,
  getReasoningAnalysis,
  getStudentAttempt,
  listProblemModelRuns,
  listSavedProblems,
  queueProblemAI,
  queueProblemSolution,
  queueStudentAttempt,
  setProblemArchived,
  updateProblemUserFields,
} from '../../platform/database'
import { mediaAssetUrl } from '../../platform/native'
import { Icon } from '../../components/Icon'
import { Toast } from '../../components/Toast'
import { useToast } from '../../platform/useToast'
import { ProblemCropEditor } from './ProblemCropEditor'
import {
  ExplainableProblemMarkdown,
  SolutionComparison,
} from './SolutionComparison'
import {
  INTELLIGENCE_STATUS_EVENT,
  runIntelligenceWorker,
} from '../../ai/intelligencePipeline'
import { ProblemTags } from './ProblemTags'

type LibraryView = 'active' | 'archived'
type DetailTab = 'content' | 'info'

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
      <figcaption>
        {croppedPath ? 'AI 自动抠取图形' : 'AI 识别图形'}
      </figcaption>
    </figure>
  )
}

export function ProblemLibrary() {
  const [view, setView] = useState<LibraryView>('active')
  const [problems, setProblems] = useState<SavedProblem[]>([])
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
  const [editTitle, setEditTitle] = useState('')
  const [editSubject, setEditSubject] = useState('')
  const [editStemMarkdown, setEditStemMarkdown] = useState('')
  const [editKnowledgePoints, setEditKnowledgePoints] = useState('')
  const [deleteConfirming, setDeleteConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const { toast, notify, dismiss } = useToast()

  const refresh = useCallback(async (
    nextView: LibraryView,
    quietly = false,
  ) => {
    if (!quietly) {
      setLoading(true)
      dismiss()
    }
    try {
      const next = await listSavedProblems(nextView === 'archived')
      setProblems(next)
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
      }
    } finally {
      if (!quietly) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh(view)
  }, [refresh, view])

  useEffect(() => {
    const handleSolutionStatus = (event: Event) => {
      const problemId = (event as CustomEvent<{ problemId?: string }>).detail
        ?.problemId
      if (!problemId || problemId !== selectedId) return
      void getProblemSolution(problemId).then(setSolution)
    }
    window.addEventListener(SOLUTION_STATUS_EVENT, handleSolutionStatus)
    return () =>
      window.removeEventListener(SOLUTION_STATUS_EVENT, handleSolutionStatus)
  }, [selectedId])

  useEffect(() => {
    const handleIntelligenceStatus = (event: Event) => {
      const problemId = (event as CustomEvent<{ problemId?: string }>).detail
        ?.problemId
      if (!problemId || problemId !== selectedId) return
      void Promise.all([
        getStudentAttempt(problemId),
        getReasoningAnalysis(problemId),
      ]).then(([attempt, analysis]) => {
        setStudentAttempt(attempt)
        setReasoning(analysis)
      })
    }
    window.addEventListener(INTELLIGENCE_STATUS_EVENT, handleIntelligenceStatus)
    return () => window.removeEventListener(INTELLIGENCE_STATUS_EVENT, handleIntelligenceStatus)
  }, [selectedId])

  useEffect(() => {
    const handleAIStatus = () => void refresh(view, true)
    window.addEventListener(AI_STATUS_EVENT, handleAIStatus)
    return () => window.removeEventListener(AI_STATUS_EVENT, handleAIStatus)
  }, [refresh, view])

  const selected = useMemo(
    () => problems.find((problem) => problem.id === selectedId) ?? null,
    [problems, selectedId],
  )
  const selectedDiagramRect =
    selected?.aiHasDiagram &&
    isUsableDiagramRect(selected.aiDiagramBBox)
      ? selected.aiDiagramBBox
      : null
  const selectedHasDisplayDiagram =
    Boolean(selectedDiagramRect) &&
    Boolean(selected?.cropImagePath || selected?.aiDiagramImagePath)
  const selectedIsProcessing =
    selected?.aiStatus === 'pending' || selected?.aiStatus === 'processing'
  const activeModelRun =
    modelRuns.find((run) => run.id === selected?.aiActiveModelRunId) ??
    modelRuns[0] ??
    null

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
    }).catch(() => {})
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
    dismiss()
  }

  const saveEdits = async () => {
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
      })
      setProblems((current) =>
        current.map((problem) =>
          problem.id === updated.id ? updated : problem,
        ),
      )
      setEditing(false)
      notify('修改已保存', 'success')
      void runSolutionWorker()
      setSolution(await getProblemSolution(selected.id))
    } catch (error) {
      notify(`保存修改失败：${String(error)}`, 'error')
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

  const handleDelete = async () => {
    if (!selected) return
    setDeleting(true)
    dismiss()
    try {
      await deleteProblem(selected.id)
      setDeleteConfirming(false)
      await refresh(view)
      notify('已删除该错题', 'success')
    } catch (error) {
      notify(`删除失败：${String(error)}`, 'error')
    } finally {
      setDeleting(false)
    }
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
    setSolution(await getProblemSolution(updated.id))
    setStudentAttempt(await getStudentAttempt(updated.id))
    setReasoning(await getReasoningAnalysis(updated.id))

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
      <header className="workspace-header">
        <div>
          <p className="eyebrow">知识资产</p>
          <h1>错题库</h1>
        </div>
        <div className="library-view-switch" role="tablist">
          <button
            aria-selected={view === 'active'}
            className={view === 'active' ? 'active' : ''}
            disabled={editing}
            onClick={() => setView('active')}
            role="tab"
            type="button"
          >
            错题
          </button>
          <button
            aria-selected={view === 'archived'}
            className={view === 'archived' ? 'active' : ''}
            disabled={editing}
            onClick={() => setView('archived')}
            role="tab"
            type="button"
          >
            已归档
          </button>
        </div>
      </header>

      <section className="library-layout">
        <div className="problem-list-panel">
          <div className="problem-list-heading">
            <strong>{view === 'active' ? '全部错题' : '归档错题'}</strong>
            <span>{problems.length} 道</span>
          </div>

          <div className="problem-card-list">
            {loading ? (
              <div className="library-empty">正在读取本地错题…</div>
            ) : problems.length ? (
              problems.map((problem) => (
                <button
                  className={`problem-card ${
                    selectedId === problem.id ? 'active' : ''
                  }`}
                  key={problem.id}
                  disabled={editing}
                  onClick={() => {
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
                  <span className="problem-card-copy">
                    <strong>{problem.title}</strong>
                    <small>{dateFormatter.format(problem.createdAt)}</small>
                    <span className="problem-card-statuses">
                      <span className="problem-status">
                        {problem.archivedAt ? '已归档' : '已保存'}
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
                  {view === 'active' ? '还没有保存错题' : '没有归档错题'}
                </strong>
                <p>
                  {view === 'active'
                    ? '在采集页面确认题块后，点击“保存为错题”。'
                    : '归档后的错题会显示在这里。'}
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
                  {editing ? (
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
                    <label>
                      <span>题干 / 备注</span>
                      <textarea
                        disabled={updating}
                        onChange={(event) =>
                          setEditStemMarkdown(event.target.value)
                        }
                        placeholder="补充题干、解题背景或个人备注"
                        rows={6}
                        value={editStemMarkdown}
                      />
                    </label>
                    <label>
                      <span>知识点</span>
                      <textarea
                        disabled={updating}
                        onChange={(event) =>
                          setEditKnowledgePoints(event.target.value)
                        }
                        placeholder="多个知识点用逗号或换行分隔"
                        rows={3}
                        value={editKnowledgePoints}
                      />
                    </label>
                  </div>
                </div>
              ) : (
                <>
                  <div className="problem-detail-tabs" role="tablist">
                    <button
                      aria-selected={detailTab === 'content'}
                      className={detailTab === 'content' ? 'active' : ''}
                      onClick={() => setDetailTab('content')}
                      role="tab"
                      type="button"
                    >
                      题目内容
                    </button>
                    <button
                      aria-selected={detailTab === 'info'}
                      className={detailTab === 'info' ? 'active' : ''}
                      onClick={() => setDetailTab('info')}
                      role="tab"
                      type="button"
                    >
                      信息
                    </button>
                  </div>

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
                                disabled={updating}
                                onClick={() => void retryAI()}
                                type="button"
                              >
                                {selected.aiStatus === 'completed'
                                  ? '重新整理'
                                  : '开始整理'}
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
                            <ProblemDiagramImage
                              alt={`${selected.title}中的题目图形`}
                              croppedPath={selected.aiDiagramImagePath}
                              path={selected.cropImagePath}
                              rect={selectedDiagramRect}
                            />
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
                          <div
                            className="problem-ai-inline-error"
                            role="alert"
                          >
                            <div>
                              <strong>AI 解析失败</strong>
                              <p>
                                {activeModelRun?.errorMessage ||
                                  '未返回错误详情，题目图片和用户编辑未受影响。'}
                              </p>
                            </div>
                            <button
                              className="secondary-action"
                              disabled={updating}
                              onClick={() => void retryAI()}
                              type="button"
                            >
                              重新运行
                            </button>
                          </div>
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
                        subject={selected.subject}
                      />

                      <SolutionComparison
                        attempt={studentAttempt}
                        problem={selected}
                        reasoning={reasoning}
                        solution={solution}
                        onRetrySolution={() => void retrySolution()}
                      />

                      <section className="problem-learning-next">
                        <header>
                          <div>
                            <p className="eyebrow">继续学习</p>
                            <h3>围绕这道错题继续整理</h3>
                          </div>
                          <span>功能预留</span>
                        </header>
                        <div className="problem-learning-actions">
                          <article>
                            <span className="learning-action-index">01</span>
                            <div>
                              <h4>错因分析</h4>
                              <p>记录错误步骤与原因</p>
                            </div>
                            <small>即将开放</small>
                          </article>
                          <article>
                            <span className="learning-action-index">02</span>
                            <div>
                              <h4>加入复习</h4>
                              <p>在合适的时间再次练习</p>
                            </div>
                            <small>即将开放</small>
                          </article>
                        </div>
                      </section>
                    </div>
                  ) : (
                    <div className="problem-information-page">
                      <dl className="problem-metadata">
                        <div>
                          <dt>状态</dt>
                          <dd>
                            {selected.archivedAt ? '已归档' : '已保存'}
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
                            <dt>置信度</dt>
                            <dd>
                              {selected.aiConfidence === null
                                ? '—'
                                : `${Math.round(
                                    selected.aiConfidence * 100,
                                  )}%`}
                            </dd>
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
                                    {run.provider} / {run.model}
                                  </strong>
                                  <small>
                                    {dateFormatter.format(run.createdAt)}
                                  </small>
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

                      <section className="problem-delete-section">
                        <p className="eyebrow">危险操作</p>
                        <h3>删除该错题</h3>
                        <p>
                          删除后题目、解答、AI 分析记录及相关图片将被永久移除，无法恢复。
                        </p>
                        {deleteConfirming ? (
                          <div className="problem-delete-confirm">
                            <span>确认要删除这道错题吗？此操作不可撤销。</span>
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
                                {deleting ? '删除中…' : '确认删除'}
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
                            删除该错题
                          </button>
                        )}
                      </section>
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

      <Toast toast={toast} />
    </main>
  )
}

import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
} from 'react'
import type {
  ExplainResult,
  ExplainSelectionSource,
  ReasoningAnalysis,
  SavedProblem,
  Solution,
  SolutionStep,
  StudentAttempt,
  StudentAttemptStep,
} from '../../domain/models'
import { MathMarkdown } from '../../components/MathMarkdown'
import { Icon } from '../../components/Icon'
import { explainSelection, EXPLAIN_STREAM_EVENT } from '../../ai/intelligencePipeline'
import { sanitizeAIOutputText, extractPartialField } from '../../ai/intelligenceParser'
import { SOLUTION_STREAM_EVENT } from '../../ai/solutionPipeline'
import { extractReadableMathText, normalizeKeyPoint } from './explanationText'

const EXPLANATION_OPEN_EVENT = 'axiom:explanation-panel-open'

type ExplanationTarget = {
  source: ExplainSelectionSource
  text: string
  step: SolutionStep | StudentAttemptStep | null
  rect: DOMRect
}

type ExplanationState =
  | { status: 'idle' }
  | { status: 'loading'; target: ExplanationTarget }
  | { status: 'completed'; target: ExplanationTarget; result: ExplainResult }
  | { status: 'failed'; target: ExplanationTarget; error: string }

function readableAttempt(attempt: StudentAttempt) {
  if (attempt.rawMarkdown) return attempt.rawMarkdown
  return attempt.steps.map((step) => step.contentMarkdown).join('\n\n')
}

function readableProblem(problem: SavedProblem) {
  return [
    problem.subject,
    problem.aiProblemType,
    problem.stemMarkdown,
    problem.aiChoices
      .map((choice) => `${choice.label}. ${choice.text}`)
      .join('\n'),
    problem.aiSubQuestions
      .map((question) => `${question.index}. ${question.content}`)
      .join('\n'),
  ]
    .filter(Boolean)
    .join('\n')
}

function safeRect(rect: DOMRect) {
  return {
    top: Math.max(12, Math.min(window.innerHeight - 48, rect.top)),
    left: Math.max(12, Math.min(window.innerWidth - 174, rect.right + 8)),
  }
}

const STEP_STATUS_LABELS: Record<string, string> = {
  correct: '正确',
  wrong: '错误',
  missing_reason: '缺失理由',
  unclear: '不明确',
}

function stepStatusLabel(status: string) {
  return STEP_STATUS_LABELS[status] ?? status
}

function ExplainableMathMarkdown({
  children,
  className,
  hoverEnabled = false,
  onTarget,
  source,
  step = null,
}: {
  children: string
  className?: string
  hoverEnabled?: boolean
  onTarget: (target: Omit<ExplanationTarget, 'rect'> & { rect: DOMRect }) => void
  source: ExplainSelectionSource
  step?: SolutionStep | StudentAttemptStep | null
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [hoverTarget, setHoverTarget] = useState<ExplanationTarget | null>(null)
  const [selectionTarget, setSelectionTarget] = useState<ExplanationTarget | null>(null)
  const hideTimer = useRef<number | null>(null)

  useEffect(() => {
    const clearDetachedSelection = () => {
      const selection = window.getSelection()
      const range = selection?.rangeCount ? selection.getRangeAt(0) : null
      if (
        !selection?.toString().trim() ||
        !range ||
        !rootRef.current?.contains(range.commonAncestorContainer)
      ) {
        setSelectionTarget(null)
      }
    }
    document.addEventListener('selectionchange', clearDetachedSelection)
    return () => {
      document.removeEventListener('selectionchange', clearDetachedSelection)
      if (hideTimer.current !== null) window.clearTimeout(hideTimer.current)
    }
  }, [])

  const clearHover = () => {
    if (hideTimer.current !== null) window.clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => setHoverTarget(null), 120)
  }

  const updateHover = (event: MouseEvent<HTMLDivElement>) => {
    if (!hoverEnabled) return
    const element = event.target instanceof HTMLElement
      ? event.target.closest('p, li, blockquote, h1, h2, h3, h4')
      : null
    if (!element || !rootRef.current?.contains(element)) return
    const text = extractReadableMathText(element)
    if (!text) return
    if (hideTimer.current !== null) window.clearTimeout(hideTimer.current)
    setHoverTarget({
      source,
      text,
      step,
      rect: element.getBoundingClientRect(),
    })
  }

  const handleSelection = () => {
    if (!hoverEnabled) return
    window.setTimeout(() => {
      const selection = window.getSelection()
      const range = selection?.rangeCount ? selection.getRangeAt(0) : null
      if (!range || !rootRef.current?.contains(range.commonAncestorContainer)) {
        setSelectionTarget(null)
        return
      }
      // 同样把选区内的 KaTeX 还原为 $LaTeX$ 源，避免 MathML+视觉层重复拼接。
      const container = document.createElement('div')
      container.appendChild(range.cloneContents())
      const text = extractReadableMathText(container) || selection?.toString().trim() || ''
      if (!text) {
        setSelectionTarget(null)
        return
      }
      setSelectionTarget({ source, text, step, rect: range.getBoundingClientRect() })
    }, 0)
  }

  const triggerHoverExplanation = () => {
    const target = selectionTarget ?? hoverTarget
    if (!target) return
    onTarget(target)
    setHoverTarget(null)
    setSelectionTarget(null)
  }

  const buttonTarget = selectionTarget ?? hoverTarget

  return (
    <div
      className="explainable-markdown"
      onMouseDown={() => setSelectionTarget(null)}
      onMouseLeave={clearHover}
      onMouseMove={updateHover}
      onMouseUp={handleSelection}
      onScrollCapture={() => {
        setHoverTarget(null)
        setSelectionTarget(null)
      }}
      ref={rootRef}
    >
      <MathMarkdown className={className}>{children}</MathMarkdown>
      {buttonTarget && (
        <button
          className="explain-hover-button"
          onClick={(event) => {
            event.stopPropagation()
            triggerHoverExplanation()
          }}
          onMouseEnter={() => {
            if (hideTimer.current !== null) window.clearTimeout(hideTimer.current)
          }}
          style={{
            top: safeRect(buttonTarget.rect).top,
            left: safeRect(buttonTarget.rect).left,
          }}
          type="button"
        >
          <Icon name="ai" size={13} />
          向我解释
        </button>
      )}
    </div>
  )
}

function SolutionPane({
  attempt,
  className,
  modal,
  onTarget,
  onRetrySolution,
  solution,
  streamChars = 0,
}: {
  attempt: StudentAttempt | null
  className: string
  modal: boolean
  onTarget: (target: ExplanationTarget) => void
  onRetrySolution?: () => void
  solution: Solution | null
  streamChars?: number
}) {
  const isSolution = className.includes('solution')
  const content = isSolution
    ? solution?.contentMarkdown ?? ''
    : attempt
      ? readableAttempt(attempt)
      : ''
  const status = isSolution ? solution?.status : attempt?.status
  return (
    <article className={`comparison-pane ${className}`}>
      <header>
        <div>
          <span className="comparison-kicker">{isSolution ? 'Solution Engine' : 'Student Attempt'}</span>
          <h3>{isSolution ? '正确解法' : '我的解答'}</h3>
        </div>
        <span className={`comparison-status ${status ?? 'not_started'}`}>
          {status === 'completed'
            ? '已完成'
            : status === 'pending' || status === 'processing'
              ? '整理中'
              : status === 'failed'
                ? '失败'
                : '未生成'}
        </span>
      </header>
      <div className={`comparison-pane-body ${modal ? 'modal-body' : 'preview-body'}`}>
        {status === 'completed' &&
        content &&
        (!modal ||
          (isSolution
            ? !solution?.steps.length
            : !attempt?.steps.length)) ? (
          <ExplainableMathMarkdown
            className={isSolution ? 'problem-solution-content' : 'student-attempt-content'}
            hoverEnabled={modal && isSolution}
            onTarget={onTarget}
            source={isSolution ? 'solution' : 'student_attempt'}
          >
            {content}
          </ExplainableMathMarkdown>
        ) : status === 'pending' || status === 'processing' ? (
          <div className="comparison-placeholder comparison-scanning">
            <span className="ai-scan-icon">
              <Icon name="ai" size={18} />
            </span>
            <span className="ai-scanning-text">
              {isSolution ? 'AI 正在生成正解' : 'AI 正在识别我的解答'}
              {isSolution && streamChars > 0 && (
                <span className="ai-stream-progress"> · 已生成 {streamChars} 字符</span>
              )}
            </span>
          </div>
        ) : status === 'failed' ? (
          <div className="comparison-placeholder error">
            <span>{isSolution ? solution?.errorMessage || '标准解答生成失败' : attempt?.errorMessage || '用户解答识别失败'}</span>
            {isSolution && onRetrySolution && (
              <button onClick={(event) => { event.stopPropagation(); onRetrySolution() }} type="button">
                重新生成
              </button>
            )}
          </div>
        ) : modal && (isSolution ? solution?.steps?.length : attempt?.steps?.length) ? null : (
          <div className="comparison-placeholder">
            {isSolution ? '暂无正解' : '暂无我的解答'}
          </div>
        )}
        {modal && isSolution && solution?.steps?.length ? (
          <div className="comparison-step-list">
            {solution.steps.map((step) => (
              <section className="comparison-step" key={step.index}>
                <span>步骤 {step.index}</span>
                {step.title ? (
                  <strong>
                    <MathMarkdown inline>{sanitizeAIOutputText(step.title)}</MathMarkdown>
                  </strong>
                ) : null}
                <ExplainableMathMarkdown
                  className="problem-solution-content"
                  hoverEnabled
                  onTarget={onTarget}
                  source="solution"
                  step={step}
                >
                  {step.contentMarkdown}
                </ExplainableMathMarkdown>
              </section>
            ))}
          </div>
        ) : null}
        {modal && !isSolution && attempt?.steps?.length ? (
          <div className="comparison-step-list">
            {attempt.steps.map((step) => (
              <section className="comparison-step" key={step.index}>
                <span>步骤 {step.index}</span>
                <ExplainableMathMarkdown
                  className="problem-solution-content"
                  hoverEnabled={false}
                  onTarget={onTarget}
                  source="student_attempt"
                  step={step}
                >
                  {step.contentMarkdown}
                </ExplainableMathMarkdown>
              </section>
            ))}
          </div>
        ) : null}
        {modal && isSolution && solution?.status === 'completed' && (
          <div className="solution-insights">
            {solution.keyMethod && (
              <div>
                <span>关键方法</span>
                <MathMarkdown className="solution-formula-list">
                  {solution.keyMethod}
                </MathMarkdown>
              </div>
            )}
            {solution.knowledgePoints.length > 0 && (
              <div>
                <span>关联知识点</span>
                <MathMarkdown className="solution-formula-list">
                  {solution.knowledgePoints.join(' · ')}
                </MathMarkdown>
              </div>
            )}
          </div>
        )}
      </div>
    </article>
  )
}

function ExplanationPanel({
  explanation,
  onClose,
  onRetry,
}: {
  explanation: ExplanationState
  onClose: () => void
  onRetry: () => void
}) {
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [streamText, setStreamText] = useState('')
  const panelRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{
    startX: number
    startY: number
    x: number
    y: number
    rect: DOMRect
  } | null>(null)
  useEffect(() => {
    if (explanation.status === 'idle') {
      setPosition({ x: 0, y: 0 })
      setStreamText('')
    }
  }, [explanation.status])
  // 流式订阅：loading 时实时显示 AI 累积输出。
  // SSE chunk 频率很高，这里用 ~100ms 尾部节流合帧，
  // 避免每个 chunk 都触发全量重渲染。
  useEffect(() => {
    if (explanation.status !== 'loading') return
    setStreamText('')
    let latest = ''
    let timer: number | null = null
    const flush = () => {
      timer = null
      setStreamText(latest)
    }
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as { accumulated: string }
      if (typeof detail?.accumulated === 'string') {
        latest = detail.accumulated
        if (timer === null) timer = window.setTimeout(flush, 100)
      }
    }
    window.addEventListener(EXPLAIN_STREAM_EVENT, handler)
    return () => {
      window.removeEventListener(EXPLAIN_STREAM_EVENT, handler)
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [explanation.status])
  if (explanation.status === 'idle') return null
  const target = explanation.target
  // 流式期从部分 JSON 中提取 explanation_markdown 字段渲染；
  // 提取失败（字段尚未到达/输入非法）退回下方占位，绝不渲染原始 JSON 文本。
  const streamPartial = streamText
    ? extractPartialField(streamText, 'explanation_markdown')
    : null
  // key_point 可能自带星号/转义（各形态见 normalizeKeyPoint），
  // 剥净后用 JSX <strong> 拼接标签，不再依赖 remark 的 emphasis 解析
  // （全角冒号紧跟 `**` 会导致 flanking 判定失败、星号字面显示）。
  const keyPointText =
    explanation.status === 'completed' ? normalizeKeyPoint(explanation.result.keyPoint ?? '') : ''
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return
    const dx = event.clientX - drag.current.startX
    const dy = event.clientY - drag.current.startY
    const horizontal = Math.min(
      window.innerWidth - 12 - drag.current.rect.right,
      Math.max(12 - drag.current.rect.left, dx),
    )
    const vertical = Math.min(
      window.innerHeight - 12 - drag.current.rect.bottom,
      Math.max(12 - drag.current.rect.top, dy),
    )
    setPosition({
      x: drag.current.x + horizontal,
      y: drag.current.y + vertical,
    })
  }
  const onPointerUp = () => {
    drag.current = null
  }
  return (
    <div
      className="explain-floating-panel"
      onPointerMove={onPointerMove}
      onPointerCancel={onPointerUp}
      onPointerUp={onPointerUp}
      ref={panelRef}
      style={{
        transform: `translate(calc(-50% + ${position.x}px), ${position.y}px)`,
      }}
    >
      <header
        onPointerDown={(event) => {
          if (event.target instanceof HTMLElement && event.target.closest('button')) {
            return
          }
          const rect = panelRef.current?.getBoundingClientRect()
          if (!rect) return
          drag.current = {
            startX: event.clientX,
            startY: event.clientY,
            x: position.x,
            y: position.y,
            rect,
          }
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
      >
        <span><Icon name="ai" size={15} /> 向我解释</span>
        <button
          aria-label="关闭解释"
          onClick={onClose}
          onPointerDown={(event) => event.stopPropagation()}
          type="button"
        >
          ×
        </button>
      </header>
      <div className="explain-floating-body">
        <MathMarkdown className="explain-selection-quote">{target.text}</MathMarkdown>
        {explanation.status === 'loading' &&
          (streamPartial ? (
            <MathMarkdown className="explain-result-content explain-streaming">{streamPartial}</MathMarkdown>
          ) : (
            <div className="comparison-placeholder"><Icon name="ai" size={18} />正在生成解释…</div>
          ))}
        {explanation.status === 'failed' && (
          <div className="explain-error" role="alert">
            <strong>解释生成失败</strong>
            <p>{explanation.error}</p>
            <button onClick={onRetry} type="button">重试</button>
          </div>
        )}
        {explanation.status === 'completed' && (
          <>
            <MathMarkdown className="explain-result-content">{explanation.result.explanationMarkdown}</MathMarkdown>
            {keyPointText && (
              <div className="explain-key-point">
                <p>
                  <strong>关键点：</strong>
                  <MathMarkdown inline>{keyPointText}</MathMarkdown>
                </p>
              </div>
            )}
            {explanation.result.relatedKnowledgePoints.length > 0 && (
              <div className="explain-related-points">
                <MathMarkdown>
                  {`关联知识点：${explanation.result.relatedKnowledgePoints.join(' · ')}`}
                </MathMarkdown>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export function ExplainableProblemMarkdown({
  attempt,
  children,
  className,
  problem,
  solution,
}: {
  attempt: StudentAttempt | null
  children: string
  className?: string
  problem: SavedProblem
  solution: Solution | null
}) {
  const [explanation, setExplanation] = useState<ExplanationState>({ status: 'idle' })
  const requestId = useRef(0)
  const ownerId = useRef(crypto.randomUUID())

  useEffect(() => {
    requestId.current += 1
    setExplanation({ status: 'idle' })
  }, [problem.id])

  useEffect(() => {
    const closeOtherPanel = (event: Event) => {
      const owner = (event as CustomEvent<{ owner: string }>).detail?.owner
      if (!owner || owner === ownerId.current) return
      requestId.current += 1
      setExplanation({ status: 'idle' })
    }
    window.addEventListener(EXPLANATION_OPEN_EVENT, closeOtherPanel)
    return () => window.removeEventListener(EXPLANATION_OPEN_EVENT, closeOtherPanel)
  }, [])

  const openExplanation = async (target: ExplanationTarget) => {
    window.dispatchEvent(
      new CustomEvent(EXPLANATION_OPEN_EVENT, {
        detail: { owner: ownerId.current },
      }),
    )
    const currentRequest = ++requestId.current
    setExplanation({ status: 'loading', target })
    try {
      const result = await explainSelection({
        problemId: problem.id,
        cropImagePath: problem.cropImagePath,
        source: 'problem',
        selectedText: target.text,
        problemContext: readableProblem(problem),
        currentStep: null,
        solutionContext: solution?.contentMarkdown ?? '',
        studentAttemptContext: attempt ? readableAttempt(attempt) : '',
        knowledgePoints: problem.knowledgePoints,
      })
      if (currentRequest !== requestId.current) return
      setExplanation({ status: 'completed', target, result })
    } catch (error) {
      if (currentRequest !== requestId.current) return
      setExplanation({ status: 'failed', target, error: String(error) })
    }
  }

  return (
    <>
      <ExplainableMathMarkdown
        className={className}
        onTarget={openExplanation}
        source="problem"
      >
        {children}
      </ExplainableMathMarkdown>
      <ExplanationPanel
        explanation={explanation}
        onClose={() => {
          requestId.current += 1
          setExplanation({ status: 'idle' })
        }}
        onRetry={() => {
          if (explanation.status !== 'idle') {
            void openExplanation(explanation.target)
          }
        }}
      />
    </>
  )
}

export function SolutionComparison({
  attempt,
  problem,
  reasoning,
  solution,
  onRetrySolution,
}: {
  attempt: StudentAttempt | null
  problem: SavedProblem
  reasoning: ReasoningAnalysis | null
  solution: Solution | null
  onRetrySolution?: () => void
}) {
  const [modalOpen, setModalOpen] = useState(false)
  const [copyMessage, setCopyMessage] = useState<string | null>(null)
  const [explanation, setExplanation] = useState<ExplanationState>({ status: 'idle' })
  const [solutionStreamChars, setSolutionStreamChars] = useState(0)
  const explanationRequestId = useRef(0)
  const explanationOwnerId = useRef(crypto.randomUUID())

  // 流式订阅：正解生成时实时显示已接收字符数
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as { problemId: string; accumulated: string }
      if (detail?.problemId === problem.id) {
        setSolutionStreamChars(detail.accumulated.length)
      }
    }
    window.addEventListener(SOLUTION_STREAM_EVENT, handler)
    return () => window.removeEventListener(SOLUTION_STREAM_EVENT, handler)
  }, [problem.id])

  useEffect(() => {
    // 正解状态变化时重置流式计数
    if (solution?.status !== 'processing') {
      setSolutionStreamChars(0)
    }
  }, [solution?.status])

  useEffect(() => {
    if (!modalOpen) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setModalOpen(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [modalOpen])

  useEffect(() => {
    explanationRequestId.current += 1
    setExplanation({ status: 'idle' })
    setCopyMessage(null)
  }, [problem.id])

  useEffect(() => {
    const closeOtherPanel = (event: Event) => {
      const owner = (event as CustomEvent<{ owner: string }>).detail?.owner
      if (!owner || owner === explanationOwnerId.current) return
      explanationRequestId.current += 1
      setExplanation({ status: 'idle' })
    }
    window.addEventListener(EXPLANATION_OPEN_EVENT, closeOtherPanel)
    return () => window.removeEventListener(EXPLANATION_OPEN_EVENT, closeOtherPanel)
  }, [])

  const openExplanation = async (target: ExplanationTarget) => {
    window.dispatchEvent(
      new CustomEvent(EXPLANATION_OPEN_EVENT, {
        detail: { owner: explanationOwnerId.current },
      }),
    )
    const requestId = ++explanationRequestId.current
    setExplanation({ status: 'loading', target })
    try {
      const result = await explainSelection({
        problemId: problem.id,
        cropImagePath: problem.cropImagePath,
        source: target.source,
        selectedText: target.text,
        problemContext: readableProblem(problem),
        currentStep: target.step,
        solutionContext: solution?.contentMarkdown ?? '',
        studentAttemptContext: attempt ? readableAttempt(attempt) : '',
        knowledgePoints: problem.knowledgePoints,
      })
      if (requestId !== explanationRequestId.current) return
      setExplanation({ status: 'completed', target, result })
    } catch (error) {
      if (requestId !== explanationRequestId.current) return
      setExplanation({ status: 'failed', target, error: String(error) })
    }
  }

  const retryExplanation = () => {
    if (explanation.status !== 'idle') void openExplanation(explanation.target)
  }

  const copySolution = async () => {
    if (!solution?.contentMarkdown) return
    try {
      await navigator.clipboard.writeText(solution.contentMarkdown)
      setCopyMessage('已复制 Markdown / LaTeX')
    } catch (error) {
      setCopyMessage(`复制失败：${String(error)}`)
    }
  }

  const closeModal = (event?: MouseEvent<HTMLDivElement>) => {
    if (!event || event.target === event.currentTarget) setModalOpen(false)
  }

  return (
    <>
      <section className="solution-comparison-section">
        <header className="problem-solution-header">
          <div>
            <p className="eyebrow">Learning Feedback</p>
            <h3>解题过程</h3>
          </div>
          {reasoning?.status === 'completed' ? (
            <span className="comparison-analysis-badge">已完成 AI 分析</span>
          ) : reasoning?.status === 'failed' ? (
            <span className="comparison-analysis-badge failed">AI 分析失败</span>
          ) : reasoning?.status === 'pending' ||
            reasoning?.status === 'processing' ? (
            <span className="comparison-analysis-badge pending">AI 分析中</span>
          ) : null}
        </header>
        <div
          aria-label="查看正确解法与我的解答"
          className="solution-comparison-preview"
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              setModalOpen(true)
            }
          }}
          onClick={() => {
            if (window.getSelection()?.toString().trim()) return
            setModalOpen(true)
          }}
          role="button"
          tabIndex={0}
        >
          <SolutionPane
            attempt={attempt}
            className="solution-pane"
            modal={false}
            onTarget={openExplanation}
            onRetrySolution={onRetrySolution}
            solution={solution}
            streamChars={solutionStreamChars}
          />
          <div aria-hidden="true" className="solution-comparison-divider" />
          <SolutionPane
            attempt={attempt}
            className="attempt-pane"
            modal={false}
            onTarget={openExplanation}
            solution={solution}
          />
          <span className="comparison-open-hint">点击查看完整解答</span>
        </div>
      </section>

      {modalOpen && (
        <div
          aria-modal="true"
          className="solution-comparison-backdrop"
          onClick={closeModal}
          role="dialog"
        >
          <div className="solution-comparison-modal">
            <header className="comparison-modal-header">
              <div>
                <p className="eyebrow">题目解答</p>
                <h2>正确解法与我的解答</h2>
              </div>
              <div className="comparison-modal-actions">
                {solution?.status === 'completed' && solution.contentMarkdown && (
                  <button className="secondary-action" onClick={() => void copySolution()} type="button">复制</button>
                )}
                <button aria-label="关闭解答窗口" className="icon-button" onClick={() => setModalOpen(false)} type="button">×</button>
              </div>
            </header>
            <div className="solution-comparison-modal-body">
              <SolutionPane
                attempt={attempt}
                className="solution-pane"
                modal
                onTarget={openExplanation}
                onRetrySolution={onRetrySolution}
                solution={solution}
                streamChars={solutionStreamChars}
              />
              <div aria-hidden="true" className="solution-comparison-divider" />
              <SolutionPane
                attempt={attempt}
                className="attempt-pane"
                modal
                onTarget={openExplanation}
                solution={solution}
              />
            </div>
            {reasoning?.status === 'completed' && (
              <section className="reasoning-summary">
                <div>
                  <span className="comparison-kicker">AI 分析</span>
                  <h3 className="reasoning-approach-title">
                    <MathMarkdown>{sanitizeAIOutputText(reasoning.approach) || '解题思路分析'}</MathMarkdown>
                  </h3>
                </div>
                {reasoning.firstWrongStep && (
                  <p>首个需要检查的步骤：第 {reasoning.firstWrongStep} 步</p>
                )}
                {reasoning.errorType && <p>错误类型：{sanitizeAIOutputText(reasoning.errorType)}</p>}
                {sanitizeAIOutputText(reasoning.reason) && (
                  <MathMarkdown className="reasoning-text">{sanitizeAIOutputText(reasoning.reason)}</MathMarkdown>
                )}
                {reasoning.knowledgeGaps.map(sanitizeAIOutputText).filter((gap) => gap.length > 0).length > 0 && (
                  <p>知识缺口：{reasoning.knowledgeGaps.map(sanitizeAIOutputText).filter((gap) => gap.length > 0).join(' · ')}</p>
                )}
                {sanitizeAIOutputText(reasoning.suggestion) && (
                  <MathMarkdown className="reasoning-text">{sanitizeAIOutputText(reasoning.suggestion)}</MathMarkdown>
                )}
                {reasoning.stepEvaluations.length > 0 && (
                  <div className="reasoning-step-evaluations">
                    {reasoning.stepEvaluations.map((item) => (
                      <div className={`evaluation-item evaluation-${item.status}`} key={item.studentStepIndex}>
                        <span className="evaluation-header">
                          第 {item.studentStepIndex} 步 · {stepStatusLabel(item.status)}
                        </span>
                        {sanitizeAIOutputText(item.comment) && (
                          <MathMarkdown className="reasoning-text evaluation-comment">{sanitizeAIOutputText(item.comment)}</MathMarkdown>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}
            {reasoning?.status === 'failed' && (
              <section className="reasoning-summary failed" role="alert">
                <div>
                  <span className="comparison-kicker">AI 分析失败</span>
                  <h3>用户解题过程暂未完成评估</h3>
                </div>
                <p>{reasoning.errorMessage || '未返回错误详情。'}</p>
              </section>
            )}
            {copyMessage && <p aria-live="polite" className="solution-copy-message">{copyMessage}</p>}
          </div>
        </div>
      )}
      <ExplanationPanel
        explanation={explanation}
        onClose={() => {
          explanationRequestId.current += 1
          setExplanation({ status: 'idle' })
        }}
        onRetry={retryExplanation}
      />
    </>
  )
}

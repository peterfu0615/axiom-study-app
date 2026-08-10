import { useCallback, useEffect, useMemo, useState } from 'react'
import { Toast } from '../../components/Toast'
import { useToast } from '../../platform/useToast'
import type {
  DocumentProcessingResult,
  NormalizedRect,
  ProblemBlock,
  SourceDocument,
} from '../../domain/models'
import {
  isDocumentAutoProcessingCompleted,
  shareDocumentAutoProcessing,
} from './documentAutoProcessing'
import {
  allProblemBlockIds,
  replaceProblemBlockSelection,
  selectProblemBlocks,
  toggleProblemBlockId,
} from '../../domain/problemSelection'
import { Icon } from '../../components/Icon'
import { CropSelectionCanvas } from '../../components/CropSelectionCanvas'
import {
  loadCandidateBlocks,
  saveDocumentProcessing,
  saveProblems,
} from '../../platform/database'
import { runProblemAIWorker } from '../../ai/pipeline'
import { processDocument } from '../../platform/native'

type EnhancementMode = 'color' | 'grayscale'
type PreviewMode = 'corrected' | 'original'
type RegionSelection = {
  answer: NormalizedRect | null
  diagram: NormalizedRect | null
}
function unionRect(blocks: ProblemBlock[]): NormalizedRect {
  const x = Math.min(...blocks.map((block) => block.rect.x))
  const y = Math.min(...blocks.map((block) => block.rect.y))
  const maxX = Math.max(
    ...blocks.map((block) => block.rect.x + block.rect.width),
  )
  const maxY = Math.max(
    ...blocks.map((block) => block.rect.y + block.rect.height),
  )
  return { x, y, width: maxX - x, height: maxY - y }
}

function lowerHalf(rect: NormalizedRect): NormalizedRect {
  return {
    x: rect.x,
    y: rect.y + rect.height / 2,
    width: rect.width,
    height: rect.height / 2,
  }
}

function createId() {
  return crypto.randomUUID()
}

export function DocumentEditor({
  document,
  onBack,
  onSaved,
}: {
  document: SourceDocument
  onBack: () => void
  onSaved: () => Promise<void>
}) {
  const [mode, setMode] = useState<EnhancementMode>('color')
  const [previewMode, setPreviewMode] = useState<PreviewMode>('corrected')
  const [correctedPath, setCorrectedPath] = useState(
    document.correctedImagePath,
  )
  const [blocks, setBlocks] = useState<ProblemBlock[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [saveSelectedIds, setSaveSelectedIds] = useState<Set<string>>(
    new Set(),
  )
  const [regionSelections, setRegionSelections] = useState<
    Record<string, RegionSelection>
  >({})
  const [activeId, setActiveId] = useState<string | null>(null)
  const [activeRegionId, setActiveRegionId] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [pageDetected, setPageDetected] = useState<boolean | null>(null)
  const [durationMs, setDurationMs] = useState<number | null>(null)
  const [processing, setProcessing] = useState(false)
  const [saving, setSaving] = useState(false)
  const { toast, notify, dismiss } = useToast()

  const applyProcessingResult = useCallback(
    (result: DocumentProcessingResult) => {
      setCorrectedPath(result.correctedPath)
      setBlocks(result.blocks)
      setSelectedIds(new Set())
      setSaveSelectedIds(allProblemBlockIds(result.blocks))
      setRegionSelections({})
      setActiveId(result.blocks[0]?.id ?? null)
      setActiveRegionId(result.blocks[0]?.id ?? null)
      setWarnings(result.warnings)
      setPageDetected(result.pageDetected)
      setDurationMs(result.durationMs)
      setPreviewMode('corrected')
    },
    [],
  )

  const runProcessing = useCallback(
    async (nextMode: EnhancementMode) => {
      setMode(nextMode)
      setProcessing(true)
      dismiss()
      try {
        const result = await processDocument(
          document.id,
          document.originalImagePath,
          nextMode,
        )
        await saveDocumentProcessing(document.id, result)
        applyProcessingResult(result)
        await onSaved()
      } catch (error) {
        notify(`页面处理失败：${String(error)}`, 'error')
      } finally {
        setProcessing(false)
      }
    },
    [applyProcessingResult, document.id, document.originalImagePath, onSaved],
  )

  useEffect(() => {
    let cancelled = false
    async function loadExistingBlocks() {
      const existing = await loadCandidateBlocks(document.id)
      if (cancelled) return
      setBlocks(existing)
      setSaveSelectedIds(allProblemBlockIds(existing))
      setRegionSelections({})
      setActiveId(existing[0]?.id ?? null)
      setActiveRegionId(existing[0]?.id ?? null)
      if (!existing.length) {
        notify('本页没有待确认题块；已保存内容可在错题库查看', 'info')
      }
    }
    async function initialize() {
      // Automatic processing must happen once per source document per
      // session.  StrictMode remounts share the in-flight run, and a
      // completed document loads its persisted blocks instead of
      // re-dispatching `process_document`.
      if (
        !document.correctedImagePath &&
        !isDocumentAutoProcessingCompleted(document.id)
      ) {
        setMode('color')
        setProcessing(true)
        dismiss()
        try {
          const result = await shareDocumentAutoProcessing(
            document.id,
            async () => {
              const processed = await processDocument(
                document.id,
                document.originalImagePath,
                'color',
              )
              await saveDocumentProcessing(document.id, processed)
              return processed
            },
          )
          if (cancelled) return
          if (result) {
            applyProcessingResult(result)
            await onSaved()
          } else {
            await loadExistingBlocks()
          }
        } catch (error) {
          if (!cancelled) notify(`页面处理失败：${String(error)}`, 'error')
        } finally {
          if (!cancelled) setProcessing(false)
        }
        return
      }
      await loadExistingBlocks()
    }
    void initialize()
    return () => {
      cancelled = true
    }
  }, [
    applyProcessingResult,
    document.correctedImagePath,
    document.id,
    document.originalImagePath,
    onSaved,
  ])

  const updateBlockRect = (id: string, rect: NormalizedRect) => {
    setBlocks((current) =>
      current.map((block) => (block.id === id ? { ...block, rect } : block)),
    )
  }

  const updateCanvasRect = (id: string, rect: NormalizedRect) => {
    const suffix = id.endsWith('-answer')
      ? 'answer'
      : id.endsWith('-diagram')
        ? 'diagram'
        : null
    if (!suffix) {
      updateBlockRect(id, rect)
      return
    }
    const blockId = id.slice(0, -(`-${suffix}`.length))
    setRegionSelections((current) => ({
      ...current,
      [blockId]: {
        answer: current[blockId]?.answer ?? null,
        diagram: current[blockId]?.diagram ?? null,
        [suffix]: rect,
      },
    }))
  }

  const activateCanvasRegion = (id: string) => {
    setActiveRegionId(id)
    const blockId = id.endsWith('-answer')
      ? id.slice(0, -'-answer'.length)
      : id.endsWith('-diagram')
        ? id.slice(0, -'-diagram'.length)
        : id
    setActiveId(blockId)
    setSelectedIds((current) =>
      current.has(blockId) ? current : new Set([blockId]),
    )
  }

  const activeBlock = blocks.find((block) => block.id === activeId) ?? null
  const selectedBlocks = useMemo(
    () => selectProblemBlocks(blocks, selectedIds),
    [blocks, selectedIds],
  )
  const saveSelectedBlocks = useMemo(
    () => selectProblemBlocks(blocks, saveSelectedIds),
    [blocks, saveSelectedIds],
  )

  const toggleSelection = (id: string) => {
    setSelectedIds((current) => toggleProblemBlockId(current, id))
    setActiveId(id)
    setActiveRegionId(id)
  }

  const toggleSaveSelection = (id: string) => {
    setSaveSelectedIds((current) => toggleProblemBlockId(current, id))
  }

  const toggleAdditionalRegion = (
    block: ProblemBlock,
    type: 'answer' | 'diagram',
  ) => {
    const enabled = Boolean(regionSelections[block.id]?.[type])
    setRegionSelections((current) => ({
      ...current,
      [block.id]: {
        answer: current[block.id]?.answer ?? null,
        diagram: current[block.id]?.diagram ?? null,
        [type]: enabled ? null : lowerHalf(block.rect),
      },
    }))
    if (!enabled) {
      setActiveId(block.id)
      setActiveRegionId(`${block.id}-${type}`)
    } else if (activeRegionId === `${block.id}-${type}`) {
      setActiveRegionId(block.id)
    }
  }

  const addBlock = () => {
    const id = createId()
    const next: ProblemBlock = {
      id,
      title: `手动题目块 ${blocks.length + 1}`,
      userTitle: `手动题目块 ${blocks.length + 1}`,
      rect: { x: 0.07, y: 0.08, width: 0.86, height: 0.16 },
      confidence: 1,
      lineIds: [],
      source: 'manual',
    }
    setBlocks((current) => [...current, next])
    setActiveId(id)
    setSelectedIds(new Set([id]))
    setSaveSelectedIds((current) => new Set(current).add(id))
  }

  const splitActiveBlock = () => {
    if (!activeBlock || activeBlock.rect.height < 0.06) return
    const gap = 0.004
    const halfHeight = activeBlock.rect.height / 2
    const wasSelectedForSave = saveSelectedIds.has(activeBlock.id)
    const top: ProblemBlock = {
      ...activeBlock,
      id: createId(),
      title: `${activeBlock.title} · 上`,
      userTitle: `${activeBlock.title} · 上`,
      rect: {
        ...activeBlock.rect,
        height: halfHeight - gap,
      },
      source: 'manual',
    }
    const bottom: ProblemBlock = {
      ...activeBlock,
      id: createId(),
      title: `${activeBlock.title} · 下`,
      userTitle: `${activeBlock.title} · 下`,
      rect: {
        ...activeBlock.rect,
        y: activeBlock.rect.y + halfHeight + gap,
        height: halfHeight - gap,
      },
      source: 'manual',
    }
    setBlocks((current) => [
      ...current.filter((block) => block.id !== activeBlock.id),
      top,
      bottom,
    ])
    setActiveId(top.id)
    setActiveRegionId(top.id)
    setSelectedIds(new Set([top.id, bottom.id]))
    setSaveSelectedIds((current) =>
      replaceProblemBlockSelection(
        current,
        new Set([activeBlock.id]),
        [top.id, bottom.id],
        wasSelectedForSave,
      ),
    )
  }

  const mergeSelectedBlocks = () => {
    if (selectedBlocks.length < 2) return
    const ordered = [...selectedBlocks].sort((a, b) => a.rect.y - b.rect.y)
    const inheritSaveSelection = selectedBlocks.every((block) =>
      saveSelectedIds.has(block.id),
    )
    const merged: ProblemBlock = {
      id: createId(),
      title: ordered[0].title.replace(/ · [上下]$/, ''),
      userTitle: ordered[0].title.replace(/ · [上下]$/, ''),
      rect: unionRect(selectedBlocks),
      confidence:
        selectedBlocks.reduce((sum, block) => sum + block.confidence, 0) /
        selectedBlocks.length,
      lineIds: [...new Set(selectedBlocks.flatMap((block) => block.lineIds))],
      source: 'manual',
    }
    setBlocks((current) => [
      ...current.filter((block) => !selectedIds.has(block.id)),
      merged,
    ])
    setActiveId(merged.id)
    setActiveRegionId(merged.id)
    setSelectedIds(new Set([merged.id]))
    setSaveSelectedIds((current) =>
      replaceProblemBlockSelection(
        current,
        selectedIds,
        [merged.id],
        inheritSaveSelection,
      ),
    )
  }

  const deleteSelectedBlocks = () => {
    if (!selectedIds.size && !activeId) return
    const ids = selectedIds.size ? selectedIds : new Set([activeId!])
    setBlocks((current) => current.filter((block) => !ids.has(block.id)))
    setSelectedIds(new Set())
    setSaveSelectedIds((current) =>
      replaceProblemBlockSelection(current, ids, [], false),
    )
    setActiveId(null)
    setActiveRegionId(null)
  }

  const saveBlocks = async () => {
    setSaving(true)
    dismiss()
    try {
      const problems = await saveProblems(
        document.id,
        correctedPath,
        blocks,
        saveSelectedBlocks.map((block) => block.id),
        regionSelections,
      )
      void runProblemAIWorker()
      const savedIds = new Set(problems.map((problem) => problem.id))
      const remainingBlocks = blocks.filter(
        (block) => !savedIds.has(block.id),
      )
      setBlocks(remainingBlocks)
      setSelectedIds((current) =>
        replaceProblemBlockSelection(current, savedIds, [], false),
      )
      setSaveSelectedIds((current) =>
        replaceProblemBlockSelection(current, savedIds, [], false),
      )
      setActiveId((current) =>
        current && !savedIds.has(current)
          ? current
          : (remainingBlocks[0]?.id ?? null),
      )
      setActiveRegionId((current) =>
        current && !savedIds.has(
          current.replace(/-(answer|diagram)$/, ''),
        )
          ? current
          : (remainingBlocks[0]?.id ?? null),
      )
      try {
        await onSaved()
      } catch (error) {
        notify(
          `保存成功，但页面状态刷新失败：${String(error)}。错题已写入本地错题库。`,
          'error',
        )
        return
      }
      notify(
        `保存成功：${problems.length} 道错题已写入本地错题库`,
        'success',
      )
    } catch (error) {
      notify(`错题保存失败：${String(error)}`, 'error')
    } finally {
      setSaving(false)
    }
  }

  const displayedPath =
    previewMode === 'corrected' && correctedPath
      ? correctedPath
      : document.originalImagePath

  return (
    <main className="workspace editor-workspace">
      <header className="editor-header">
        <button className="back-button" onClick={onBack} type="button">
          ‹ 返回采集
        </button>
        <div>
          <p className="eyebrow">页面处理</p>
          <h1>矫正与切题</h1>
        </div>
        <div className="editor-header-actions">
          <button
            className="secondary-action"
            disabled={processing || saving}
            onClick={() => void runProcessing(mode)}
            type="button"
          >
            <Icon name="refresh" size={16} />
            重新识别
          </button>
          <button
            className="primary-button"
            disabled={
              saving ||
              processing ||
              !correctedPath ||
              saveSelectedBlocks.length === 0
            }
            onClick={() => void saveBlocks()}
            type="button"
          >
            {saving
              ? '保存中…'
              : saveSelectedBlocks.length
                ? `保存 ${saveSelectedBlocks.length} 道错题`
                : '请选择要保存的题块'}
          </button>
        </div>
      </header>

      <section className="editor-layout">
        <div className="document-panel">
          <div className="document-toolbar">
            <div className="segmented-control">
              <button
                className={previewMode === 'corrected' ? 'active' : ''}
                disabled={!correctedPath}
                onClick={() => setPreviewMode('corrected')}
                type="button"
              >
                优化后
              </button>
              <button
                className={previewMode === 'original' ? 'active' : ''}
                onClick={() => setPreviewMode('original')}
                type="button"
              >
                原图
              </button>
            </div>
            <div className="segmented-control">
              <button
                className={mode === 'color' ? 'active' : ''}
                disabled={processing || saving}
                onClick={() => void runProcessing('color')}
                type="button"
              >
                保留色彩
              </button>
              <button
                className={mode === 'grayscale' ? 'active' : ''}
                disabled={processing || saving}
                onClick={() => void runProcessing('grayscale')}
                type="button"
              >
                文档灰度
              </button>
            </div>
            <span className="processing-summary">
              {processing
                ? '正在本机处理…'
                : pageDetected === null
                  ? '已加载上次结果'
                  : `${pageDetected ? '已矫正页面' : '使用原图边界'} · ${
                      durationMs ? `${(durationMs / 1000).toFixed(1)} 秒` : ''
                    }`}
            </span>
          </div>

          <CropSelectionCanvas
            alt="已处理试卷页面"
            className={processing ? 'processing' : ''}
            disabled={processing || saving}
            imagePath={displayedPath}
            onActivate={activateCanvasRegion}
            onRectChange={updateCanvasRect}
            regions={
              previewMode === 'corrected' && !processing
                ? blocks.flatMap((block, index) => {
                    const selection = regionSelections[block.id]
                    const overlays: Array<{
                      id: string
                      rect: NormalizedRect
                      label: string
                      active: boolean
                      selected: boolean
                      tone: 'question' | 'answer' | 'diagram'
                    }> = [
                      {
                        id: block.id,
                        rect: block.rect,
                        label: String(index + 1),
                        active: activeRegionId === block.id,
                        selected: selectedIds.has(block.id),
                        tone: 'question' as const,
                      },
                    ]
                    if (selection?.answer) {
                      overlays.push({
                        id: `${block.id}-answer`,
                        rect: selection.answer,
                        label: '作答',
                        active: activeRegionId === `${block.id}-answer`,
                        selected: true,
                        tone: 'answer' as const,
                      })
                    }
                    if (selection?.diagram) {
                      overlays.push({
                        id: `${block.id}-diagram`,
                        rect: selection.diagram,
                        label: '图形',
                        active: activeRegionId === `${block.id}-diagram`,
                        selected: true,
                        tone: 'diagram' as const,
                      })
                    }
                    return overlays
                  }).sort(
                    (left, right) => Number(left.active) - Number(right.active),
                  )
                : []
            }
          >
            {processing && (
              <div className="processing-overlay">
                <span className="spinner" />
                <strong>正在检测页面与题目</strong>
                <small>Vision OCR 完全在本机运行</small>
              </div>
            )}
          </CropSelectionCanvas>
        </div>

        <aside className="block-inspector">
          <div className="inspector-heading">
            <div>
              <p className="eyebrow">题目块</p>
              <h2>{blocks.length} 个候选</h2>
            </div>
            <button
              className="icon-button add-block"
              disabled={processing || saving}
              onClick={addBlock}
              type="button"
            >
              ＋
            </button>
          </div>

          <div className="block-actions">
            <button
              disabled={!activeBlock || processing || saving}
              onClick={splitActiveBlock}
              type="button"
            >
              上下拆分
            </button>
            <button
              disabled={selectedBlocks.length < 2 || processing || saving}
              onClick={mergeSelectedBlocks}
              type="button"
            >
              合并所选
            </button>
            <button
              className="danger"
              disabled={
                processing || saving || (!activeBlock && !selectedIds.size)
              }
              onClick={deleteSelectedBlocks}
              type="button"
            >
              删除
            </button>
          </div>

          <div className="save-selection-actions">
            <span>已收录 {saveSelectedBlocks.length} 个</span>
            <button
              disabled={processing || saving || !blocks.length}
              onClick={() => setSaveSelectedIds(allProblemBlockIds(blocks))}
              type="button"
            >
              全选
            </button>
            <button
              disabled={processing || saving || !saveSelectedIds.size}
              onClick={() => setSaveSelectedIds(new Set())}
              type="button"
            >
              全不选
            </button>
          </div>

          <div className="block-list">
            {blocks.map((block, index) => (
              <div
                className={`block-list-item ${
                  activeId === block.id ? 'active' : ''
                }`}
                key={block.id}
                onClick={() => setActiveId(block.id)}
              >
                <input
                  aria-label={`选择题目块 ${index + 1}`}
                  checked={selectedIds.has(block.id)}
                  disabled={processing || saving}
                  onChange={() => toggleSelection(block.id)}
                  onClick={(event) => event.stopPropagation()}
                  type="checkbox"
                />
                <span className="block-number">{index + 1}</span>
                <span className="block-copy">
                  <strong>{block.title}</strong>
                  <small>
                    {block.source === 'auto' ? '自动识别' : '手动调整'}
                  </small>
                </span>
                <label
                  className="save-selection-toggle"
                  onClick={(event) => event.stopPropagation()}
                >
                  <input
                    aria-label={`收录题目块 ${index + 1}`}
                    checked={saveSelectedIds.has(block.id)}
                    disabled={processing || saving}
                    onChange={() => toggleSaveSelection(block.id)}
                    type="checkbox"
                  />
                  <span>收录</span>
                </label>
                <div className="region-selection-options">
                  <label>
                    <input
                      aria-label={`用户作答区域 ${index + 1}`}
                      checked={Boolean(regionSelections[block.id]?.answer)}
                      disabled={processing || saving}
                      onChange={() => toggleAdditionalRegion(block, 'answer')}
                      type="checkbox"
                    />
                    <span className="region-dot answer" />
                    <span>作答</span>
                  </label>
                  <label>
                    <input
                      aria-label={`附加图片区域 ${index + 1}`}
                      checked={Boolean(regionSelections[block.id]?.diagram)}
                      disabled={processing || saving}
                      onChange={() => toggleAdditionalRegion(block, 'diagram')}
                      type="checkbox"
                    />
                    <span className="region-dot diagram" />
                    <span>图形</span>
                  </label>
                </div>
              </div>
            ))}
          </div>

          {activeBlock && (
            <div className="block-detail" />
          )}

          {warnings.length > 0 && (
            <div className="warning-list">
              {warnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </div>
          )}
        </aside>
      </section>

      <Toast toast={toast} />
    </main>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { Toast } from '../../components/Toast'
import { useToast } from '../../platform/useToast'
import { CropSelectionCanvas } from '../../components/CropSelectionCanvas'
import type {
  NormalizedRect,
  ProblemRegion,
  ProblemRegionType,
  SavedProblem,
} from '../../domain/models'
import { changedRegionTypes } from '../../domain/problemRegions'
import {
  getProblemRegions,
  replaceProblemRegions,
} from '../../platform/database'
import { mediaAssetUrl } from '../../platform/native'

type PreviewMode = 'corrected' | 'original'

function percent(value: number) {
  return `${Math.round(value * 1000) / 10}%`
}

function lowerHalf(rect: NormalizedRect): NormalizedRect {
  return {
    x: rect.x,
    y: rect.y + rect.height / 2,
    width: rect.width,
    height: rect.height / 2,
  }
}

export function ProblemCropEditor({
  onBack,
  onSaved,
  problem,
}: {
  onBack: () => void
  onSaved: (problem: SavedProblem, changes: ProblemRegionType[]) => void
  problem: SavedProblem
}) {
  const canEdit = Boolean(problem.correctedImagePath)
  const [previewMode, setPreviewMode] = useState<PreviewMode>(
    canEdit ? 'corrected' : 'original',
  )
  const [rect, setRect] = useState<NormalizedRect>(problem.cropRect)
  const [regions, setRegions] = useState<ProblemRegion[]>([])
  const [originalRegions, setOriginalRegions] = useState<ProblemRegion[]>([])
  const [activeRegionId, setActiveRegionId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const { toast, notify, dismiss } = useToast()

  useEffect(() => {
    if (!canEdit) {
      notify('优化后的完整页面不可用，暂时无法重新裁剪', 'info')
    }
  }, [canEdit, notify])

  useEffect(() => {
    let cancelled = false
    void getProblemRegions(problem.id).then((stored) => {
      if (cancelled) return
      const question = stored.find((region) => region.type === 'question')
      const nextQuestion = question ?? {
        id: `question-${problem.id}`,
        problemId: problem.id,
        type: 'question' as const,
        rect: problem.cropRect,
        imagePath: problem.cropImagePath,
        createdAt: problem.createdAt,
        updatedAt: problem.updatedAt,
      }
      const loadedRegions = [
        nextQuestion,
        ...stored.filter((region) => region.type !== 'question'),
      ]
      setRegions(loadedRegions)
      setOriginalRegions(loadedRegions)
      setRect(nextQuestion.rect)
      setActiveRegionId(nextQuestion.id)
    }).catch((error) => notify(`读取区域失败：${String(error)}`, 'error'))
    return () => {
      cancelled = true
    }
  }, [problem])

  const displayedPath =
    previewMode === 'corrected' && problem.correctedImagePath
      ? problem.correctedImagePath
      : problem.originalImagePath

  const save = async () => {
    setSaving(true)
    dismiss()
    try {
      const question = regions.find((region) => region.type === 'question')
      const nextRegions = [
        {
          ...(question ?? {
            id: `question-${problem.id}`,
            problemId: problem.id,
            type: 'question' as const,
            imagePath: null,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          }),
          rect,
        },
        ...regions.filter((region) => region.type !== 'question'),
      ]
      const changes = changedRegionTypes(originalRegions, nextRegions)
      onSaved(await replaceProblemRegions(problem.id, nextRegions), changes)
    } catch (error) {
      notify(`重新裁剪失败：${String(error)}`, 'error')
    } finally {
      setSaving(false)
    }
  }

  const hasAnswerRegion = regions.some((region) => region.type === 'answer')
  const hasDiagramRegion = regions.some((region) => region.type === 'diagram')
  const toggleRegion = (type: 'answer' | 'diagram') => {
    const existing = regions.filter((region) => region.type === type)
    if (existing.length) {
      const existingIds = new Set(existing.map((region) => region.id))
      setRegions((current) =>
        current.filter((region) => !existingIds.has(region.id)),
      )
      if (activeRegionId && existingIds.has(activeRegionId)) {
        setActiveRegionId(
          regions.find((region) => region.type === 'question')?.id ?? null,
        )
      }
      return
    }
    const id = `${type}-${problem.id}`
    setActiveRegionId(id)
    setRegions((current) => [
      ...current,
      {
        id,
        problemId: problem.id,
        type,
        rect: lowerHalf(rect),
        imagePath: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ])
  }

  const canvasRegions = useMemo(
    () =>
      previewMode === 'corrected' && canEdit
        ? regions.map((region) => ({
            id: region.id,
            rect: region.type === 'question' ? rect : region.rect,
            label:
              region.type === 'question'
                ? '题目'
                : region.type === 'answer'
                  ? '作答'
                  : region.type === 'diagram'
                    ? '图形'
                    : '注释',
            tone: region.type,
            active: region.id === activeRegionId,
            selected: true,
          })).sort(
            (left, right) => Number(left.active) - Number(right.active),
          )
        : [],
    [activeRegionId, canEdit, previewMode, rect, regions],
  )

  return (
    <main className="workspace editor-workspace problem-crop-workspace">
      <header className="editor-header">
        <button
          className="back-button"
          disabled={saving}
          onClick={onBack}
          type="button"
        >
          ‹ 返回错题详情
        </button>
        <div>
          <p className="eyebrow">图片区域</p>
          <h1>重新裁剪错题</h1>
        </div>
        <div className="editor-header-actions">
          <button
            className="secondary-action"
            disabled={saving}
            onClick={() => {
              setRect(problem.cropRect)
              setRegions((current) =>
                current.map((region) =>
                  region.type === 'question'
                    ? { ...region, rect: problem.cropRect }
                    : region,
                ),
              )
            }}
            type="button"
          >
            恢复原区域
          </button>
          <button
            className="primary-button"
            disabled={saving || !canEdit}
            onClick={() => void save()}
            type="button"
          >
            {saving ? '生成新裁图…' : '保存新裁图'}
          </button>
        </div>
      </header>

      <section className="editor-layout problem-crop-layout">
        <div className="document-panel">
          <div className="document-toolbar">
            <div className="segmented-control">
              <button
                className={previewMode === 'corrected' ? 'active' : ''}
                disabled={!canEdit}
                onClick={() => setPreviewMode('corrected')}
                type="button"
              >
                优化后 · 可编辑
              </button>
              <button
                className={previewMode === 'original' ? 'active' : ''}
                onClick={() => setPreviewMode('original')}
                type="button"
              >
                原图参考
              </button>
            </div>
            <span className="processing-summary">
              {previewMode === 'corrected'
                ? '拖动区域移动，拖动四角调整范围'
                : '原图仅供参考，不在此坐标系编辑'}
            </span>
          </div>

          <CropSelectionCanvas
            alt={
              previewMode === 'corrected'
                ? '优化后的完整页面'
                : '原始页面参考'
            }
            disabled={saving || previewMode !== 'corrected'}
            imagePath={displayedPath}
            onActivate={setActiveRegionId}
            onRectChange={(_id, nextRect) => {
              const changed = regions.find((region) => region.id === _id)
              if (changed?.type === 'question') setRect(nextRect)
              setRegions((current) =>
                current.map((region) =>
                  region.id === _id ? { ...region, rect: nextRect } : region,
                ),
              )
            }}
            regions={canvasRegions}
          />
        </div>

        <aside className="block-inspector crop-inspector">
          <div className="inspector-heading">
            <div>
              <p className="eyebrow">裁剪预览</p>
              <h2 title={problem.title}>{problem.title}</h2>
            </div>
          </div>

          <img
            alt="当前保存的错题图片"
            className="current-crop-preview"
            src={mediaAssetUrl(problem.cropImagePath)}
          />

          <div className="crop-region-toggles">
            <p className="eyebrow">附加区域</p>
            <label>
              <input
                checked={hasAnswerRegion}
                disabled={saving || !canEdit}
                onChange={() => toggleRegion('answer')}
                type="checkbox"
              />
              <span className="region-dot answer" />
              用户作答区域
            </label>
            <label>
              <input
                checked={hasDiagramRegion}
                disabled={saving || !canEdit}
                onChange={() => toggleRegion('diagram')}
                type="checkbox"
              />
              <span className="region-dot diagram" />
              附加图片区域
            </label>
            <small>新增区域默认位于题目框下半部，可在左侧移动和缩放。</small>
          </div>

          <dl className="crop-coordinate-list">
            <div>
              <dt>左侧</dt>
              <dd>{percent(rect.x)}</dd>
            </div>
            <div>
              <dt>顶部</dt>
              <dd>{percent(rect.y)}</dd>
            </div>
            <div>
              <dt>宽度</dt>
              <dd>{percent(rect.width)}</dd>
            </div>
            <div>
              <dt>高度</dt>
              <dd>{percent(rect.height)}</dd>
            </div>
          </dl>

          <div className="crop-safety-note">
            <strong>安全替换</strong>
            <p>
              新图片生成并写入成功后，才会切换当前错题；失败时旧裁图保持不变。
            </p>
          </div>
        </aside>
      </section>

      <Toast toast={toast} />
    </main>
  )
}

import { useCallback, useEffect, useState } from 'react'
import { Button, StatusBadge } from '../../components/ui'
import type { ReviewReplayPreview } from '../../domain/reviewReplay'
import { previewLearningState, rebuildLearningState } from '../../platform/reviewMaintenance'
import './LearningStateMaintenance.css'

function messageFor(preview: ReviewReplayPreview | null) {
  if (!preview) return '正在检查学习状态…'
  if (preview.status === 'empty') return '尚无可用于检查的复习记录'
  if (preview.status === 'consistent') return '学习状态正常'
  if (preview.status === 'legacy_partial') return '可核对的学习状态正常，较早记录保持原样'
  return `发现 ${preview.differences.length} 个学习状态需要修复`
}

export function LearningStateMaintenance() {
  const [preview, setPreview] = useState<ReviewReplayPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [repaired, setRepaired] = useState(false)

  const check = useCallback(async () => {
    setBusy(true); setError(null); setRepaired(false)
    try { setPreview(await previewLearningState()) }
    catch (reason) { setError(String(reason)) }
    finally { setBusy(false) }
  }, [])
  useEffect(() => { void check() }, [check])

  const rebuild = async () => {
    if (!window.confirm('将根据现有复习记录重新生成学习状态。错题、复习记录和今日计划不会被修改。是否继续？')) return
    setBusy(true); setError(null)
    try {
      const result = await rebuildLearningState()
      setPreview(result.after); setRepaired(true)
    } catch (reason) { setError(String(reason)) }
    finally { setBusy(false) }
  }

  const needsRepair = preview?.status === 'needs_rebuild'
  return <div className="learning-maintenance">
    <header><p className="eyebrow">数据维护</p><h2>检查学习状态</h2><p className="subtitle">使用已保存的复习记录核对掌握状态。检查不会修改任何数据。</p></header>
    <section className="learning-maintenance__status" aria-live="polite">
      <div>
        <StatusBadge tone={needsRepair ? 'warning' : error ? 'danger' : 'success'}>
          {needsRepair ? '需要处理' : error ? '检查失败' : '状态检查'}
        </StatusBadge>
        <h3>{error ?? messageFor(preview)}</h3>
        {preview && <p>已检查 {preview.events.length} 条复习记录、{preview.expected.length} 项可重建状态。</p>}
        {preview?.legacyKeys.length ? <p>{preview.legacyKeys.length} 项较早状态缺少完整历史，系统会保留原值，不会推测或覆盖。</p> : null}
        {repaired && <p className="learning-maintenance__success">已重新生成并再次验证，学习状态与复习记录一致。</p>}
      </div>
      <div className="learning-maintenance__actions">
        <Button disabled={busy} onClick={() => void check()} variant="secondary">{busy ? '检查中…' : '重新检查'}</Button>
        {needsRepair && <Button disabled={busy} onClick={() => void rebuild()} variant="primary">重新生成学习状态</Button>}
      </div>
    </section>
    {needsRepair && <details className="learning-maintenance__details">
      <summary>查看需要处理的项目</summary>
      <ul>{preview.differences.map((item) => <li key={`${item.kind}:${item.key}`}>{item.stateKind === 'skill' ? '能力状态' : '复习主题状态'} · {item.kind === 'missing' ? '缺失' : item.kind === 'extra' ? '多余' : '数值不一致'}</li>)}</ul>
    </details>}
  </div>
}

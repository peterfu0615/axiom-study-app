import { useCallback, useEffect, useState } from 'react'
import { AsyncState, Button, InlineNotice, Input, ListboxSelect, type Feedback } from '../../components/ui'
import { userFacingError } from '../../domain/userFacingError'
import type { ReviewSessionMode } from '../../domain/review'
import {
  DEFAULT_REVIEW_PREFERENCES,
  getReviewPreferences,
  reviewPaceFromTarget,
  saveReviewPreferences,
  targetRetentionForPace,
  type ReviewPace,
  type ReviewPreferences,
} from '../../platform/reviewPreferencesDatabase'

const modeOptions = [
  { value: 'quick', label: '快速复习' },
  { value: 'standard', label: '标准练习' },
  { value: 'mock_test', label: '模拟测试' },
]
const paceOptions = [
  { value: 'relaxed', label: '省时 · 50%' },
  { value: 'standard', label: '均衡 · 70%' },
  { value: 'intensive', label: '强化 · 85%' },
]

// Clamp numeric input immediately: Number('') is 0 and an emptied field used
// to persist an invalid value that only surfaced in later plan generation.
function parseBoundedNumber(raw: string, min: number, max: number, fallback: number) {
  const parsed = Number(raw)
  if (!raw.trim() || !Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.round(parsed)))
}

export function ReviewSettings() {
  const [value, setValue] = useState<ReviewPreferences>(DEFAULT_REVIEW_PREFERENCES)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<Feedback>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try { setValue(await getReviewPreferences()) }
    catch (reason) {
      console.warn('读取复习设置失败', reason)
      setError(userFacingError(reason, '未能读取复习设置。现有设置没有改变，请重新加载。'))
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load])

  const save = async () => {
    setSaving(true); setFeedback(null)
    try {
      setValue(await saveReviewPreferences(value))
      setFeedback({ tone: 'success', message: '复习设置已保存；今日安排和未来任务量已更新。' })
    } catch (reason) {
      console.warn('保存复习设置失败', reason)
      setFeedback({ tone: 'danger', message: userFacingError(reason, '复习设置没有保存，当前输入仍然保留。请重试。') })
    }
    finally { setSaving(false) }
  }

  return <div className="settings-appearance-pane review-settings-pane">
    <header>
      <p className="eyebrow">学习负担</p>
      <h2>今日复习设置</h2>
      <p className="subtitle">复习节奏控制任务出现的频率；今日上限和模块数控制一次安排的规模。</p>
    </header>
    <AsyncState error={error} loading={loading} loadingLabel="正在读取复习设置…" onRetry={load}>
    <div className="settings-form">
      <ListboxSelect
        disabled={saving}
        label="复习节奏"
        onValueChange={(pace) => setValue((current) => ({
          ...current,
          targetRetention: targetRetentionForPace(pace as ReviewPace),
        }))}
        options={paceOptions}
        value={reviewPaceFromTarget(value.targetRetention)}
      />
      <Input disabled={saving} label="今日复习上限（分钟）" max={180} min={5} onChange={(event) => setValue((current) => ({ ...current, maxDailyMinutes: parseBoundedNumber(event.target.value, 5, 180, current.maxDailyMinutes) }))} type="number" value={value.maxDailyMinutes} />
      <Input disabled={saving} label="每日最多复习模块" max={12} min={1} onChange={(event) => setValue((current) => ({ ...current, maxModules: parseBoundedNumber(event.target.value, 1, 12, current.maxModules) }))} type="number" value={value.maxModules} />
      <ListboxSelect
        disabled={saving}
        label="默认练习模式"
        onValueChange={(preferredMode) => setValue((current) => ({ ...current, preferredMode: preferredMode as ReviewSessionMode }))}
        options={modeOptions}
        value={value.preferredMode}
      />
    </div>
    <InlineNotice feedback={feedback} onClose={() => setFeedback(null)} />
    <div className="settings-save-row">
      <Button disabled={saving} loading={saving} onClick={() => void save()} variant="primary">保存复习设置</Button>
    </div>
    </AsyncState>
  </div>
}

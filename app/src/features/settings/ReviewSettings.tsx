import { useEffect, useState } from 'react'
import { Button, ListboxSelect } from '../../components/ui'
import type { ReviewSessionMode } from '../../domain/review'
import type { VariantGenerationMode } from '../../domain/practice'
import {
  DEFAULT_REVIEW_PREFERENCES,
  getReviewPreferences,
  saveReviewPreferences,
  type ReviewPreferences,
} from '../../platform/reviewPreferencesDatabase'

const modeOptions = [
  { value: 'quick', label: '快速复习' },
  { value: 'standard', label: '标准练习' },
  { value: 'mock_test', label: '模拟测试' },
]
const variantOptions = [
  { value: 'variant_preferred', label: '变式优先' },
  { value: 'original_only', label: '仅使用原题' },
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
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    void getReviewPreferences().then(setValue).catch(() => setMessage('读取复习设置失败。')).finally(() => setLoading(false))
  }, [])

  const save = async () => {
    setSaving(true); setMessage(null)
    try {
      setValue(await saveReviewPreferences(value))
      setMessage('复习设置已保存；保持率会立即用于实时预测。')
    } catch { setMessage('保存复习设置失败，请重试。') }
    finally { setSaving(false) }
  }

  return <div className="settings-appearance-pane review-settings-pane">
    <header>
      <p className="eyebrow">学习负担</p>
      <h2>Today 复习设置</h2>
      <p className="subtitle">保持率控制到期时间，模块数控制单次练习规模；每日硬容量与复习预留请在“计划”中设置。</p>
    </header>
    <div className="settings-form">
      <label>
        <span>目标保持率（%）</span>
        <input disabled={loading || saving} max={95} min={75} onChange={(event) => setValue((current) => ({ ...current, targetRetention: parseBoundedNumber(event.target.value, 75, 95, current.targetRetention * 100) / 100 }))} type="number" value={Math.round(value.targetRetention * 100)} />
      </label>
      <label>
        <span>每日最多复习模块</span>
        <input disabled={loading || saving} max={12} min={1} onChange={(event) => setValue((current) => ({ ...current, maxModules: parseBoundedNumber(event.target.value, 1, 12, current.maxModules) }))} type="number" value={value.maxModules} />
      </label>
      <ListboxSelect
        disabled={loading || saving}
        label="默认练习模式"
        onValueChange={(preferredMode) => setValue((current) => ({ ...current, preferredMode: preferredMode as ReviewSessionMode }))}
        options={modeOptions}
        value={value.preferredMode}
      />
      <ListboxSelect
        disabled={loading || saving}
        label="默认题目来源"
        onValueChange={(variantMode) => setValue((current) => ({ ...current, variantMode: variantMode as VariantGenerationMode }))}
        options={variantOptions}
        value={value.variantMode}
      />
    </div>
    <div className="settings-save-row">
      <span role="status">{message}</span>
      <Button disabled={loading || saving} loading={saving} onClick={() => void save()} variant="primary">保存复习设置</Button>
    </div>
  </div>
}

import { useEffect, useMemo, useState } from 'react'
import { configureAIProviders } from '../../ai/provider'
import { useTheme, type Appearance } from '../../platform/theme'
import { getAppVersion } from '../../platform/native'
import type {
  AIProviderKind,
  AIProviderProfile,
  AIProviderTaskType,
} from '../../domain/models'
import {
  deleteAIProviderProfileApiKey,
  listAIProviderProfiles,
  saveAIProviderProfiles,
} from '../../platform/database'
import { ListboxSelect, PageHeader, Tabs } from '../../components/ui'
import { UpdateSettings } from './UpdateSettings'
import { LearningStateMaintenance } from './LearningStateMaintenance'
import { ReviewSettings } from './ReviewSettings'

type SettingsTab = 'providers' | 'review' | 'appearance' | 'maintenance' | 'about' | 'update'
type SettingsMessage = { text: string; tone: 'success' | 'error' }

function readableError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

function newProvider(index: number): AIProviderProfile {
  const now = Date.now()
  return {
    id: crypto.randomUUID(),
    name: `OpenAI Compatible ${index}`,
    provider: 'openai_compatible',
    baseUrl: '',
    apiKey: '',
    hasApiKey: false,
    apiKeySuffix: '',
    credentialRef: '',
    commandPath: '',
    model: '',
    inputCostPerMillionUsd: null,
    outputCostPerMillionUsd: null,
    supportsVision: true,
    supportsText: true,
    taskTypes: [],
    enabled: false,
    sortOrder: index,
    createdAt: now,
    updatedAt: now,
  }
}

function providerSubtitle(profile: AIProviderProfile): string {
  if (profile.provider === 'mock') return '模拟服务'
  if (profile.provider === 'antigravity_cli') return 'Gemini · Antigravity CLI'
  return profile.baseUrl || 'OpenAI Compatible'
}

const APPEARANCE_OPTIONS: Array<{ value: Appearance; label: string; description: string }> = [
  { value: 'light', label: '浅色', description: '始终使用浅色外观' },
  { value: 'dark', label: '深色', description: '始终使用深色外观' },
  { value: 'system', label: '跟随系统', description: '随系统设置自动切换' },
]

const PROVIDER_TASK_OPTIONS: Array<{ value: AIProviderTaskType; label: string }> = [
  { value: 'problem_understanding', label: '题目理解' },
  { value: 'solution_generation', label: '正解生成' },
  { value: 'attempt_analysis', label: '作答与错因分析' },
  { value: 'tag_mapping', label: '标签映射' },
  { value: 'variant_generation', label: '变式生成' },
  { value: 'variant_verification', label: '变式独立验证' },
  { value: 'submission_grading', label: '练习批改' },
  { value: 'explain_selection', label: '局部解释' },
  { value: 'textbook_recognition', label: '教材识别' },
  { value: 'curriculum_analysis', label: '课程分析' },
  { value: 'geometry_scene', label: '几何图重建（实验）' },
]

export function AISettings() {
  const { appearance, resolvedAppearance, visualTheme, setAppearance } = useTheme()
  const [profiles, setProfiles] = useState<AIProviderProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<SettingsMessage | null>(null)
  const [tab, setTab] = useState<SettingsTab>('providers')
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(
    null,
  )
  const [appVersion, setAppVersion] = useState('…')

  useEffect(() => {
    void listAIProviderProfiles()
      .then((next) => {
        setProfiles(next)
        setSelectedProviderId(next[0]?.id ?? null)
      })
      .catch((error) => setMessage({ text: `读取设置失败：${readableError(error)}`, tone: 'error' }))
      .finally(() => setLoading(false))
    void getAppVersion()
      .then(setAppVersion)
      .catch(() => setAppVersion('未知'))
  }, [])

  const update = (
    id: string,
    values: Partial<AIProviderProfile>,
  ) => {
    setProfiles((current) =>
      current.map((profile) =>
        profile.id === id ? { ...profile, ...values } : profile,
      ),
    )
  }

  const moveBy = (id: string, delta: -1 | 1) => {
    setProfiles((current) => {
      const index = current.findIndex((p) => p.id === id)
      if (index < 0) return current
      const target = index + delta
      if (target < 0 || target >= current.length) return current
      const next = [...current]
      const [moved] = next.splice(index, 1)
      next.splice(target, 0, moved)
      return next.map((profile, sortOrder) => ({ ...profile, sortOrder }))
    })
  }

  const save = async () => {
    setSaving(true)
    setMessage(null)
    try {
      const saved = await saveAIProviderProfiles(profiles)
      configureAIProviders(saved)
      setProfiles(saved)
      setMessage({ text: 'AI 服务设置已保存并立即生效', tone: 'success' })
      window.setTimeout(() => setMessage(null), 3200)
    } catch (error) {
      setMessage({ text: `保存失败：${readableError(error)}`, tone: 'error' })
    } finally {
      setSaving(false)
    }
  }

  const addProvider = () => {
    const created = newProvider(profiles.length + 1)
    setProfiles((current) => [...current, created])
    setSelectedProviderId(created.id)
  }

  const removeProvider = (id: string) => {
    setProfiles((current) => {
      const next = current.filter((item) => item.id !== id)
      if (selectedProviderId === id) {
        setSelectedProviderId(next[0]?.id ?? null)
      }
      return next
    })
  }

  const deleteApiKey = async (profile: AIProviderProfile) => {
    setSaving(true)
    setMessage(null)
    try {
      const saved = await deleteAIProviderProfileApiKey(profile.id)
      configureAIProviders(saved)
      setProfiles(saved)
      setMessage({ text: `已删除“${profile.name}”的 API Key`, tone: 'success' })
    } catch (error) {
      setMessage({ text: `删除 API Key 失败：${readableError(error)}`, tone: 'error' })
    } finally {
      setSaving(false)
    }
  }

  const enabledVisionCount = useMemo(
    () =>
      profiles.filter(
        (profile) => profile.enabled && profile.supportsVision,
      ).length,
    [profiles],
  )

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === selectedProviderId) ?? null,
    [profiles, selectedProviderId],
  )

  const toggleProviderTask = (profile: AIProviderProfile, taskType: AIProviderTaskType) => {
    const current = profile.taskTypes ?? []
    update(profile.id, {
      taskTypes: current.includes(taskType)
        ? current.filter((candidate) => candidate !== taskType)
        : [...current, taskType],
    })
  }

  return (
    <main className="workspace settings-workspace">
      <PageHeader
        actions={<span className="settings-provider-badge">
          {enabledVisionCount} 个图片识别服务可用
        </span>}
        eyebrow="Axiom"
        summary="AI 服务、外观与应用信息"
        title="设置"
      />

      <section className="settings-shell">
        <nav className="settings-tabs">
          <Tabs
            ariaLabel="设置分区"
            onChange={setTab}
            options={[
              { value: 'maintenance', label: '数据维护', icon: 'refresh' },
              { value: 'providers', label: 'AI 模型', icon: 'ai' },
              { value: 'review', label: '复习设置', icon: 'today' },
              { value: 'appearance', label: '外观', icon: 'sun' },
              { value: 'about', label: '关于', icon: 'info' },
              { value: 'update', label: '更新', icon: 'download' },
            ]}
            value={tab}
            variant="rail"
          />
        </nav>

        <div className="settings-pane">
          {tab === 'providers' ? (
            <div className="settings-providers-layout">
              <aside className="provider-nav">
                <div className="provider-nav-heading">
                  <strong>拖动排序</strong>
                  <button
                    className="secondary-action"
                    disabled={loading || saving}
                    onClick={addProvider}
                    type="button"
                  >
                    添加
                  </button>
                </div>
                <div className="provider-nav-list">
                  {profiles.length ? (
                    profiles.map((profile, index) => (
                      <div
                        className={`provider-nav-item ${
                          selectedProviderId === profile.id ? 'active' : ''
                        }`}
                        key={profile.id}
                        onClick={() => setSelectedProviderId(profile.id)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            setSelectedProviderId(profile.id)
                          }
                        }}
                      >
                        <span className="provider-nav-index">
                          {index + 1}
                        </span>
                        <span className="provider-nav-copy">
                          <strong>{profile.name || '未命名服务'}</strong>
                          <small>{providerSubtitle(profile)}</small>
                          <span className="provider-nav-tags">
                            {profile.enabled ? (
                              <span className="provider-tag enabled">启用</span>
                            ) : (
                              <span className="provider-tag">停用</span>
                            )}
                            {profile.supportsVision && (
                              <span className="provider-tag">图片</span>
                            )}
                            {profile.supportsText && (
                              <span className="provider-tag">文本</span>
                            )}
                          </span>
                        </span>
                        <span className="provider-nav-reorder" role="group" aria-label="调整顺序">
                          <button
                            className="provider-nav-arrow"
                            disabled={index === 0 || saving}
                            onClick={(event) => {
                              event.stopPropagation()
                              moveBy(profile.id, -1)
                            }}
                            title="上移（提高优先级）"
                            type="button"
                            aria-label="上移"
                          >
                            ▲
                          </button>
                          <button
                            className="provider-nav-arrow"
                            disabled={index === profiles.length - 1 || saving}
                            onClick={(event) => {
                              event.stopPropagation()
                              moveBy(profile.id, 1)
                            }}
                            title="下移（降低优先级）"
                            type="button"
                            aria-label="下移"
                          >
                            ▼
                          </button>
                        </span>
                      </div>
                    ))
                  ) : (
                    <div className="provider-nav-empty">
                      {loading ? '读取中…' : '尚未配置 AI 服务'}
                    </div>
                  )}
                </div>
              </aside>

              <article className="provider-detail">
                {selectedProfile ? (
                  <>
                    <header className="provider-detail-header">
                      <div>
                        <p className="eyebrow">AI 服务</p>
                        <h2>
                          {selectedProfile.name || '未命名服务'}
                        </h2>
                        <p className="provider-detail-subtitle">
                          {providerSubtitle(selectedProfile)}
                        </p>
                      </div>
                      <div className="provider-detail-actions">
                        <button
                          className="secondary-action"
                          disabled={saving}
                          onClick={() => removeProvider(selectedProfile.id)}
                          type="button"
                        >
                          移除
                        </button>
                      </div>
                    </header>

                    <div className="provider-detail-body">
                      <div className="settings-form">
                        <label>
                          <span>名称</span>
                          <input
                            disabled={saving}
                            onChange={(event) =>
                              update(selectedProfile.id, {
                                name: event.target.value,
                              })
                            }
                            value={selectedProfile.name}
                          />
                        </label>
                        <ListboxSelect
                          disabled={saving || selectedProfile.provider === 'mock'}
                          label="服务类型"
                          onValueChange={(value) => update(selectedProfile.id, { provider: value as AIProviderKind })}
                          options={[
                            { value: 'mock', label: '模拟服务' },
                            { value: 'openai_compatible', label: 'OpenAI Compatible' },
                            { value: 'antigravity_cli', label: 'Gemini (Antigravity CLI)' },
                          ]}
                          value={selectedProfile.provider}
                        />
                        {selectedProfile.provider === 'openai_compatible' && (
                          <label>
                            <span>Base URL</span>
                            <input
                              disabled={saving}
                              onChange={(event) =>
                                update(selectedProfile.id, {
                                  baseUrl: event.target.value,
                                })
                              }
                              placeholder="https://api.example.com/v1"
                              value={selectedProfile.baseUrl}
                            />
                          </label>
                        )}
                        {selectedProfile.provider === 'antigravity_cli' && (
                          <label>
                            <span>Antigravity CLI 路径</span>
                            <input
                              disabled={saving}
                              onChange={(event) =>
                                update(selectedProfile.id, {
                                  commandPath: event.target.value,
                                })
                              }
                              placeholder="agy 或 /Users/you/.local/bin/agy"
                              value={selectedProfile.commandPath}
                            />
                          </label>
                        )}
                        <label>
                          <span>模型</span>
                          <input
                            disabled={saving || selectedProfile.provider === 'mock'}
                            onChange={(event) =>
                              update(selectedProfile.id, {
                                model: event.target.value,
                              })
                            }
                            placeholder={
                              selectedProfile.provider === 'antigravity_cli'
                                ? '例如 gemini-3.6-flash-high'
                                : '例如 qwen-vl-max'
                            }
                            value={selectedProfile.model}
                          />
                        </label>
                        {selectedProfile.provider === 'openai_compatible' && (
                          <div className="provider-pricing-fields">
                            <label>
                              <span>输入单价 <small>USD / 100 万 tokens</small></span>
                              <input
                                disabled={saving}
                                inputMode="decimal"
                                min="0"
                                onChange={(event) => update(selectedProfile.id, {
                                  inputCostPerMillionUsd: event.target.value === ''
                                    ? null
                                    : Number(event.target.value),
                                })}
                                placeholder="未配置"
                                step="0.000001"
                                type="number"
                                value={selectedProfile.inputCostPerMillionUsd ?? ''}
                              />
                            </label>
                            <label>
                              <span>输出单价 <small>USD / 100 万 tokens</small></span>
                              <input
                                disabled={saving}
                                inputMode="decimal"
                                min="0"
                                onChange={(event) => update(selectedProfile.id, {
                                  outputCostPerMillionUsd: event.target.value === ''
                                    ? null
                                    : Number(event.target.value),
                                })}
                                placeholder="未配置"
                                step="0.000001"
                                type="number"
                                value={selectedProfile.outputCostPerMillionUsd ?? ''}
                              />
                            </label>
                          </div>
                        )}
                        {selectedProfile.provider === 'openai_compatible' && (
                          <>
                            <label className="provider-api-key-field">
                              <span>
                                API Key
                                <small>
                                  {selectedProfile.hasApiKey
                                    ? `已保存 · sk-••••••••${selectedProfile.apiKeySuffix}`
                                    : '未保存'}
                                </small>
                              </span>
                              <input
                                autoComplete="off"
                                disabled={saving}
                                onChange={(event) =>
                                  update(selectedProfile.id, {
                                    apiKey: event.target.value,
                                  })
                                }
                                placeholder={
                                  selectedProfile.hasApiKey
                                    ? '不填写则保留已保存 Key'
                                    : '输入 API Key'
                                }
                                type="password"
                                value={selectedProfile.apiKey}
                              />
                            </label>
                            {selectedProfile.hasApiKey && (
                              <button
                                className="secondary-action"
                                disabled={saving}
                                onClick={() => void deleteApiKey(selectedProfile)}
                                type="button"
                              >
                                删除 API Key
                              </button>
                            )}
                          </>
                        )}
                      </div>

                      <div className="provider-capabilities">
                        <label>
                          <input
                            checked={selectedProfile.enabled}
                            disabled={saving}
                            onChange={(event) =>
                              update(selectedProfile.id, {
                                enabled: event.target.checked,
                              })
                            }
                            type="checkbox"
                          />
                          启用
                        </label>
                        <label>
                          <input
                            checked={selectedProfile.supportsVision}
                            disabled={saving || selectedProfile.provider === 'mock'}
                            onChange={(event) =>
                              update(selectedProfile.id, {
                                supportsVision: event.target.checked,
                              })
                            }
                            type="checkbox"
                          />
                          支持图片识别
                        </label>
                        <label>
                          <input
                            checked={selectedProfile.supportsText}
                            disabled={saving || selectedProfile.provider === 'mock'}
                            onChange={(event) =>
                              update(selectedProfile.id, {
                                supportsText: event.target.checked,
                              })
                            }
                            type="checkbox"
                          />
                          支持文本与推理
                        </label>
                      </div>
                      <fieldset className="provider-task-routing">
                        <legend>任务路由</legend>
                        <p>不勾选表示承担所有能力兼容的任务；勾选后只承担选中的任务，失败时按服务顺序回退。</p>
                        <div className="provider-task-routing__grid">
                          {PROVIDER_TASK_OPTIONS.map((option) => (
                            <label key={option.value}>
                              <input
                                checked={(selectedProfile.taskTypes ?? []).includes(option.value)}
                                disabled={saving}
                                onChange={() => toggleProviderTask(selectedProfile, option.value)}
                                type="checkbox"
                              />
                              {option.label}
                            </label>
                          ))}
                        </div>
                      </fieldset>
                    </div>
                  </>
                ) : (
                  <div className="provider-detail-empty">
                    <strong>选择左侧的 AI 服务查看详情</strong>
                    <p>或点击“添加”配置新的 AI 服务。</p>
                  </div>
                )}
              </article>
            </div>
          ) : tab === 'review' ? (
            <ReviewSettings />
          ) : tab === 'appearance' ? (
            <div className="settings-appearance-pane">
              <header>
                <p className="eyebrow">显示偏好</p>
                <h2>外观</h2>
                <p className="subtitle">Axiom 主题会按系统或你的选择切换明暗外观。</p>
              </header>
              <div className="appearance-options">
                {APPEARANCE_OPTIONS.map((option) => (
                  <button
                    className={`appearance-option ${
                      appearance === option.value ? 'active' : ''
                    }`}
                    key={option.value}
                    onClick={() => setAppearance(option.value)}
                    type="button"
                  >
                    <div className="appearance-option-swatch">
                      <span
                        className={`swatch swatch-${option.value}`}
                        aria-hidden="true"
                      />
                    </div>
                    <div className="appearance-option-copy">
                      <strong>{option.label}</strong>
                      <small>{option.description}</small>
                      {appearance === option.value && (
                        <span className="appearance-current">当前</span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
              <p className="appearance-resolved-hint">
                当前实际显示：
                <strong>{resolvedAppearance === 'dark' ? '深色' : '浅色'}</strong>
                <span> · Axiom {visualTheme === 'axiom' ? '默认主题' : visualTheme}</span>
              </p>
            </div>
          ) : tab === 'maintenance' ? (
            <LearningStateMaintenance />
          ) : tab === 'about' ? (
            <div className="settings-about-pane">
              <header>
                <p className="eyebrow">应用信息</p>
                <h2>Axiom</h2>
                <p className="subtitle">智能错题整理工作台</p>
              </header>
              <dl className="settings-about-facts">
                <div>
                  <dt>版本</dt>
                  <dd>{appVersion}</dd>
                </div>
                <div>
                  <dt>数据存储</dt>
                  <dd>本机 SQLite · 媒体文件保存在应用数据目录</dd>
                </div>
                <div>
                  <dt>AI 处理</dt>
                  <dd>支持 OpenAI Compatible 与 Antigravity CLI 双通道</dd>
                </div>
              </dl>
            </div>
          ) : (
            <UpdateSettings />
          )}

          {tab === 'providers' && (
            <div className="settings-save-row">
              <span className={message?.tone === 'error' ? 'is-error' : ''} role={message?.tone === 'error' ? 'alert' : 'status'}>{message?.text}</span>
              <button
                className="primary-button"
                disabled={loading || saving}
                onClick={() => void save()}
                type="button"
              >
                {saving ? '保存中…' : '保存设置'}
              </button>
            </div>
          )}
        </div>
      </section>
    </main>
  )
}

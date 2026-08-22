import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { configureAIProviders } from '../../ai/provider'
import { useTheme, type Appearance } from '../../platform/theme'
import { VISUAL_THEME_LABELS, VISUAL_THEME_SWATCHES, VISUAL_THEMES } from '../../platform/themeModel'
import { getAppVersion } from '../../platform/native'
import type {
  AIProviderKind,
  AIProviderProfile,
} from '../../domain/models'
import {
  deleteAIProviderProfileApiKey,
  listAIProviderProfiles,
  saveAIProviderProfiles,
} from '../../platform/database'
import { ListboxSelect, Button, Dialog, PageHeader, Tabs } from '../../components/ui'
import { registerUnsavedGuard, unregisterUnsavedGuard } from '../../platform/unsavedGuard'
import { UpdateSettings } from './UpdateSettings'
import { LearningStateMaintenance } from './LearningStateMaintenance'
import { ReviewSettings } from './ReviewSettings'
import { Icon } from '../../components/Icon'

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

export function AISettings() {
  const { appearance, resolvedAppearance, visualTheme, setAppearance, setVisualTheme } = useTheme()
  const [profiles, setProfiles] = useState<AIProviderProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<SettingsMessage | null>(null)
  const [tab, setTab] = useState<SettingsTab>('providers')
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(
    null,
  )
  const [appVersion, setAppVersion] = useState('…')
  const [providerRemoveConfirming, setProviderRemoveConfirming] = useState(false)
  const [apiKeyDeleteTarget, setApiKeyDeleteTarget] = useState<AIProviderProfile | null>(null)
  const messageTimerRef = useRef<number | null>(null)
  // Snapshot of the last loaded/saved profiles; differences mean unsaved work.
  const [savedProfilesJson, setSavedProfilesJson] = useState<string | null>(null)
  const isDirty = savedProfilesJson !== null && savedProfilesJson !== JSON.stringify(profiles)
  const isDirtyRef = useRef(false)
  isDirtyRef.current = isDirty

  useEffect(() => {
    let cancelled = false
    void listAIProviderProfiles()
      .then((next) => {
        if (cancelled) return
        setProfiles(next)
        setSavedProfilesJson(JSON.stringify(next))
        setSelectedProviderId(next[0]?.id ?? null)
      })
      .catch((error) => { if (!cancelled) setMessage({ text: `读取设置失败：${readableError(error)}`, tone: 'error' }) })
      .finally(() => { if (!cancelled) setLoading(false) })
    void getAppVersion()
      .then((version) => { if (!cancelled) setAppVersion(version) })
      .catch(() => { if (!cancelled) setAppVersion('未知') })
    return () => { cancelled = true }
  }, [])

  // Auto-dismiss the transient message; tracked so a second save does not
  // inherit a stale timer and so unmount never fires a late setState.
  const scheduleMessageClear = useCallback(() => {
    if (messageTimerRef.current !== null) window.clearTimeout(messageTimerRef.current)
    messageTimerRef.current = window.setTimeout(() => {
      messageTimerRef.current = null
      setMessage(null)
    }, 3200)
  }, [])
  useEffect(() => () => {
    if (messageTimerRef.current !== null) window.clearTimeout(messageTimerRef.current)
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

  // 自动保存：配置变更后短防抖落库，页面不提供保存按钮。
  // 列表中的服务始终启用、始终支持文本；「多模态」勾选只控制 supportsVision；
  // 按任务分流已移除，服务列表顺序即失败回退的优先级。
  const [autoSaveState, setAutoSaveState] = useState<'idle' | 'pending' | 'saving' | 'saved' | 'error'>('idle')
  const autoSaveTimerRef = useRef<number | null>(null)
  const autoSaveResetTimerRef = useRef<number | null>(null)
  const autoSaveInFlightRef = useRef(false)
  const autoSavePendingRef = useRef(false)
  const profilesRef = useRef(profiles)
  profilesRef.current = profiles

  const persistProfiles = useCallback(async () => {
    if (autoSaveInFlightRef.current) {
      autoSavePendingRef.current = true
      return
    }
    autoSaveInFlightRef.current = true
    setAutoSaveState('saving')
    try {
      const payload = profilesRef.current.map((profile) => ({
        ...profile,
        enabled: true,
        supportsText: true,
        taskTypes: [] as AIProviderProfile['taskTypes'],
      }))
      const saved = await saveAIProviderProfiles(payload)
      configureAIProviders(saved)
      setProfiles(saved)
      setSavedProfilesJson(JSON.stringify(saved))
      setAutoSaveState('saved')
      if (autoSaveResetTimerRef.current !== null) window.clearTimeout(autoSaveResetTimerRef.current)
      autoSaveResetTimerRef.current = window.setTimeout(() => {
        autoSaveResetTimerRef.current = null
        setAutoSaveState((current) => current === 'saved' ? 'idle' : current)
      }, 3200)
    } catch (error) {
      setMessage({ text: `自动保存失败：${readableError(error)}`, tone: 'error' })
      setAutoSaveState('error')
    } finally {
      autoSaveInFlightRef.current = false
      if (autoSavePendingRef.current) {
        autoSavePendingRef.current = false
        void persistProfiles()
      }
    }
  }, [])

  useEffect(() => {
    // 初始加载完成前（基线为空）与保存回写（基线等于当前）都不触发。
    if (savedProfilesJson === null) return
    if (savedProfilesJson === JSON.stringify(profiles)) return
    if (autoSaveTimerRef.current !== null) window.clearTimeout(autoSaveTimerRef.current)
    setAutoSaveState((current) => current === 'saving' ? current : 'pending')
    autoSaveTimerRef.current = window.setTimeout(() => {
      autoSaveTimerRef.current = null
      void persistProfiles()
    }, 800)
  }, [profiles, savedProfilesJson, persistProfiles])

  useEffect(() => () => {
    if (autoSaveTimerRef.current !== null) window.clearTimeout(autoSaveTimerRef.current)
    if (autoSaveResetTimerRef.current !== null) window.clearTimeout(autoSaveResetTimerRef.current)
  }, [])

  // Tell the app shell when this page holds unsaved changes so switching
  // sections can ask for confirmation instead of silently discarding them.
  useEffect(() => {
    registerUnsavedGuard('ai-settings', { isDirty: () => isDirtyRef.current })
    return () => unregisterUnsavedGuard('ai-settings')
  }, [])

  const addProvider = () => {
    const created = newProvider(profiles.length + 1)
    setProfiles((current) => [...current, created])
    setSelectedProviderId(created.id)
  }

  const removeProvider = (id: string) => {
    // Keep the state updater pure: derive the next selection outside of it.
    const next = profiles.filter((item) => item.id !== id)
    setProfiles(next)
    if (selectedProviderId === id) {
      setSelectedProviderId(next[0]?.id ?? null)
    }
  }

  const deleteApiKey = async (profile: AIProviderProfile) => {
    setSaving(true)
    setMessage(null)
    try {
      const saved = await deleteAIProviderProfileApiKey(profile.id)
      configureAIProviders(saved)
      setProfiles(saved)
      setSavedProfilesJson(JSON.stringify(saved))
      setMessage({ text: `已删除“${profile.name}”的 API Key`, tone: 'success' })
      scheduleMessageClear()
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
            className="settings-nav"
          />
        </nav>

        <div className="settings-pane">
          {tab === 'providers' ? (
            <div className="settings-providers-layout">
              <aside className="provider-nav">
                <div className="provider-nav-heading">
                  <strong>回退顺序</strong>
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
                            {profile.supportsVision && (
                              <span className="provider-tag">多模态</span>
                            )}
                          </span>
                        </span>
                        <span className="provider-nav-reorder" role="group" aria-label="调整顺序">
                          <button
                            className="provider-nav-arrow"
                            disabled={index === 0}
                            onClick={(event) => {
                              event.stopPropagation()
                              moveBy(profile.id, -1)
                            }}
                            title="上移（提高优先级）"
                            type="button"
                            aria-label="上移"
                          >
                            <Icon name="arrow-up" size={14} />
                          </button>
                          <button
                            className="provider-nav-arrow"
                            disabled={index === profiles.length - 1}
                            onClick={(event) => {
                              event.stopPropagation()
                              moveBy(profile.id, 1)
                            }}
                            title="下移（降低优先级）"
                            type="button"
                            aria-label="下移"
                          >
                            <Icon name="arrow-down" size={14} />
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
                                                    onClick={() => setProviderRemoveConfirming(true)}
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
                                                        onChange={(event) =>
                              update(selectedProfile.id, {
                                name: event.target.value,
                              })
                            }
                            value={selectedProfile.name}
                          />
                        </label>
                        <ListboxSelect
                          disabled={selectedProfile.provider === 'mock'}
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
                            disabled={selectedProfile.provider === 'mock'}
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
                                                                onClick={() => setApiKeyDeleteTarget(selectedProfile)}
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
                            checked={selectedProfile.supportsVision}
                            disabled={selectedProfile.provider === 'mock'}
                            onChange={(event) =>
                              update(selectedProfile.id, {
                                supportsVision: event.target.checked,
                              })
                            }
                            type="checkbox"
                          />
                          多模态（支持图片识别）
                        </label>
                      </div>
                      <p className="provider-capabilities__hint">
                        所有服务始终参与全部任务，按左侧顺序作为失败回退的优先级。
                      </p>
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
              <section className="color-theme-picker" aria-label="颜色主题">
                <p className="eyebrow">颜色主题</p>
                <p className="subtitle">同一布局下的六套品牌配色；明暗外观与颜色主题可独立组合。</p>
                <div className="color-theme-picker__grid" role="radiogroup" aria-label="选择颜色主题">
                  {VISUAL_THEMES.map((theme) => (
                    <button
                      aria-checked={visualTheme === theme}
                      className={`color-theme-card${visualTheme === theme ? ' active' : ''}`}
                      key={theme}
                      onClick={() => setVisualTheme(theme)}
                      role="radio"
                      type="button"
                    >
                      <span
                        aria-hidden="true"
                        className="color-theme-card__swatch"
                        style={{ background: VISUAL_THEME_SWATCHES[theme] }}
                      />
                      <span className="color-theme-card__copy">
                        <strong>{VISUAL_THEME_LABELS[theme]}</strong>
                        {visualTheme === theme && <span className="appearance-current">当前</span>}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
              <p className="appearance-resolved-hint">
                当前实际显示：
                <strong>{resolvedAppearance === 'dark' ? '深色' : '浅色'}</strong>
                <span> · {VISUAL_THEME_LABELS[visualTheme]}主题</span>
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
            <div className="provider-status-bar">
              <span
                aria-live="polite"
                className={`provider-status-bar__state${autoSaveState === 'error' || message?.tone === 'error' ? ' is-error' : ''}`}
                role={message?.tone === 'error' ? 'alert' : 'status'}
              >
                {message?.text
                  ?? (autoSaveState === 'saving' ? '正在保存…'
                    : autoSaveState === 'pending' ? '有未保存的修改…'
                    : autoSaveState === 'saved' ? '已自动保存'
                    : autoSaveState === 'error' ? '保存失败，修改后会自动重试'
                    : null)}
              </span>
            </div>
          )}
        </div>
      </section>

      <Dialog onClose={() => setProviderRemoveConfirming(false)} open={providerRemoveConfirming && Boolean(selectedProfile)} title="移除 AI 服务">
        <p>将移除「{selectedProfile?.name || '未命名服务'}」及其 API Key。未保存的修改会一并丢弃。</p>
        <p>确认移除？</p>
        <div className="settings-confirm-actions">
          <Button onClick={() => setProviderRemoveConfirming(false)} variant="ghost">取消</Button>
          <Button
            onClick={() => {
              if (selectedProfile) removeProvider(selectedProfile.id)
              setProviderRemoveConfirming(false)
            }}
            variant="danger"
          >
            确认移除
          </Button>
        </div>
      </Dialog>

      <Dialog onClose={() => setApiKeyDeleteTarget(null)} open={Boolean(apiKeyDeleteTarget)} title="删除 API Key">
        <p>将删除「{apiKeyDeleteTarget?.name || ''}」已保存的 API Key，该服务的 AI 任务会立即不可用。</p>
        <p>确认删除？</p>
        <div className="settings-confirm-actions">
          <Button onClick={() => setApiKeyDeleteTarget(null)} variant="ghost">取消</Button>
          <Button
            onClick={() => {
              const target = apiKeyDeleteTarget
              setApiKeyDeleteTarget(null)
              if (target) void deleteApiKey(target)
            }}
            variant="danger"
          >
            确认删除
          </Button>
        </div>
      </Dialog>
    </main>
  )
}

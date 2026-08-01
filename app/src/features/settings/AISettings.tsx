import { useEffect, useMemo, useState } from 'react'
import { configureAIProviders } from '../../ai/provider'
import { useTheme, type Theme } from '../../platform/theme'
import { getAppVersion } from '../../platform/native'
import type {
  AIProviderKind,
  AIProviderProfile,
} from '../../domain/models'
import {
  listAIProviderProfiles,
  saveAIProviderProfiles,
} from '../../platform/database'
import { UpdateSettings } from './UpdateSettings'

type SettingsTab = 'providers' | 'appearance' | 'about' | 'update'

function newProvider(index: number): AIProviderProfile {
  const now = Date.now()
  return {
    id: crypto.randomUUID(),
    name: `OpenAI Compatible ${index}`,
    provider: 'openai_compatible',
    baseUrl: '',
    apiKey: '',
    credentialRef: '',
    commandPath: '',
    model: '',
    supportsVision: true,
    supportsText: true,
    enabled: false,
    sortOrder: index,
    createdAt: now,
    updatedAt: now,
  }
}

function providerSubtitle(profile: AIProviderProfile): string {
  if (profile.provider === 'mock') return 'Mock Provider'
  if (profile.provider === 'antigravity_cli') return 'Gemini · Antigravity CLI'
  return profile.baseUrl || 'OpenAI Compatible'
}

const APPEARANCE_OPTIONS: Array<{ value: Theme; label: string; description: string }> = [
  { value: 'light', label: '浅色', description: '始终使用浅色外观' },
  { value: 'dark', label: '深色', description: '始终使用深色外观' },
  { value: 'system', label: '跟随系统', description: '随系统设置自动切换' },
]

export function AISettings() {
  const { theme, resolvedTheme, setTheme } = useTheme()
  const [profiles, setProfiles] = useState<AIProviderProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
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
      .catch((error) => setMessage(`读取设置失败：${String(error)}`))
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
      setMessage('Provider 配置已保存并立即生效')
      window.setTimeout(() => setMessage(null), 3200)
    } catch (error) {
      setMessage(`保存失败：${String(error)}`)
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
      <header className="workspace-header">
        <div>
          <p className="eyebrow">应用偏好</p>
          <h1>设置</h1>
          <p className="subtitle">
            管理 AI 模型 Provider、外观与关于信息。
          </p>
        </div>
        <span className="settings-provider-badge">
          {enabledVisionCount} 个 VLM 可用
        </span>
      </header>

      <section className="settings-shell">
        <nav className="settings-tabs" role="tablist">
          <button
            aria-selected={tab === 'providers'}
            className={tab === 'providers' ? 'active' : ''}
            onClick={() => setTab('providers')}
            role="tab"
            type="button"
          >
            AI 模型
          </button>
          <button
            aria-selected={tab === 'appearance'}
            className={tab === 'appearance' ? 'active' : ''}
            onClick={() => setTab('appearance')}
            role="tab"
            type="button"
          >
            外观
          </button>
          <button
            aria-selected={tab === 'about'}
            className={tab === 'about' ? 'active' : ''}
            onClick={() => setTab('about')}
            role="tab"
            type="button"
          >
            关于
          </button>
          <button
            aria-selected={tab === 'update'}
            className={tab === 'update' ? 'active' : ''}
            onClick={() => setTab('update')}
            role="tab"
            type="button"
          >
            更新
          </button>
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
                          <strong>{profile.name || '未命名 Provider'}</strong>
                          <small>{providerSubtitle(profile)}</small>
                          <span className="provider-nav-tags">
                            {profile.enabled ? (
                              <span className="provider-tag enabled">启用</span>
                            ) : (
                              <span className="provider-tag">停用</span>
                            )}
                            {profile.supportsVision && (
                              <span className="provider-tag">VLM</span>
                            )}
                            {profile.supportsText && (
                              <span className="provider-tag">LLM</span>
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
                      {loading ? '读取中…' : '尚未配置 Provider'}
                    </div>
                  )}
                </div>
              </aside>

              <article className="provider-detail">
                {selectedProfile ? (
                  <>
                    <header className="provider-detail-header">
                      <div>
                        <p className="eyebrow">Provider 详情</p>
                        <h2>
                          {selectedProfile.name || '未命名 Provider'}
                        </h2>
                        <p className="provider-detail-subtitle">
                          {providerSubtitle(selectedProfile)}
                        </p>
                      </div>
                      <div className="provider-detail-actions">
                        {selectedProfile.provider !== 'mock' && (
                          <button
                            className="secondary-action"
                            disabled={saving}
                            onClick={() => removeProvider(selectedProfile.id)}
                            type="button"
                          >
                            移除
                          </button>
                        )}
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
                        <label>
                          <span>Provider</span>
                          <select
                            disabled={saving || selectedProfile.provider === 'mock'}
                            onChange={(event) =>
                              update(selectedProfile.id, {
                                provider: event.target
                                  .value as AIProviderKind,
                              })
                            }
                            value={selectedProfile.provider}
                          >
                            <option value="mock">Mock Provider</option>
                            <option value="openai_compatible">
                              OpenAI Compatible
                            </option>
                            <option value="antigravity_cli">
                              Gemini (Antigravity CLI)
                            </option>
                          </select>
                        </label>
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
                          <span>Model</span>
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
                          <label className="provider-api-key-field">
                            <span>
                              API Key
                              <small>{selectedProfile.credentialRef ? '已保存到 Keychain' : '未保存'}</small>
                            </span>
                            <input
                              autoComplete="off"
                              disabled={saving}
                              onChange={(event) =>
                                update(selectedProfile.id, {
                                  apiKey: event.target.value,
                                })
                              }
                              placeholder="输入 Provider API Key"
                              type="password"
                              value={selectedProfile.apiKey}
                            />
                          </label>
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
                          VLM（图片）
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
                          LLM（文本 / 推理）
                        </label>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="provider-detail-empty">
                    <strong>选择左侧的 Provider 查看详情</strong>
                    <p>或点击"添加"创建新的 Provider 配置。</p>
                  </div>
                )}
              </article>
            </div>
          ) : tab === 'appearance' ? (
            <div className="settings-appearance-pane">
              <header>
                <p className="eyebrow">外观</p>
                <h2>主题</h2>
                <p className="subtitle">选择应用的整体外观。</p>
              </header>
              <div className="appearance-options">
                {APPEARANCE_OPTIONS.map((option) => (
                  <button
                    className={`appearance-option ${
                      theme === option.value ? 'active' : ''
                    }`}
                    key={option.value}
                    onClick={() => setTheme(option.value)}
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
                      {theme === option.value && (
                        <span className="appearance-current">当前</span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
              <p className="appearance-resolved-hint">
                当前实际显示：
                <strong>{resolvedTheme === 'dark' ? '深色' : '浅色'}</strong>
              </p>
            </div>
          ) : tab === 'about' ? (
            <div className="settings-about-pane">
              <header>
                <p className="eyebrow">关于</p>
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
              <span>{message}</span>
              <button
                className="primary-button"
                disabled={loading || saving || profiles.length === 0}
                onClick={() => void save()}
                type="button"
              >
                {saving ? '保存中…' : '保存全部配置'}
              </button>
            </div>
          )}
        </div>
      </section>
    </main>
  )
}

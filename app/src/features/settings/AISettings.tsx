import { useEffect, useState } from 'react'
import { configureAIProviders } from '../../ai/provider'
import type {
  AIProviderKind,
  AIProviderProfile,
} from '../../domain/models'
import {
  listAIProviderProfiles,
  saveAIProviderProfiles,
} from '../../platform/database'

function newProvider(index: number): AIProviderProfile {
  const now = Date.now()
  return {
    id: crypto.randomUUID(),
    name: `OpenAI Compatible ${index}`,
    provider: 'openai_compatible',
    baseUrl: '',
    apiKey: '',
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

function maskedKey(key: string) {
  if (!key) return '未保存'
  return `••••••••••••${key.slice(-4)}`
}

export function AISettings() {
  const [profiles, setProfiles] = useState<AIProviderProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    void listAIProviderProfiles()
      .then(setProfiles)
      .catch((error) => setMessage(`读取设置失败：${String(error)}`))
      .finally(() => setLoading(false))
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

  const move = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction
    if (nextIndex < 0 || nextIndex >= profiles.length) return
    setProfiles((current) => {
      const next = [...current]
      ;[next[index], next[nextIndex]] = [next[nextIndex], next[index]]
      return next.map((profile, sortOrder) => ({
        ...profile,
        sortOrder,
      }))
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
    } catch (error) {
      setMessage(`保存失败：${String(error)}`)
    } finally {
      setSaving(false)
    }
  }

  const enabledVisionCount = profiles.filter(
    (profile) => profile.enabled && profile.supportsVision,
  ).length

  return (
    <main className="workspace settings-workspace">
      <header className="workspace-header" data-tauri-drag-region>
        <div>
          <p className="eyebrow">应用偏好</p>
          <h1>AI 模型</h1>
          <p className="subtitle">
            按顺序配置多个 Provider；图片任务只使用已勾选 VLM 的模型。
          </p>
        </div>
        <span className="settings-provider-badge">
          {enabledVisionCount} 个 VLM 可用
        </span>
      </header>

      <section className="settings-card">
        <div className="settings-card-heading">
          <div>
            <p className="eyebrow">Fallback 顺序</p>
            <h2>AI Provider</h2>
          </div>
          <button
            className="secondary-action"
            disabled={loading || saving}
            onClick={() =>
              setProfiles((current) => [
                ...current,
                newProvider(current.length + 1),
              ])
            }
            type="button"
          >
            添加 Provider
          </button>
        </div>

        <div className="provider-profile-list">
          {profiles.map((profile, index) => {
            const isMock = profile.provider === 'mock'
            const isOpenAICompatible =
              profile.provider === 'openai_compatible'
            const isAntigravity =
              profile.provider === 'antigravity_cli'
            return (
              <article className="provider-profile-card" key={profile.id}>
                <header>
                  <strong>
                    <span>{index + 1}</span>
                    {profile.name || '未命名 Provider'}
                  </strong>
                  <div>
                    <button
                      aria-label="上移 Provider"
                      disabled={saving || index === 0}
                      onClick={() => move(index, -1)}
                      type="button"
                    >
                      ↑
                    </button>
                    <button
                      aria-label="下移 Provider"
                      disabled={saving || index === profiles.length - 1}
                      onClick={() => move(index, 1)}
                      type="button"
                    >
                      ↓
                    </button>
                    {!isMock && (
                      <button
                        disabled={saving}
                        onClick={() =>
                          setProfiles((current) =>
                            current.filter((item) => item.id !== profile.id),
                          )
                        }
                        type="button"
                      >
                        移除
                      </button>
                    )}
                  </div>
                </header>

                <div className="settings-form">
                  <label>
                    <span>名称</span>
                    <input
                      disabled={saving}
                      onChange={(event) =>
                        update(profile.id, { name: event.target.value })
                      }
                      value={profile.name}
                    />
                  </label>
                  <label>
                    <span>Provider</span>
                    <select
                      disabled={saving || isMock}
                      onChange={(event) =>
                        update(profile.id, {
                          provider: event.target.value as AIProviderKind,
                        })
                      }
                      value={profile.provider}
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
                  {isOpenAICompatible && (
                    <label>
                      <span>Base URL</span>
                      <input
                        disabled={saving}
                        onChange={(event) =>
                          update(profile.id, { baseUrl: event.target.value })
                        }
                        placeholder="https://api.example.com/v1"
                        value={profile.baseUrl}
                      />
                    </label>
                  )}
                  {isAntigravity && (
                    <label>
                      <span>Antigravity CLI 路径</span>
                      <input
                        disabled={saving}
                        onChange={(event) =>
                          update(profile.id, {
                            commandPath: event.target.value,
                          })
                        }
                        placeholder="agy 或 /Users/you/.local/bin/agy"
                        value={profile.commandPath}
                      />
                    </label>
                  )}
                  <label>
                    <span>Model</span>
                    <input
                      disabled={saving || isMock}
                      onChange={(event) =>
                        update(profile.id, { model: event.target.value })
                      }
                      placeholder={
                        isAntigravity
                          ? '例如 gemini-3.6-flash-high'
                          : '例如 qwen-vl-max'
                      }
                      value={profile.model}
                    />
                  </label>
                  {isOpenAICompatible && (
                    <label className="provider-api-key-field">
                      <span>
                        API Key
                        <small>{maskedKey(profile.apiKey)}</small>
                      </span>
                      <input
                        autoComplete="off"
                        disabled={saving}
                        onChange={(event) =>
                          update(profile.id, { apiKey: event.target.value })
                        }
                        placeholder="输入 Provider API Key"
                        type="password"
                        value={profile.apiKey}
                      />
                    </label>
                  )}
                </div>

                <div className="provider-capabilities">
                  <label>
                    <input
                      checked={profile.enabled}
                      disabled={saving}
                      onChange={(event) =>
                        update(profile.id, { enabled: event.target.checked })
                      }
                      type="checkbox"
                    />
                    启用
                  </label>
                  <label>
                    <input
                      checked={profile.supportsVision}
                      disabled={saving || isMock}
                      onChange={(event) =>
                        update(profile.id, {
                          supportsVision: event.target.checked,
                        })
                      }
                      type="checkbox"
                    />
                    VLM（图片）
                  </label>
                  <label>
                    <input
                      checked={profile.supportsText}
                      disabled={saving || isMock}
                      onChange={(event) =>
                        update(profile.id, {
                          supportsText: event.target.checked,
                        })
                      }
                      type="checkbox"
                    />
                    LLM（文本 / 推理）
                  </label>
                </div>
              </article>
            )
          })}
        </div>

        <div className="settings-safety-note">
          <strong>本阶段存储方式</strong>
          <p>
            API Key 按当前产品阶段要求明文保存在本机 Axiom SQLite
            数据库中。输入框使用密码样式，并显示已保存 Key 的末四位。
          </p>
        </div>

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
      </section>
    </main>
  )
}

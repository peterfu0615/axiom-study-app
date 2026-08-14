import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import {
  checkForUpdates,
  downloadAndInstallUpdate,
  getAppVersion,
  onDownloadProgress,
  type UpdateInfo,
} from '../../platform/native'
import { Button } from '../../components/ui'

/** 格式化文件大小为人类可读字符串。 */
function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}

/** 格式化 ISO 8601 日期为本地可读日期。 */
function formatDate(iso: string): string {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  } catch {
    return iso
  }
}

export function UpdateSettings() {
  const [currentVersion, setCurrentVersion] = useState('…')
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const [checking, setChecking] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [hasChecked, setHasChecked] = useState(false)
  const unlistenRef = useRef<(() => void) | null>(null)

  // 获取当前版本
  useEffect(() => {
    void getAppVersion()
      .then(setCurrentVersion)
      .catch(() => setCurrentVersion('未知'))
  }, [])

  // 组件卸载时取消进度监听
  useEffect(() => {
    return () => {
      unlistenRef.current?.()
    }
  }, [])

  const handleCheck = async () => {
    setChecking(true)
    setError(null)
    setUpdateInfo(null)
    setHasChecked(false)
    try {
      const info = await checkForUpdates()
      setUpdateInfo(info)
      setHasChecked(true)
    } catch (e) {
      console.error('检查更新失败', e)
      setError('暂时无法连接更新服务，请稍后重试。')
      setHasChecked(true)
    } finally {
      setChecking(false)
    }
  }

  const handleInstall = async () => {
    if (!updateInfo) return
    setDownloading(true)
    setError(null)
    setProgress(0)

    // 设置进度监听
    unlistenRef.current?.()
    unlistenRef.current = await onDownloadProgress((p) => {
      setProgress(p.percent)
    })

    try {
      await downloadAndInstallUpdate(
        updateInfo.downloadUrl,
        updateInfo.sha256Url,
        updateInfo.version,
      )
      // 成功后进程会退出，这里不会执行到
    } catch (e) {
      console.error('安装更新失败', e)
      setError('更新未能完成，请稍后重试。')
      setDownloading(false)
      unlistenRef.current?.()
      unlistenRef.current = null
    }
  }

  const isLatest = hasChecked && !updateInfo && !error

  return (
    <div className="settings-update-pane">
      <header>
        <p className="eyebrow">更新</p>
        <h2>版本与更新</h2>
        <p className="subtitle">检查并安装最新版本的 Axiom。</p>
      </header>

      <dl className="settings-about-facts">
        <div>
          <dt>当前版本</dt>
          <dd>{currentVersion}</dd>
        </div>
        {updateInfo && (
          <>
            <div>
              <dt>最新版本</dt>
              <dd className="update-available">
                {updateInfo.version}
                <span className="update-arrow"> ← 可更新</span>
              </dd>
            </div>
            <div>
              <dt>发布日期</dt>
              <dd>{formatDate(updateInfo.publishedAt)}</dd>
            </div>
            <div>
              <dt>下载大小</dt>
              <dd>{formatSize(updateInfo.downloadSize)}</dd>
            </div>
          </>
        )}
      </dl>

      {error && (
        <div className="update-error">
          <strong>检查更新失败</strong>
          <p>{error}</p>
          <p className="update-hint">
            请稍后重试；更新服务不可用时不会影响本地数据。
          </p>
        </div>
      )}

      {isLatest && (
        <div className="update-latest">
          <p>已是最新版本（{currentVersion}）。</p>
        </div>
      )}

      {updateInfo && (
        <div className="update-release-notes">
          <h3>更新日志</h3>
          <div className="update-changelog">
            <ReactMarkdown>{updateInfo.releaseNotes}</ReactMarkdown>
          </div>
        </div>
      )}

      {downloading && (
        <div className="update-progress-section">
          <p className="update-progress-label">
            正在下载更新… {progress.toFixed(0)}%
          </p>
          <div className="update-progress-bar">
            <div
              className="update-progress-fill"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="update-hint">
            下载完成后应用将自动退出并安装，请勿关闭窗口。
          </p>
        </div>
      )}

      <div className="update-actions">
        {!downloading && (
          <Button disabled={checking} loading={checking} onClick={() => void handleCheck()} variant="secondary">
            检查更新
          </Button>
        )}
        {updateInfo && !downloading && (
          <Button onClick={() => void handleInstall()} variant="primary">
            立即更新并重启
          </Button>
        )}
      </div>
    </div>
  )
}

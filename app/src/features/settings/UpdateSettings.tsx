import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import {
  checkForUpdates,
  downloadAndInstallUpdate,
  getAppVersion,
  type DownloadProgress,
  type UpdateOperationError,
  type UpdateInfo,
} from '../../platform/native'
import { Button } from '../../components/ui'
import {
  formatSize,
  updateErrorTitle,
} from './updatePresentation'

function formatDownloadedSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  return formatSize(bytes)
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
  const [progress, setProgress] = useState<DownloadProgress>({
    stage: 'checking',
    downloaded: 0,
    total: null,
    percent: null,
  })
  const [error, setError] = useState<UpdateOperationError | null>(null)
  const [hasChecked, setHasChecked] = useState(false)

  // 获取当前版本
  useEffect(() => {
    void getAppVersion()
      .then(setCurrentVersion)
      .catch(() => setCurrentVersion('未知'))
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
      setError(e && typeof e === 'object' && 'stage' in e
        ? e as UpdateOperationError
        : { stage: 'checking', code: 'check_failed', message: '暂时无法连接更新服务，请稍后重试。', retryable: true, manualDownloadUrl: 'https://github.com/peterfu0615/axiom-study-app/releases/latest' })
      setHasChecked(true)
    } finally {
      setChecking(false)
    }
  }

  const handleInstall = async () => {
    if (!updateInfo) return
    setDownloading(true)
    setError(null)
    setProgress({ stage: 'checking', downloaded: 0, total: null, percent: null })

    try {
      await downloadAndInstallUpdate(setProgress)
    } catch (e) {
      console.error('安装更新失败', e)
      setError(e && typeof e === 'object' && 'stage' in e
        ? e as UpdateOperationError
        : { stage: progress.stage, code: 'install_failed', message: '更新未能完成，请稍后重试。', retryable: true, manualDownloadUrl: updateInfo.manualDownloadUrl })
      setDownloading(false)
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
          <strong>{updateErrorTitle(error.stage)}</strong>
          <p>{error.message}</p>
          <p className="update-hint">
            错误码：{error.code}。{error.retryable ? '可以重试；' : ''}当前版本与本地数据未被替换。
          </p>
          <a href={error.manualDownloadUrl} rel="noreferrer" target="_blank">手动下载桥接版本</a>
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
            {progress.stage === 'checking' ? '正在重新检查签名更新清单…'
              : progress.stage === 'verifying_signature' ? '下载完成，正在验证更新签名…'
                : progress.stage === 'installing' ? '签名有效，正在安装更新…'
                  : progress.stage === 'relaunching' ? '安装完成，正在重新启动…'
                    : progress.percent == null
                      ? `正在下载更新… 已下载 ${formatDownloadedSize(progress.downloaded)}`
                      : `正在下载更新… ${progress.percent.toFixed(0)}%`}
          </p>
          {progress.stage === 'downloading' && progress.percent != null && <div className="update-progress-bar">
            <div
              className="update-progress-fill"
              style={{ width: `${Math.min(100, Math.max(0, progress.percent))}%` }}
            />
          </div>}
          <p className="update-hint">
            下载达到 100% 后仍会执行签名验证与安装；完成前请勿关闭窗口。
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

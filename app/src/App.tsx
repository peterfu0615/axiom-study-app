import { useEffect, useState, type MouseEvent } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { resumeProblemAIPipeline } from './ai/pipeline'
import { resumeSolutionPipeline } from './ai/solutionPipeline'
import { resumeIntelligencePipeline } from './ai/intelligencePipeline'
import { configureAIProviders } from './ai/provider'
import { Sidebar, type AppSection } from './components/Sidebar'
import { Toast } from './components/Toast'
import { CaptureWorkspace } from './features/capture/CaptureWorkspace'
import { ProblemLibrary } from './features/library/ProblemLibrary'
import { CurriculumWorkspace } from './features/curriculum/CurriculumWorkspace'
import { CurriculumAnalysisProvider } from './features/curriculum/CurriculumAnalysisContext'
import { AISettings } from './features/settings/AISettings'
import { ModulePlaceholder } from './features/placeholder/ModulePlaceholder'
import { CurriculumPreview } from './features/curriculum/CurriculumPreview'
import { ensureDatabaseReady, listAIProviderProfiles, type DatabasePathCheck } from './platform/database'
import { checkForUpdates } from './platform/native'
import { useToast, type ToastState } from './platform/useToast'
import { DatabaseLocationErrorDialog } from './components/DatabaseLocationErrorDialog'
import './components/ui/ui.css'
import './App.css'

function startWindowDrag(event: MouseEvent<HTMLDivElement>) {
  if (event.button !== 0) return
  if (event.target instanceof HTMLElement && event.target.closest('button, input, select, a')) {
    return
  }
  void getCurrentWindow().startDragging()
}

// StrictMode mounts the runtime twice; each startup action (database check,
// provider configuration, pipeline resume, update check) must run exactly
// once per process.  The first effect run owns the boot sequence and later
// mounts simply reuse its state updates.
let appBootStarted = false

function AppRuntimeShell({
  section,
  setSection,
  toast,
}: {
  section: AppSection
  setSection: (section: AppSection) => void
  toast: ToastState | null
}) {
  return (
    <div className="app-shell">
      <div
        className="window-drag-strip"
        onMouseDown={startWindowDrag}
      />
      <Sidebar
        active={section}
        onChange={setSection}
      />
      {section === 'capture' ? (
        <CaptureWorkspace />
      ) : section === 'library' ? (
        <ProblemLibrary />
      ) : section === 'curriculum' ? (
        <CurriculumWorkspace />
      ) : section === 'settings' ? (
        <AISettings />
      ) : (
        <ModulePlaceholder section={section} />
      )}
      <Toast toast={toast} />
    </div>
  )
}

function AppRuntime() {
  const [section, setSection] = useState<AppSection>('capture')
  const [dbCheck, setDbCheck] = useState<DatabasePathCheck | null>(null)
  const { toast, notify } = useToast()

  useEffect(() => {
    if (appBootStarted) return
    appBootStarted = true
    void (async () => {
      // 先确保数据库就绪并校验路径一致性
      const { check } = await ensureDatabaseReady()
      setDbCheck(check)
      if (!check.ok) {
        // 路径不一致时不继续初始化 AI Pipeline，避免在错误数据库上操作
        return
      }
      try {
        configureAIProviders(await listAIProviderProfiles())
        await Promise.all([
          resumeProblemAIPipeline(),
          resumeSolutionPipeline(),
          resumeIntelligencePipeline(),
        ])
      } catch (error) {
        console.error('恢复 AI Pipeline 失败', error)
      }

      // 启动后台静默检查更新（失败不提示，仅在有更新时 Toast）
      try {
        const update = await checkForUpdates()
        if (update) {
          notify(
            `发现新版本 v${update.version}，前往「设置 → 更新」安装`,
            'info',
          )
        }
      } catch {
        // 静默失败：更新源未配置或网络不可达时不打扰用户
      }
    })()
  }, [notify])

  // 数据库路径不一致时，阻塞整个应用并显示错误对话框
  if (dbCheck && !dbCheck.ok) {
    return <DatabaseLocationErrorDialog check={dbCheck} />
  }

  return <CurriculumAnalysisProvider enabled={dbCheck?.ok === true}>
    <AppRuntimeShell section={section} setSection={setSection} toast={toast} />
  </CurriculumAnalysisProvider>
}

function App() {
  const previewParams = import.meta.env.DEV
    ? new URLSearchParams(window.location.search)
    : null
  const preview = previewParams?.get('ui-preview') ?? null
  if (preview === 'curriculum') {
    const previewTheme = previewParams?.get('theme')
    if (previewTheme === 'light' || previewTheme === 'dark') {
      document.documentElement.setAttribute('data-theme', previewTheme)
    }
    return <CurriculumPreview state={previewParams?.get('state') ?? 'populated'} />
  }
  return <AppRuntime />
}

export default App

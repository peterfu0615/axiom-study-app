import { useEffect, useState, type MouseEvent } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { resumeProblemAIPipeline } from './ai/pipeline'
import { resumeSolutionPipeline } from './ai/solutionPipeline'
import { resumeIntelligencePipeline } from './ai/intelligencePipeline'
import { configureAIProviders } from './ai/provider'
import { Sidebar, type AppSection } from './components/Sidebar'
import { CaptureWorkspace } from './features/capture/CaptureWorkspace'
import { ProblemLibrary } from './features/library/ProblemLibrary'
import { AISettings } from './features/settings/AISettings'
import { ModulePlaceholder } from './features/placeholder/ModulePlaceholder'
import { ensureDatabaseReady, listAIProviderProfiles, type DatabasePathCheck } from './platform/database'
import { DatabaseLocationErrorDialog } from './components/DatabaseLocationErrorDialog'
import './App.css'

function startWindowDrag(event: MouseEvent<HTMLDivElement>) {
  if (event.button !== 0) return
  if (event.target instanceof HTMLElement && event.target.closest('button, input, select, a')) {
    return
  }
  void getCurrentWindow().startDragging()
}

function App() {
  const [section, setSection] = useState<AppSection>('capture')
  const [dbCheck, setDbCheck] = useState<DatabasePathCheck | null>(null)

  useEffect(() => {
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
    })()
  }, [])

  // 数据库路径不一致时，阻塞整个应用并显示错误对话框
  if (dbCheck && !dbCheck.ok) {
    return <DatabaseLocationErrorDialog check={dbCheck} />
  }

  return (
    <div className="app-shell">
      <div
        className="window-drag-strip"
        onMouseDown={startWindowDrag}
      />
      <Sidebar active={section} onChange={setSection} />
      {section === 'capture' ? (
        <CaptureWorkspace />
      ) : section === 'library' ? (
        <ProblemLibrary />
      ) : section === 'settings' ? (
        <AISettings />
      ) : (
        <ModulePlaceholder section={section} />
      )}
    </div>
  )
}

export default App

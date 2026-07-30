import { useEffect, useState } from 'react'
import { resumeProblemAIPipeline } from './ai/pipeline'
import { resumeSolutionPipeline } from './ai/solutionPipeline'
import { resumeIntelligencePipeline } from './ai/intelligencePipeline'
import { configureAIProviders } from './ai/provider'
import { Sidebar, type AppSection } from './components/Sidebar'
import { CaptureWorkspace } from './features/capture/CaptureWorkspace'
import { ProblemLibrary } from './features/library/ProblemLibrary'
import { AISettings } from './features/settings/AISettings'
import { ModulePlaceholder } from './features/placeholder/ModulePlaceholder'
import { listAIProviderProfiles } from './platform/database'
import './App.css'

function App() {
  const [section, setSection] = useState<AppSection>('capture')

  useEffect(() => {
    void (async () => {
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

  return (
    <div className="app-shell">
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

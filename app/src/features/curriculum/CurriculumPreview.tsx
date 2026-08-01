import { useEffect, useState } from 'react'
import { Sidebar, type AppSection } from '../../components/Sidebar'
import { ModulePlaceholder } from '../placeholder/ModulePlaceholder'
import { CurriculumAnalysisProvider, useCurriculumAnalysisStatus } from './CurriculumAnalysisContext'
import { CurriculumWorkspace } from './CurriculumWorkspace'
import {
  curriculumPreviewImportJob,
  installCurriculumPreviewFixture,
} from './curriculumPreviewFixture'

function CurriculumPreviewShell({ state }: { state: string }) {
  const [section, setSection] = useState<AppSection>('curriculum')
  const { openProgress } = useCurriculumAnalysisStatus()

  useEffect(() => {
    if (state.startsWith('import-')) openProgress('preview-import')
  }, [openProgress, state])

  const workspace = section === 'curriculum'
    ? <CurriculumWorkspace initialView={state.startsWith('tags-') || state.startsWith('relabel-') ? 'tags' : 'structure'} />
    : section === 'capture'
      ? <main className="workspace placeholder-workspace"><header className="workspace-header"><div><p className="eyebrow">学习素材</p><h1>采集</h1></div></header></main>
      : <ModulePlaceholder section={section} />

  return <div className="app-shell" data-preview-state={state}>
    <Sidebar
      active={section}
      onChange={setSection}
    />
    {workspace}
  </div>
}

export function CurriculumPreview({ state }: { state: string }) {
  installCurriculumPreviewFixture(state)
  const hasImport = state.startsWith('import-') || state.startsWith('global-analysis-')
  const initialJob = hasImport ? curriculumPreviewImportJob(state) : null
  return <CurriculumAnalysisProvider enabled={false} initialJob={initialJob} resumeOnMount={false}>
    <CurriculumPreviewShell state={state} />
  </CurriculumAnalysisProvider>
}

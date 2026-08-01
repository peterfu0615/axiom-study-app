import { CurriculumImportFlow } from './CurriculumImportFlow'
import { CurriculumWorkspace } from './CurriculumWorkspace'
import { installCurriculumPreviewFixture } from './curriculumPreviewFixture'

export function CurriculumPreview({ state }: { state: string }) {
  installCurriculumPreviewFixture(state)
  if (state.startsWith('import-')) {
    return <CurriculumImportFlow initialJobId="preview-import" onBack={() => {}} onCompleted={() => {}} onManual={() => {}} />
  }
  return <CurriculumWorkspace initialView={state.startsWith('tags-') || state.startsWith('relabel-') ? 'tags' : 'structure'} />
}

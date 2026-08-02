// @ts-expect-error Vitest executes this contract in Node, while the app tsconfig is browser-only.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CURRICULUM_PREVIEW_STATES } from './curriculumPreviewFixture'

const stylesheet = readFileSync(new URL('./Curriculum.css', import.meta.url), 'utf8')
const tagOverviewSource = readFileSync(new URL('./TagOverview.tsx', import.meta.url), 'utf8')

describe('curriculum structure layout contract', () => {
  it('allocates the summary and structure card as two rows inside one viewport', () => {
    expect(stylesheet).toMatch(/\.curriculum-structure-view\s*\{[\s\S]*grid-template-rows:\s*auto\s+minmax\(0,\s*1fr\)/u)
    expect(stylesheet).toMatch(/\.curriculum-structure-shell\s*\{[\s\S]*height:\s*auto/u)
    expect(stylesheet).toMatch(/\.curriculum-structure-shell\s*\{[\s\S]*min-height:\s*0/u)
  })

  it('keeps the directory and detail panes as independent scroll owners', () => {
    expect(stylesheet).toMatch(/\.curriculum-tree-scroll\s*\{[\s\S]*overflow-y:\s*auto[\s\S]*overscroll-behavior:\s*contain/u)
    expect(stylesheet).toMatch(/\.curriculum-node-detail\s*\{[\s\S]*overflow-y:\s*auto[\s\S]*overflow-x:\s*hidden[\s\S]*overscroll-behavior:\s*contain/u)
  })

  it('centers every tag table column after the name column with one shared grid', () => {
    expect(stylesheet).toMatch(/.curriculum-tag-table__header,\s*\.curriculum-tag-table article\s*\{[^}]*grid-template-columns:[^}]*align-items:\s*center/u)
    expect(stylesheet).toMatch(/\.curriculum-tag-table__header > :not\(:first-child\),\s*\.curriculum-tag-table article > :not\(:first-child\)\s*\{[^}]*justify-self:\s*center[^}]*text-align:\s*center/u)
    expect(stylesheet).toContain('.curriculum-tag-table article > .ax-status-badge')
  })

  it('gives textbook analysis a full-width mode without changing compact relabel cards', () => {
    expect(readFileSync(new URL('../../components/ui/FlowingTaskSurface.css', import.meta.url), 'utf8')).toMatch(/\.flowing-task-surface\.is-full-width\s*\{[^}]*width:\s*100%[^}]*max-width:\s*none/u)
    expect(stylesheet).toMatch(/\.curriculum-task-safe-area > \.flowing-task-surface\.is-full-width\s*\{[^}]*justify-self:\s*stretch/u)
    expect(stylesheet).toContain('.curriculum-relabel-task.is-active > .flowing-task-surface { width: min(100%, 520px);')
  })

  it('keeps preview fixtures on the two-level structure contract', () => {
    expect(CURRICULUM_PREVIEW_STATES).toEqual(expect.arrayContaining([
      'ai-missing-difficulty-score', 'relabel-running-single-card', 'relabel-failed-retry',
      'bulk-review-success', 'tag-table-centered', 'import-processing-wide',
      'custom-select-open', 'structure-chapter-knowledge', 'structure-unclassified-knowledge',
    ]))
  })

  it('renders every started relabel batch as one task card', () => {
    expect(tagOverviewSource).toContain('const hasRelabelTask = Boolean(batch)')
    expect(tagOverviewSource).toContain('{batch\n              ? <FlowingTaskSurface')
    expect(tagOverviewSource).toContain('重试失败项')
    expect(tagOverviewSource).toContain('查看范围')
  })
})

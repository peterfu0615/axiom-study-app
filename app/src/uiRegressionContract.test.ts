// @ts-expect-error Vitest executes this contract in Node, while the app tsconfig is browser-only.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

const appCss = read('./App.css')
const refinementCss = read('./uiRefinement.css')
const libraryCss = read('./features/library/ProblemTags.css')
const library = read('./features/library/ProblemLibrary.tsx')

describe('reported UI regression contracts', () => {
  it('keeps navigation quiet while retaining the app-level keyboard commands', () => {
    const sidebar = read('./components/Sidebar.tsx')
    const app = read('./App.tsx')

    expect(sidebar).not.toContain('shortcut=')
    expect(sidebar).not.toContain("shortcut: '")
    expect(app).toContain("'1': 'today'")
    expect(app).toContain("',': 'settings'")
  })

  it('uses shared underline tabs for peer views and time ranges', () => {
    for (const [path, label] of [
      ['./features/capture/CaptureWorkspace.tsx', '采集方式'],
      ['./features/today/TodayWorkspace.tsx', '预测时间范围'],
      ['./features/insights/InsightsWorkspace.tsx', '洞察时间范围'],
    ]) {
      const source = read(path)
      expect(source).toContain('<Tabs')
      expect(source).toContain(`ariaLabel="${label}"`)
    }
  })

  it('uses the choice card as the visible appearance selection affordance', () => {
    const settings = read('./features/settings/AISettings.tsx')

    expect(settings).not.toContain('始终使用浅色外观')
    expect(settings).not.toContain('始终使用深色外观')
    expect(settings).not.toContain('随系统设置自动切换')
    expect(refinementCss).toMatch(/\.appearance-options\s*\{[^}]*repeat\(3,\s*minmax\(0,\s*1fr\)\)/u)
    expect(refinementCss).toMatch(/\.appearance-options \.ax-radio__control,[\s\S]*display:\s*none/u)
    expect(refinementCss).toContain('.appearance-options .ax-radio:has(input:focus-visible)')
  })

  it('reserves focus-ring space and does not stretch compact settings rows', () => {
    expect(refinementCss).toMatch(/\.provider-detail-body\s*\{[^}]*margin-inline:[^}]*padding:/u)
    expect(refinementCss).toMatch(/@media \(max-width: 820px\)[\s\S]*\.settings-shell\s*\{[^}]*grid-template-rows:\s*auto minmax\(0,\s*1fr\)[^}]*align-content:\s*start/u)
  })

  it('keeps status actions inside their capsule and shows one variant loader', () => {
    expect(appCss).toMatch(/\.problem-ai-notice\s*\{[^}]*overflow:\s*hidden/u)
    expect(appCss).toMatch(/\.problem-ai-notice__action\s*\{[^}]*min-height:\s*16px[^}]*height:\s*16px/u)
    expect(library).not.toContain('FlowingTaskSurface')
    expect(library).toContain('preview.outcome.planId')
    expect(library).toContain("scrollIntoView({ block: 'nearest' })")
  })

  it('uses peer card typography and a smaller concentric radius for nested errors', () => {
    expect(appCss).toMatch(/\.problem-review-history h3\s*\{[^}]*--ax-type-card-size/u)
    expect(appCss).toMatch(/\.problem-review-history li strong\s*\{[^}]*--ax-type-body-size/u)
    expect(library).toContain('className="problem-ai-error-region"')
    expect(libraryCss).toMatch(/\.problem-ai-error-region \.ax-error-state\s*\{[^}]*border-radius:\s*var\(--ax-radius-sm\)/u)
  })

  it('keeps the curriculum page header on the shared workspace inset', () => {
    const curriculumCss = read('./features/curriculum/Curriculum.css')
    expect(curriculumCss).toMatch(/\.workspace\.curriculum-workspace\s*\{[^}]*padding-top:\s*var\(--ax-space-10\)[^}]*padding-bottom:\s*var\(--ax-space-9\)/u)
    expect(curriculumCss).not.toMatch(/\.workspace\.curriculum-workspace\s*\{[^}]*padding-inline:/u)
  })
})

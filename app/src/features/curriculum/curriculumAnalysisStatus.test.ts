import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
// @ts-expect-error Vitest runs in Node; the application tsconfig intentionally excludes Node globals.
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { FlowingTaskSurface } from '../../components/ui'
import type { CurriculumImportJob } from '../../domain/horizon'
import { CurriculumAnalysisProvider } from './CurriculumAnalysisContext'
import { CurriculumAnalysisStatusPill } from './CurriculumAnalysisStatusButton'
import { curriculumPreviewImportJob } from './curriculumPreviewFixture'
import {
  CurriculumAnalysisStatusStore,
  curriculumAnalysisProgress,
  curriculumAnalysisStageLabel,
  curriculumGlobalStatus,
  isCurriculumAnalysisRunning,
} from './curriculumAnalysisStatus'

function job(state: string, overrides: Partial<CurriculumImportJob> = {}) {
  return { ...curriculumPreviewImportJob(state), ...overrides }
}

describe('global curriculum analysis status', () => {
  it('initializes once at App level and owns a single poller across section changes', async () => {
    const load = vi.fn(async () => job('global-analysis-tags'))
    const callbacks = new Set<() => void>()
    const scheduler = {
      set: vi.fn((callback: () => void) => { callbacks.add(callback); return callback }),
      clear: vi.fn((handle: unknown) => { callbacks.delete(handle as () => void) }),
    }
    const store = new CurriculumAnalysisStatusStore(load, 900, scheduler)
    await Promise.all([store.start(), store.start()])
    expect(load).toHaveBeenCalledTimes(1)
    expect(scheduler.set).toHaveBeenCalledTimes(1)
    expect(store.getSnapshot()?.id).toBe('preview-import')

    // Switching workspaces does not stop or recreate the App-shell store.
    const simulatedSections = ['curriculum', 'library', 'settings']
    simulatedSections.forEach(() => expect(store.getSnapshot()?.status).toBe('ai_generating_tags'))
    expect(callbacks.size).toBe(1)
  })

  it.each([
    ['global-analysis-structure', '正在识别教材结构'],
    ['global-analysis-tags', '标签创建中'],
    ['global-analysis-audit', '正在检查分析结果'],
  ])('maps %s to the concise Chinese stage label', (state, label) => {
    expect(curriculumAnalysisStageLabel(job(state))).toBe(label)
  })

  it('uses persisted progress after a restart', async () => {
    const persisted = job('global-analysis-tags', {
      progressCurrent: 4, progressTotal: 5, progressFraction: .74,
      progressLabel: '标签创建中 · 4/5',
    })
    const scheduler = { set: () => 1, clear: () => {} }
    const restartedStore = new CurriculumAnalysisStatusStore(async () => persisted, 900, scheduler)
    await restartedStore.start()
    expect(restartedStore.getSnapshot()?.progressCurrent).toBe(4)
    expect(curriculumAnalysisProgress(restartedStore.getSnapshot()!)).toBe(.74)
  })

  it('switches the one global button from running to completed and removes it after cancel', () => {
    const store = new CurriculumAnalysisStatusStore(async () => null)
    store.publish(job('global-analysis-structure'))
    expect(curriculumGlobalStatus(store.getSnapshot())).toMatchObject({
      label: '分析教材中', animated: true,
    })
    store.publish(job('global-analysis-completed'))
    expect(curriculumGlobalStatus(store.getSnapshot())).toEqual({
      kind: 'completed', label: '分析完成', detail: null, animated: false,
    })
    store.publish(null)
    expect(curriculumGlobalStatus(store.getSnapshot())).toBeNull()
  })

  it('does not use running animation or running semantics for a recoverable failure', () => {
    const failed = job('global-analysis-failed')
    expect(isCurriculumAnalysisRunning(failed)).toBe(false)
    expect(curriculumGlobalStatus(failed)).toEqual({
      kind: 'failed', label: '分析已暂停', detail: null, animated: false,
    })
  })

  it('renders exactly one global status button without resume or abandon controls', () => {
    const markup = renderToStaticMarkup(
      createElement(
        CurriculumAnalysisProvider,
        { enabled: false, initialJob: job('global-analysis-tags') },
        createElement(CurriculumAnalysisStatusPill, { onOpen: () => {} }),
      ),
    )
    expect(markup.match(/curriculum-analysis-status-pill is-running/gu)).toHaveLength(1)
    expect(markup).toContain('分析教材中')
    expect(markup).not.toContain('继续分析')
    expect(markup).not.toContain('放弃')
  })

  it('turns off all flowing highlights when reduced motion is requested', () => {
    const css = readFileSync(new URL('../../components/ui/FlowingTaskSurface.css', import.meta.url), 'utf8')
    const reducedMotion = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'))
    expect(reducedMotion).toContain('.flowing-task-surface__glow')
    expect(reducedMotion).toContain('.flowing-task-surface__progress > span')
    expect(reducedMotion).toContain('animation: none')
  })

  it('uses persisted counts and does not fabricate percentage text', () => {
    const markup = renderToStaticMarkup(createElement(FlowingTaskSurface, {
      state: 'running', title: '标签创建中', progress: .6,
      progressCurrent: 3, progressTotal: 5, progressLabel: '标签创建中 · 3/5',
    }))
    expect(markup).toContain('3 / 5')
    expect(markup).not.toContain('>60%<')
    expect(markup).toContain('role="progressbar"')
  })
})

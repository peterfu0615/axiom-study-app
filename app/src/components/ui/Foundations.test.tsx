import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
// @ts-expect-error Vitest executes this contract in Node, while the app tsconfig is browser-only.
import { readFileSync } from 'node:fs'
import { Badge, Button, IconButton, Input, PageHeader, SegmentedControl, StatusBadge, StatusTag } from './index'
import { Icon } from '../Icon'

describe('design system foundations', () => {
  it('renders accessible input metadata and category/status primitives', () => {
    const html = renderToStaticMarkup(<>
      <Input error="必填" label="教材" value="" readOnly />
      <Badge>全等三角形</Badge>
      <StatusBadge tone="warning">待确认</StatusBadge>
      <IconButton appearance="plain" label="删除" tone="danger">icon</IconButton>
      {(['pending', 'completed', 'deferred', 'again', 'hard', 'good', 'easy'] as const)
        .map((kind) => <StatusTag key={kind} kind={kind}>{kind}</StatusTag>)}
    </>)
    expect(html).toContain('<label')
    expect(html).toContain('aria-invalid="true"')
    expect(html).toContain('ax-badge')
    expect(html).toContain('ax-status-badge--warning')
    expect(html).toContain('ax-icon-button--plain')
    expect(html).toContain('ax-icon-button--danger')
    expect(html).toContain('ax-status-tag--completed')
    expect(html).toContain('ax-status-tag--again')
  })

  it('keeps Status capsules intrinsic and core feature CSS tokenized', () => {
    const ui = readFileSync(new URL('./ui.css', import.meta.url), 'utf8')
    const tags = readFileSync(new URL('../../features/library/ProblemTags.css', import.meta.url), 'utf8')
    expect(ui).toContain('width: fit-content')
    expect(ui).toContain('flex: 0 0 auto')
    expect(ui).toContain('var(--ax-primary-control-ink)')
    expect(ui).toMatch(/\.ax-icon-button--plain \{[^}]*border-color: transparent;[^}]*outline: none;[^}]*background: transparent;[^}]*box-shadow: none;/u)
    expect(ui).toContain('.ax-icon-button--plain:focus-visible')
    expect(tags).not.toMatch(/#[\da-f]{3,8}/iu)
    expect(tags).not.toMatch(/font-size:\s*\d/gu)
    expect(tags).not.toMatch(/border-radius:\s*\d/gu)
  })

  it('exposes one semantic typography scale and page-header hierarchy', () => {
    const tokens = readFileSync(new URL('../../index.css', import.meta.url), 'utf8')
    const refinement = readFileSync(new URL('../../uiRefinement.css', import.meta.url), 'utf8')
    const html = renderToStaticMarkup(
      <PageHeader actions={<Button>开始</Button>} eyebrow="学习趋势" summary="复习趋势与掌握变化" title="洞察" />,
    )

    for (const token of [
      '--ax-type-eyebrow-size', '--ax-type-page-size', '--ax-type-section-size',
      '--ax-type-card-size', '--ax-type-body-size', '--ax-type-body-small-size',
      '--ax-type-control-size', '--ax-type-label-size', '--ax-type-meta-size',
      '--ax-type-caption-size', '--ax-page-eyebrow',
    ]) expect(tokens).toContain(token)
    expect(html).toContain('ax-page-header__eyebrow')
    expect(html).toContain('ax-page-header__title')
    expect(html).toContain('ax-page-header__summary')
    expect(refinement).toContain('color: var(--ax-page-eyebrow)')

    for (const source of [
      '../../features/today/TodayWorkspace.tsx',
      '../../features/capture/CaptureWorkspace.tsx',
      '../../features/library/ProblemLibrary.tsx',
      '../../features/curriculum/CurriculumWorkspace.tsx',
      '../../features/insights/InsightsWorkspace.tsx',
      '../../features/settings/AISettings.tsx',
      '../../features/practice/PracticeSetView.tsx',
    ]) expect(readFileSync(new URL(source, import.meta.url), 'utf8')).toContain('<PageHeader')
  })

  it('centers shared icon-and-text controls without local offsets', () => {
    const ui = readFileSync(new URL('./ui.css', import.meta.url), 'utf8')
    const refinement = readFileSync(new URL('../../uiRefinement.css', import.meta.url), 'utf8')
    const html = renderToStaticMarkup(<>
      <Button><Icon name="refresh" size={16} />刷新</Button>
      <SegmentedControl
        ariaLabel="采集方式"
        onChange={() => undefined}
        options={[{ value: 'camera', label: <><Icon name="camera" size={16} />iPhone 相机</> }]}
        value="camera"
      />
    </>)

    expect(html).toContain('ax-button__content')
    expect(html).toContain('class="icon"')
    expect(ui).toMatch(/\.ax-button__content \{[^}]*display: inline-flex;[^}]*align-items: center;/u)
    expect(refinement).toMatch(/\.segmented-control button \{[^}]*display: inline-flex;[^}]*align-items: center;/u)
    expect(refinement).not.toMatch(/\.segmented-control[^}]*translateY/u)
  })
})

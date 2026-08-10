import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
// @ts-expect-error Vitest executes this contract in Node, while the app tsconfig is browser-only.
import { readFileSync } from 'node:fs'
import { Badge, IconButton, Input, StatusBadge, StatusTag } from './index'

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
})

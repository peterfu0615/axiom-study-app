import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
// @ts-expect-error Vitest executes this contract in Node, while the app tsconfig is browser-only.
import { readFileSync } from 'node:fs'
import { ListboxSelect, type SelectOption } from './ListboxSelect'
import { getListboxNavigationIndex, getListboxTypeaheadIndex } from './ListboxSelect.utils'

const options: SelectOption[] = [
  { value: 'all', label: '全部状态' },
  { value: 'review', label: '待确认' },
  { value: 'archived', label: '已归档', disabled: true },
]

describe('ListboxSelect', () => {
  it('renders a custom trigger with the listbox accessibility contract', () => {
    const html = renderToStaticMarkup(
      <ListboxSelect ariaLabel="审核状态" onValueChange={() => undefined} options={options} value="review" />,
    )
    expect(html).toContain('aria-haspopup="listbox"')
    expect(html).toContain('aria-label="审核状态"')
    expect(html).toContain('待确认')
    expect(html).not.toContain('<select')
  })

  it('navigates around disabled options and supports typeahead', () => {
    expect(getListboxNavigationIndex(options, 1, 1)).toBe(0)
    expect(getListboxNavigationIndex(options, 0, -1)).toBe(1)
    expect(getListboxNavigationIndex([{ value: 'x', label: '不可用', disabled: true }], -1, 1)).toBe(-1)
    expect(getListboxTypeaheadIndex(options, '待')).toBe(1)
    expect(getListboxTypeaheadIndex(options, '已')).toBe(-1)
  })

  it('keeps disabled options disabled and exposes a selected option check', () => {
    const html = renderToStaticMarkup(
      <ListboxSelect ariaLabel="审核状态" disabled onValueChange={() => undefined} options={options} value="review" />,
    )
    expect(html).toContain('disabled=""')
    const source = readFileSync(new URL('./ListboxSelect.tsx', import.meta.url), 'utf8')
    expect(source).toContain('aria-selected={value === option.value}')
    expect(source).toContain('ax-listbox__check')
    expect(source).toContain('<Icon name="check" size={16} />')
    expect(source).toContain('<Icon name="chevron" size={16} />')
    expect(source).not.toContain('✓')
    expect(source).not.toContain('⌄')
  })

  it('contains the keyboard, outside-click, and viewport repositioning hooks', () => {
    const source = readFileSync(new URL('./ListboxSelect.tsx', import.meta.url), 'utf8')
    expect(source).toContain("event.key === 'Escape'")
    expect(source).toContain("event.key === 'Home' || event.key === 'End'")
    expect(source).toContain("document.addEventListener('pointerdown'")
    expect(source).toContain("document.addEventListener('keydown', closeOnEscape)")
    expect(source).toContain("window.addEventListener('resize'")
    expect(source).toContain("window.addEventListener('scroll', onViewportChange, true)")
  })
})

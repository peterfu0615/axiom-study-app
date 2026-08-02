import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
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
})

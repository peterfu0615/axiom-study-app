import type { SelectOption } from './ListboxSelect'

export function getListboxNavigationIndex(
  options: SelectOption[],
  currentIndex: number,
  direction: 1 | -1,
) {
  if (!options.length) return -1
  let next = currentIndex
  for (let step = 0; step < options.length; step += 1) {
    next = (next + direction + options.length) % options.length
    if (!options[next]?.disabled) return next
  }
  return -1
}

export function getListboxTypeaheadIndex(
  options: SelectOption[],
  query: string,
  startIndex = -1,
) {
  const normalized = query.trim().toLocaleLowerCase('zh-CN')
  if (!normalized || !options.length) return -1
  for (let offset = 1; offset <= options.length; offset += 1) {
    const index = (startIndex + offset + options.length) % options.length
    const option = options[index]
    if (!option?.disabled && option.label.toLocaleLowerCase('zh-CN').startsWith(normalized)) {
      return index
    }
  }
  return -1
}

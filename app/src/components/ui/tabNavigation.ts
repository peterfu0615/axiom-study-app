export type TabNavigationKey = 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'End' | 'Home'

const tabNavigationKeys = new Set<string>(['ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'End', 'Home'])

export function isTabNavigationKey(key: string): key is TabNavigationKey {
  return tabNavigationKeys.has(key)
}

export function nextEnabledTabIndex(
  options: Array<{ disabled?: boolean }>,
  currentIndex: number,
  key: TabNavigationKey,
) {
  const enabledIndexes = options.flatMap((option, index) => option.disabled ? [] : [index])
  if (!enabledIndexes.length) return currentIndex
  if (key === 'Home') return enabledIndexes[0]
  if (key === 'End') return enabledIndexes[enabledIndexes.length - 1]

  const direction = key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 1
  const enabledPosition = enabledIndexes.indexOf(currentIndex)
  const startPosition = enabledPosition >= 0 ? enabledPosition : 0
  return enabledIndexes[(startPosition + direction + enabledIndexes.length) % enabledIndexes.length]
}

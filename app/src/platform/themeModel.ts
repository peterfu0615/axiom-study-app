export const APPEARANCE_STORAGE_KEY = 'axiom.appearance'
export const LEGACY_THEME_STORAGE_KEY = 'axiom.theme'
export const VISUAL_THEME_STORAGE_KEY = 'axiom.visual-theme'

export type Appearance = 'system' | 'light' | 'dark'
export type ResolvedAppearance = Exclude<Appearance, 'system'>

/**
 * 颜色主题：同一套布局与控件，只替换品牌主色与纸面色调。
 * axiom 为默认柠檬黄；其余主题均提供明暗两套调色板（见 index.css）。
 */
export type VisualTheme =
  | 'axiom'
  | 'sakura'
  | 'ocean'
  | 'forest'
  | 'violet'
  | 'ink'

export const VISUAL_THEME_LABELS: Record<VisualTheme, string> = {
  axiom: '柠檬黄',
  sakura: '樱花粉',
  ocean: '海蓝',
  forest: '森绿',
  violet: '紫藤',
  ink: '水墨灰',
}

export const VISUAL_THEMES = Object.keys(VISUAL_THEME_LABELS) as VisualTheme[]

/** 设置页色卡预览用的主题代表色（取自 index.css 的 --brand）。 */
export const VISUAL_THEME_SWATCHES: Record<VisualTheme, string> = {
  axiom: '#ffd50a',
  sakura: '#e05a7e',
  ocean: '#2563eb',
  forest: '#267a40',
  violet: '#6f4fce',
  ink: '#3a4552',
}

export function isAppearance(value: unknown): value is Appearance {
  return value === 'system' || value === 'light' || value === 'dark'
}

export function isVisualTheme(value: unknown): value is VisualTheme {
  return typeof value === 'string' && (VISUAL_THEMES as string[]).includes(value)
}

export function readAppearance(storage: Pick<Storage, 'getItem' | 'removeItem' | 'setItem'>): Appearance {
  const current = storage.getItem(APPEARANCE_STORAGE_KEY)
  if (isAppearance(current)) return current

  // Before 0.6 the appearance preference was incorrectly named "theme".
  // Migrate it once without changing what returning users see.
  const legacy = storage.getItem(LEGACY_THEME_STORAGE_KEY)
  if (isAppearance(legacy)) {
    storage.setItem(APPEARANCE_STORAGE_KEY, legacy)
    storage.removeItem(LEGACY_THEME_STORAGE_KEY)
    return legacy
  }
  return 'system'
}

export function readVisualTheme(storage: Pick<Storage, 'getItem'>): VisualTheme {
  const stored = storage.getItem(VISUAL_THEME_STORAGE_KEY)
  return isVisualTheme(stored) ? stored : 'axiom'
}

export function resolveAppearance(
  appearance: Appearance,
  systemAppearance: ResolvedAppearance,
): ResolvedAppearance {
  return appearance === 'system' ? systemAppearance : appearance
}

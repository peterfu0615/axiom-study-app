export const APPEARANCE_STORAGE_KEY = 'axiom.appearance'
export const LEGACY_THEME_STORAGE_KEY = 'axiom.theme'
export const VISUAL_THEME_STORAGE_KEY = 'axiom.visual-theme'

export type Appearance = 'system' | 'light' | 'dark'
export type ResolvedAppearance = Exclude<Appearance, 'system'>
export type VisualTheme = 'axiom'

export function isAppearance(value: unknown): value is Appearance {
  return value === 'system' || value === 'light' || value === 'dark'
}

export function isVisualTheme(value: unknown): value is VisualTheme {
  return value === 'axiom'
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

export function discreteSliderIndexFromPointer(
  clientX: number,
  left: number,
  width: number,
  optionCount: number,
) {
  if (optionCount <= 1) return 0
  const ratio = Math.min(1, Math.max(0, (clientX - left) / Math.max(1, width)))
  return Math.round(ratio * (optionCount - 1))
}

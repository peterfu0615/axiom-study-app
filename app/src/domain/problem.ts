import type { NormalizedRect } from './models'

export function isValidNormalizedRect(rect: NormalizedRect) {
  const { x, y, width, height } = rect
  return (
    [x, y, width, height].every(Number.isFinite) &&
    x >= 0 &&
    y >= 0 &&
    width > 0 &&
    height > 0 &&
    x + width <= 1.000001 &&
    y + height <= 1.000001
  )
}

export function isSameCropRect(
  left: NormalizedRect,
  right: NormalizedRect,
  tolerance = 0.0005,
) {
  return (
    Math.abs(left.x - right.x) <= tolerance &&
    Math.abs(left.y - right.y) <= tolerance &&
    Math.abs(left.width - right.width) <= tolerance &&
    Math.abs(left.height - right.height) <= tolerance
  )
}

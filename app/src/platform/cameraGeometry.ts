export type QuarterTurn = 0 | 90 | 180 | 270

export interface FrameDimensions {
  width: number
  height: number
}

export interface UncroppedFrame extends FrameDimensions {
  x: 0
  y: 0
}

export function normalizeQuarterTurn(angle: number): QuarterTurn {
  const normalized = ((Math.round(angle / 90) * 90) % 360 + 360) % 360
  return normalized as QuarterTurn
}

export function rotatedFrameDimensions(
  width: number,
  height: number,
  rotation: QuarterTurn,
): FrameDimensions {
  if (rotation === 90 || rotation === 270) {
    return { width: height, height: width }
  }
  return { width, height }
}

/**
 * Axiom intentionally accepts the camera's full 4:3 frame. This function is
 * separate from camera acquisition so a future aspect-ratio policy has one
 * isolated place to change. No source pixels are discarded.
 */
export function uncroppedFourThreeFrame(
  width: number,
  height: number,
): UncroppedFrame {
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    throw new Error('画面尺寸必须是有限数值')
  }
  if (width <= 0 || height <= 0) {
    throw new Error('画面尺寸必须大于 0')
  }
  return { x: 0, y: 0, width, height }
}

export function isFourThreeFrame(
  width: number,
  height: number,
  tolerance = 0.02,
) {
  const longEdge = Math.max(width, height)
  const shortEdge = Math.min(width, height)
  return Math.abs(longEdge / shortEdge - 4 / 3) <= tolerance
}

/**
 * Some Continuity Camera streams expose a landscape pixel buffer while the
 * RotationCoordinator initially reports 0°. Document capture defaults to
 * portrait in that ambiguous state; the UI still allows a manual quarter turn.
 */
export function resolveDocumentRotation(
  nativeAngle: number,
  bufferWidth: number,
  bufferHeight: number,
  isContinuityCamera: boolean,
): QuarterTurn {
  const nativeRotation = normalizeQuarterTurn(nativeAngle)
  if (
    isContinuityCamera &&
    nativeRotation === 0 &&
    bufferWidth > bufferHeight
  ) {
    return 90
  }
  return nativeRotation
}

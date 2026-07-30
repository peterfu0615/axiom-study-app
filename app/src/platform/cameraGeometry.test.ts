import { describe, expect, it } from 'vitest'
import {
  isFourThreeFrame,
  normalizeQuarterTurn,
  resolveDocumentRotation,
  rotatedFrameDimensions,
  uncroppedFourThreeFrame,
} from './cameraGeometry'

describe('camera geometry', () => {
  it('keeps every pixel of a 4032 × 3024 iPhone frame', () => {
    expect(uncroppedFourThreeFrame(4032, 3024)).toEqual({
      x: 0,
      y: 0,
      width: 4032,
      height: 3024,
    })
    expect(isFourThreeFrame(4032, 3024)).toBe(true)
  })

  it('does not crop even when a camera negotiates a nearby non-4:3 size', () => {
    expect(uncroppedFourThreeFrame(1920, 1080)).toEqual({
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
    })
  })

  it('swaps dimensions for portrait quarter turns', () => {
    expect(rotatedFrameDimensions(4032, 3024, 90)).toEqual({
      width: 3024,
      height: 4032,
    })
    expect(rotatedFrameDimensions(4032, 3024, 270)).toEqual({
      width: 3024,
      height: 4032,
    })
    expect(rotatedFrameDimensions(4032, 3024, 0)).toEqual({
      width: 4032,
      height: 3024,
    })
  })

  it('normalizes native angles to stable quarter turns', () => {
    expect(normalizeQuarterTurn(89.6)).toBe(90)
    expect(normalizeQuarterTurn(-90)).toBe(270)
    expect(normalizeQuarterTurn(360)).toBe(0)
  })

  it('normalizes an ambiguous Continuity Camera buffer to portrait', () => {
    expect(resolveDocumentRotation(0, 4032, 3024, true)).toBe(90)
    expect(resolveDocumentRotation(0, 1920, 1080, false)).toBe(0)
    expect(resolveDocumentRotation(270, 4032, 3024, true)).toBe(270)
  })
})

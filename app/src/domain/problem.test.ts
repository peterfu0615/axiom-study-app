import { describe, expect, it } from 'vitest'
import { isSameCropRect, isValidNormalizedRect } from './problem'

describe('isValidNormalizedRect', () => {
  it('accepts a finite region inside the page', () => {
    expect(
      isValidNormalizedRect({
        x: 0.08,
        y: 0.12,
        width: 0.84,
        height: 0.3,
      }),
    ).toBe(true)
  })

  it('rejects empty and out-of-page regions', () => {
    expect(
      isValidNormalizedRect({ x: 0.1, y: 0.1, width: 0, height: 0.3 }),
    ).toBe(false)
    expect(
      isValidNormalizedRect({ x: 0.8, y: 0.1, width: 0.3, height: 0.3 }),
    ).toBe(false)
  })
})

describe('isSameCropRect', () => {
  it('recognizes the same crop with insignificant floating-point drift', () => {
    expect(
      isSameCropRect(
        { x: 0.1, y: 0.2, width: 0.7, height: 0.3 },
        { x: 0.1001, y: 0.1999, width: 0.7001, height: 0.2999 },
      ),
    ).toBe(true)
  })

  it('keeps meaningfully different crops separate', () => {
    expect(
      isSameCropRect(
        { x: 0.1, y: 0.2, width: 0.7, height: 0.3 },
        { x: 0.1, y: 0.24, width: 0.7, height: 0.3 },
      ),
    ).toBe(false)
  })
})

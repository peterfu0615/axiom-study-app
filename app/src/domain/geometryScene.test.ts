import { describe, expect, it } from 'vitest'
import { layoutGeometryScene, normalizeGeometryScene } from './geometryScene'

const triangle = {
  points: [
    { id: 'A', label: 'A', x: 0.1, y: 0.8, source: 'stated', confidence: 0.99 },
    { id: 'B', label: 'B', x: 0.9, y: 0.8, source: 'stated', confidence: 0.99 },
    { id: 'C', label: 'C', x: 0.5, y: 0.1, source: 'stated', confidence: 0.99 },
  ],
  segments: [{ id: 'AB', from: 'A', to: 'B' }, { id: 'BC', from: 'B', to: 'C' }, { id: 'CA', from: 'C', to: 'A' }],
  constraints: [{ id: 'perp', type: 'perpendicular', entity_ids: ['AB', 'BC'], source: 'stated', evidence: 'AB⊥BC', confidence: 0.98 }],
  confidence: 0.93,
}

describe('GeometryScene contract', () => {
  it('validates references and keeps deterministic coordinates', () => {
    const result = normalizeGeometryScene(triangle)
    expect(result.valid).toBe(true)
    expect(layoutGeometryScene(result.scene).get('A')).toEqual({ x: 0.1, y: 0.8 })
  })

  it('rejects low-confidence scenes and unsupported visual guesses', () => {
    const result = normalizeGeometryScene({
      ...triangle,
      confidence: 0.4,
      constraints: [{ id: 'equal', type: 'equal_length', entity_ids: ['AB', 'missing'], source: 'visual', evidence: '', confidence: 0.3 }],
    })
    expect(result.valid).toBe(false)
    expect(result.errors.join(' ')).toContain('回退原图')
    expect(result.errors.join(' ')).toContain('无效对象')
  })
})

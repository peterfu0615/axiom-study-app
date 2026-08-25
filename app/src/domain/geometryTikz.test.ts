import { describe, expect, it } from 'vitest'
import { normalizeGeometryScene } from './geometryScene'
import { compileGeometrySceneToTikz } from './geometryTikz'

describe('GeometryScene to restricted TikZ compiler', () => {
  it('emits deterministic safe commands and a semantic contract', () => {
    const { scene, valid } = normalizeGeometryScene({
      version: 1,
      points: [
        { id: 'A', label: 'A', x: .1, y: .8, source: 'stated', confidence: 1 },
        { id: 'B', label: 'B', x: .9, y: .8, source: 'stated', confidence: 1 },
        { id: 'C', label: 'C', x: .5, y: .1, source: 'stated', confidence: 1 },
      ],
      segments: [
        { id: 'AB', from: 'A', to: 'B' },
        { id: 'AC', from: 'A', to: 'C' },
      ],
      rays: [], lines: [], circles: [], polygons: [],
      angle_markers: [{ id: 'angle-A', vertex: 'A', from: 'B', to: 'C', kind: 'right_angle' }],
      constraints: [{ id: 'perp', type: 'perpendicular', entity_ids: ['AB', 'AC'], source: 'stated', evidence: 'AB⊥AC', confidence: 1 }],
      confidence: .96, warnings: [],
    })
    expect(valid).toBe(true)
    const compiled = compileGeometrySceneToTikz(scene)
    expect(compiled.source).toContain('\\draw[axiomLine,axiomRightAngle]')
    expect(compiled.source).toContain('\\fill[axiomPoint]')
    expect(compiled.source).not.toContain('\\begin')
    expect(compiled.contract).toEqual({
      requiredLabels: ['A', 'B', 'C'],
      requiredRelations: ['perpendicular', 'right_angle'],
    })
  })

  it('sanitizes labels instead of allowing TeX commands', () => {
    const { scene } = normalizeGeometryScene({
      points: [
        { id: 'A', label: '\\input{x}', x: .1, y: .5, source: 'stated', confidence: 1 },
        { id: 'B', label: 'B', x: .9, y: .5, source: 'stated', confidence: 1 },
      ],
      segments: [{ id: 'AB', from: 'A', to: 'B' }], rays: [], lines: [], circles: [], polygons: [],
      angle_markers: [], constraints: [], confidence: .9, warnings: [],
    })
    const compiled = compileGeometrySceneToTikz(scene)
    expect(compiled.source).not.toContain('\\input')
    expect(compiled.contract.requiredLabels).toContain('inputx')
  })

  it('keeps lines near the construction and deduplicates polygon edges', () => {
    const { scene } = normalizeGeometryScene({
      points: [
        { id: 'A', label: 'A', x: .1, y: .8, source: 'stated', confidence: 1 },
        { id: 'B', label: 'B', x: .9, y: .8, source: 'stated', confidence: 1 },
        { id: 'C', label: 'C', x: .5, y: .1, source: 'stated', confidence: 1 },
      ],
      segments: [{ id: 'AB', from: 'A', to: 'B' }],
      rays: [],
      lines: [{ id: 'AC-line', from: 'A', to: 'C' }],
      circles: [],
      polygons: [{ id: 'ABC', points: ['A', 'B', 'C'] }],
      angle_markers: [], constraints: [], confidence: .9, warnings: [],
    })
    const compiled = compileGeometrySceneToTikz(scene)
    expect(compiled.source.match(/\\draw\[[^\]]*\][^;]+;/gu)).toHaveLength(4)
    const coordinates = [...compiled.source.matchAll(/\((-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)\)/gu)]
      .flatMap((match) => [Number(match[1]), Number(match[2])])
    expect(Math.max(...coordinates.map(Math.abs))).toBeLessThan(14)
  })
})

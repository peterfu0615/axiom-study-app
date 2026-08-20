import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { normalizeGeometryScene } from '../domain/geometryScene'
import { GeometrySceneView } from './GeometrySceneView'

describe('GeometrySceneView', () => {
  it('renders deterministic SVG primitives without injecting model markup', () => {
    const { scene } = normalizeGeometryScene({
      points: [
        { id: 'A', label: '<script>', x: 0.1, y: 0.8, source: 'stated', confidence: 1 },
        { id: 'B', label: 'B', x: 0.9, y: 0.8, source: 'stated', confidence: 1 },
      ],
      segments: [{ id: 'AB', from: 'A', to: 'B' }],
      confidence: 0.9,
    })
    const markup = renderToStaticMarkup(
      <GeometrySceneView fallback={<span>原图</span>} scene={scene} />,
    )
    expect(markup).toContain('<svg')
    expect(markup).toContain('<line')
    expect(markup).toContain('&lt;script&gt;')
    expect(markup).not.toContain('<script>')
  })

  it('uses the original-image fallback for low-confidence scenes', () => {
    const { scene } = normalizeGeometryScene({
      points: [
        { id: 'A', source: 'stated', confidence: 1 },
        { id: 'B', source: 'stated', confidence: 1 },
      ],
      confidence: 0.2,
    })
    expect(renderToStaticMarkup(
      <GeometrySceneView fallback={<span>原图回退</span>} scene={scene} />,
    )).toContain('原图回退')
  })
})

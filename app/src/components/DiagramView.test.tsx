import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Diagram } from '../domain/diagram'
import { DiagramView } from './DiagramView'

const diagram = (overrides: Partial<Diagram> = {}): Diagram => ({
  id: 'diagram-1', ownerType: 'practice_item', ownerId: 'item-1', sourceType: 'tikz',
  source: '\\draw (0,0)--(1,1);', renderStatus: 'rendered',
  renderedAssetPath: '/tmp/diagram.svg', renderedMimeType: 'image/svg+xml',
  renderHash: 'hash', rendererVersion: 'v1', renderErrorCode: null,
  renderErrorMessage: null, createdAt: 1, updatedAt: 1, ...overrides,
})

describe('DiagramView', () => {
  it('renders a persisted vector asset with accessible alternative text', () => {
    const html = renderToStaticMarkup(<DiagramView alt="三角形 ABC" diagram={diagram()} />)
    expect(html).toContain('alt="三角形 ABC"')
    expect(html).toContain('/tmp/diagram.svg')
    expect(html).toContain('矢量图形')
  })

  it('keeps a failed diagram visible as a safe fallback', () => {
    const html = renderToStaticMarkup(<DiagramView diagram={diagram({
      renderStatus: 'failed', renderedAssetPath: null, renderedMimeType: null,
      renderErrorCode: 'invalid_geometry', renderErrorMessage: '路径无效',
    })} />)
    expect(html).toContain('图形暂时无法生成')
    expect(html).toContain('路径无效')
    expect(html).not.toContain('<img')
  })
})

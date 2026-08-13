import { useState } from 'react'
import type { Diagram } from '../domain/diagram'
import { mediaAssetUrl } from '../platform/native'
import './DiagramView.css'

export function DiagramView({ diagram, alt = '题目图形' }: { diagram: Diagram; alt?: string }) {
  const [assetFailed, setAssetFailed] = useState(false)
  const canRender = diagram.renderStatus === 'rendered' && diagram.validationStatus === 'validated' && diagram.renderedAssetPath && !assetFailed
  return (
    <figure className="diagram-view" data-render-status={diagram.renderStatus}>
      {canRender ? (
        <img alt={alt} onError={() => setAssetFailed(true)} src={mediaAssetUrl(diagram.renderedAssetPath!)} />
      ) : (
        <div className="diagram-view__fallback" role="status">
          <span aria-hidden="true">△</span>
          <strong>图形暂时无法生成</strong>
          <small>{diagram.validationErrors[0] || diagram.renderErrorMessage || '可以稍后重新生成，题目内容不会丢失。'}</small>
        </div>
      )}
      <figcaption>{diagram.sourceType === 'tikz' ? '矢量图形' : '题目原图'}</figcaption>
    </figure>
  )
}

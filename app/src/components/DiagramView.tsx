import { useState, type KeyboardEvent } from 'react'
import type { Diagram } from '../domain/diagram'
import { mediaAssetUrl } from '../platform/native'
import './DiagramView.css'

export function DiagramView({
  diagram,
  alt = '题目图形',
  className = '',
  onActivate,
  showCaption = true,
}: {
  diagram: Diagram
  alt?: string
  className?: string
  onActivate?: () => void
  showCaption?: boolean
}) {
  const [assetFailed, setAssetFailed] = useState(false)
  const canRender = diagram.renderStatus === 'rendered' && diagram.validationStatus === 'validated' && diagram.renderedAssetPath && !assetFailed
  const activateWithKeyboard = (event: KeyboardEvent<HTMLElement>) => {
    if (!onActivate || (event.key !== 'Enter' && event.key !== ' ')) return
    event.preventDefault()
    onActivate()
  }
  return (
    <figure
      aria-label={onActivate ? `打开${alt}` : undefined}
      className={`diagram-view diagram-view--${diagram.sourceType}${onActivate ? ' diagram-view--interactive' : ''} ${className}`.trim()}
      data-render-status={diagram.renderStatus}
      onClick={onActivate}
      onKeyDown={activateWithKeyboard}
      role={onActivate ? 'button' : undefined}
      tabIndex={onActivate ? 0 : undefined}
    >
      {canRender ? (
        <img alt={alt} onError={() => setAssetFailed(true)} src={mediaAssetUrl(diagram.renderedAssetPath!)} />
      ) : (
        <div className="diagram-view__fallback" role="status">
          <span aria-hidden="true">△</span>
          <strong>图形暂时无法生成</strong>
          <small>原图仍可正常查看，也可以稍后重试。</small>
        </div>
      )}
      {showCaption && <figcaption>{diagram.sourceType === 'tikz' ? '矢量图形' : '题目原图'}</figcaption>}
    </figure>
  )
}

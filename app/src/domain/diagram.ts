export type DiagramOwnerType = 'problem' | 'practice_item'
export type DiagramSourceType = 'tikz' | 'image'
export type DiagramRenderStatus = 'pending' | 'rendered' | 'failed'

export interface Diagram {
  id: string
  ownerType: DiagramOwnerType
  ownerId: string
  sourceType: DiagramSourceType
  source: string
  renderStatus: DiagramRenderStatus
  renderedAssetPath: string | null
  renderedMimeType: string | null
  renderHash: string
  rendererVersion: string
  renderErrorCode: string | null
  renderErrorMessage: string | null
  createdAt: number
  updatedAt: number
}

export interface TikzRenderResult {
  renderStatus: Extract<DiagramRenderStatus, 'rendered' | 'failed'>
  renderedAssetPath: string | null
  renderedMimeType: 'image/svg+xml' | null
  renderHash: string
  rendererVersion: string
  cacheHit: boolean
  errorCode: string | null
  errorMessage: string | null
}

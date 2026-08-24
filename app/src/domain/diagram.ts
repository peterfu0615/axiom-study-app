export type DiagramOwnerType = 'problem' | 'practice_item'
export type DiagramSourceType = 'tikz' | 'image'
export type DiagramRenderStatus = 'pending' | 'rendered' | 'failed'
export type DiagramValidationStatus = 'unvalidated' | 'validated' | 'rejected'

export interface DiagramValidationContract {
  requiredLabels: string[]
  requiredRelations: Array<'parallel' | 'perpendicular' | 'equal_length' | 'tangent' | 'collinear' | 'right_angle'>
}

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
  validationStatus: DiagramValidationStatus
  validationErrors: string[]
  contract: DiagramValidationContract
  width: number | null
  height: number | null
  repairAttempts: number
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
  validationStatus: Extract<DiagramValidationStatus, 'validated' | 'rejected'>
  validationErrors: string[]
  width: number | null
  height: number | null
  aspectRatio: number | null
  inkCoverage: number | null
  errorCode: string | null
  errorMessage: string | null
}

export type PracticeAttemptStatus = 'capturing' | 'captured' | 'extracting' | 'extracted' | 'grading' | 'completed' | 'failed'
export type PracticeResponseStatus = 'captured' | 'extracting' | 'extracted' | 'corrected' | 'graded' | 'needs_review'

export interface PracticeCapturedResponse {
  regionId: string
  practiceItemId: string
  regionIndex: number
  answerAssetPath: string
  pixelWidth: number
  pixelHeight: number
  extractedAnswer?: import('./practiceGrading').StructuredStudentAnswer | null
  gradingResult?: import('./practiceGrading').PracticeGradingResult | null
}

export interface PracticeScanResult {
  practiceAttemptId: string
  practiceDocumentPageId: string
  pageIdentity: string
  qrPayload: string
  sourceAssetPath: string
  correctedAssetPath: string
  sourceWidth: number
  sourceHeight: number
  correctedWidth: number
  correctedHeight: number
  orientationDegrees: 0 | 90 | 180 | 270
  pageDetected: boolean
  detectionConfidence: number
  corners: Array<{ x: number; y: number }>
  stages: Array<'page_detection' | 'identity_recognition' | 'manual_layout_selection' | 'orientation' | 'perspective_correction' | 'layout_lookup' | 'answer_region_extraction' | 'per_item_crop'>
  responses: PracticeCapturedResponse[]
}

export interface PracticeScanPreview {
  matched: boolean
  message: string
  practiceDocumentPageId: string | null
  pageIndex: number | null
  orientationDegrees: 0 | 90 | 180 | 270
  confidence: number
  corners: Array<{ x: number; y: number }>
  answerRegions: Array<Array<{ x: number; y: number }>>
}

export interface PracticeAttempt {
  id: string
  practiceSetId: string
  status: PracticeAttemptStatus
  startedAt: number
  submittedAt: number | null
  correctedAssetPath: string
  orientationDegrees: number
  responses: PracticeCapturedResponse[]
  submissionAssets?: Array<{
    id: string
    sourceKind: 'image' | 'annotated_pdf' | 'camera_scan'
    originalAssetPath: string
    pageCount: number
    annotationsPreserved: boolean
  }>
}

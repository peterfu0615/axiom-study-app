export type SourceType = 'camera' | 'import' | 'clipboard'
export type ProcessingStatus =
  | 'captured'
  | 'preprocessing'
  | 'ready_for_segmentation'
  | 'failed'

export interface PersistedMedia {
  id: string
  path: string
  contentHash: string
  byteLength: number
  sourceType: SourceType
  capturedAt: number
}

export interface SourceDocument {
  id: string
  originalImagePath: string
  correctedImagePath: string | null
  contentHash: string
  sourceType: SourceType
  processingStatus: ProcessingStatus
  capturedAt: number
  createdAt: number
}

export interface NativeCapabilities {
  platform: string
  architecture: string
  cameraBackend: string
  minimumMacosVersion: string
  appDataDir: string
}

export interface CameraDevice {
  id: string
  label: string
}

export interface CameraOrientationInfo {
  deviceName: string
  isContinuityCamera: boolean
  previewRotationAngle: number
  captureRotationAngle: number
}

export interface NormalizedRect {
  x: number
  y: number
  width: number
  height: number
}

export interface Point {
  x: number
  y: number
}

export interface TextLine {
  id: string
  text: string
  confidence: number
  rect: NormalizedRect
}

export interface ProblemBlock {
  id: string
  title: string
  userTitle?: string | null
  rect: NormalizedRect
  confidence: number
  lineIds: string[]
  source: 'auto' | 'manual'
}

export type ProblemStatus = 'candidate' | 'saved'
export type ProblemVerificationStatus = 'unverified' | 'verified'
export type ProblemAIStatus =
  | 'not_started'
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'

export interface AIChoice {
  label: string
  text: string
}

export interface AISubQuestion {
  index: number
  content: string
}

export type AIDiagramKind =
  | 'geometry'
  | 'function'
  | 'chart'
  | 'table'
  | 'other'
  | 'unknown'

export interface AIProblemAnalysis {
  title: string
  subject: string
  problemType: string
  stemMarkdown: string
  choices: AIChoice[]
  subQuestions: AISubQuestion[]
  hasDiagram: boolean
  diagramKind: AIDiagramKind
  diagramBBox: NormalizedRect
  knowledgePoints: string[]
  confidence: number
  warnings: string[]
}

export type SolutionStatus =
  | 'not_started'
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'

export interface SolutionStep {
  index: number
  title: string
  contentMarkdown: string
}

export interface Solution {
  id: string
  problemId: string
  contentMarkdown: string
  steps: SolutionStep[]
  keyMethod: string | null
  usedFormulas: string[]
  knowledgePoints: string[]
  status: SolutionStatus
  activeModelRunId: string | null
  errorMessage: string | null
  createdAt: number
  updatedAt: number
}

export type GeneratedSolution = Pick<
  Solution,
  | 'contentMarkdown'
  | 'steps'
  | 'keyMethod'
  | 'usedFormulas'
  | 'knowledgePoints'
>

export interface SolutionInput {
  problemId: string
  cropImagePath: string
  subject: string
  problemType: string
  stemMarkdown: string
  choices: AIChoice[]
  subQuestions: AISubQuestion[]
  hasDiagram: boolean
  diagramKind: AIDiagramKind
  knowledgePoints: string[]
}

export type ProblemRegionType =
  | 'question'
  | 'answer'
  | 'diagram'
  | 'annotation'

export interface ProblemRegion {
  id: string
  problemId: string
  type: ProblemRegionType
  rect: NormalizedRect
  imagePath: string | null
  createdAt: number
  updatedAt: number
}

export interface StudentAttemptStep {
  index: number
  contentMarkdown: string
  confidence: number | null
}

export interface StudentAttempt {
  id: string
  problemId: string
  answerRegionIds: string[]
  rawMarkdown: string
  steps: StudentAttemptStep[]
  status: SolutionStatus
  activeModelRunId: string | null
  errorMessage: string | null
  createdAt: number
  updatedAt: number
}

export type ReasoningStepStatus =
  | 'correct'
  | 'wrong'
  | 'missing_reason'
  | 'unclear'

export type ReasoningErrorType =
  | 'concept_error'
  | 'calculation_error'
  | 'formula_error'
  | 'logic_gap'
  | 'reading_error'
  | 'incomplete_solution'
  | 'no_error'
  | 'unknown'

export interface ReasoningStepEvaluation {
  studentStepIndex: number
  status: ReasoningStepStatus
  comment: string
}

export interface ReasoningAnalysis {
  id: string
  problemId: string
  studentAttemptId: string
  solutionId: string | null
  approach: string | null
  stepEvaluations: ReasoningStepEvaluation[]
  firstWrongStep: number | null
  errorType: ReasoningErrorType | null
  reason: string | null
  knowledgeGaps: string[]
  suggestion: string | null
  status: SolutionStatus
  activeModelRunId: string | null
  errorMessage: string | null
  createdAt: number
  updatedAt: number
}

export type ExplainSelectionSource = 'solution' | 'student_attempt' | 'problem'

export interface ExplainSelectionInput {
  problemId: string
  cropImagePath: string
  source: ExplainSelectionSource
  selectedText: string
  problemContext: string
  currentStep: SolutionStep | StudentAttemptStep | null
  solutionContext: string
  studentAttemptContext: string
  knowledgePoints: string[]
}

export interface ExplainResult {
  explanationMarkdown: string
  keyPoint: string | null
  relatedKnowledgePoints: string[]
}

export interface ExplainProviderResult {
  result: ExplainResult
  rawOutput: string
  repairStrategy: string | null
}

export interface ProblemAnalysisInput extends AIProblemInput {
  questionImagePath: string
  diagramImagePaths: string[]
  answerImagePaths: string[]
  regionIds: string[]
}

export interface StudentAttemptInput {
  problemId: string
  answerImagePaths: string[]
  questionImagePath: string
  subject: string
  problemContext: string
  choices: AIChoice[]
  subQuestions: AISubQuestion[]
}

export interface ReasoningAnalysisInput {
  problemId: string
  cropImagePath: string
  problemContext: string
  studentAttempt: Pick<StudentAttempt, 'rawMarkdown' | 'steps'>
  solution: GeneratedSolution | null
  knowledgePoints: string[]
}

export interface ExplainSolutionStepInput {
  problemId: string
  solutionContentMarkdown: string
  step: SolutionStep
}

export interface AIProblemInput {
  problemId: string
  cropImagePath: string
  sourceDocumentCorrectedImagePath: string | null
  cropRect: NormalizedRect
}

export type ModelRunStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'

export interface ModelRun {
  id: string
  problemId: string
  taskType: IntelligenceTaskType
  provider: string
  model: string
  input: AIProblemInput
  output: AIProblemAnalysis | null
  rawOutput: string
  repairStrategy: string | null
  status: ModelRunStatus
  errorMessage: string | null
  createdAt: number
}

export interface SolutionModelRun {
  id: string
  problemId: string
  taskType: 'generate_solution'
  provider: string
  model: string
  input: SolutionInput
  output: Solution | null
  rawOutput: string
  repairStrategy: string | null
  status: ModelRunStatus
  errorMessage: string | null
  createdAt: number
}

export type IntelligenceTaskType =
  | 'analyze_problem_image'
  | 'generate_solution'
  | 'extract_student_attempt'
  | 'analyze_student_reasoning'
  | 'explain_selection'

export interface StudentAttemptModelRun {
  id: string
  problemId: string
  taskType: 'extract_student_attempt'
  provider: string
  model: string
  input: StudentAttemptInput
  output: StudentAttempt | null
  rawOutput: string
  repairStrategy: string | null
  status: ModelRunStatus
  errorMessage: string | null
  createdAt: number
}

export interface ReasoningModelRun {
  id: string
  problemId: string
  taskType: 'analyze_student_reasoning'
  provider: string
  model: string
  input: ReasoningAnalysisInput
  output: ReasoningAnalysis | null
  rawOutput: string
  repairStrategy: string | null
  status: ModelRunStatus
  errorMessage: string | null
  createdAt: number
}

export interface ExplainModelRun {
  id: string
  problemId: string
  taskType: 'explain_selection'
  provider: string
  model: string
  input: ExplainSelectionInput
  output: ExplainResult | null
  rawOutput: string
  repairStrategy: string | null
  status: ModelRunStatus
  errorMessage: string | null
  createdAt: number
}

export interface Problem {
  id: string
  sourceDocumentId: string
  cropRect: NormalizedRect
  cropImagePath: string | null
  ocrTitle: string
  ocrSubject: string | null
  ocrStemMarkdown: string | null
  subject: string | null
  title: string
  stemMarkdown: string | null
  userTitle: string | null
  userSubject: string | null
  userStemMarkdown: string | null
  userEditedAt: number | null
  aiStatus: ProblemAIStatus
  aiTitle: string | null
  aiSubject: string | null
  aiProblemType: string | null
  aiStemMarkdown: string | null
  aiChoices: AIChoice[]
  aiSubQuestions: AISubQuestion[]
  aiHasDiagram: boolean | null
  aiDiagramKind: AIDiagramKind | null
  aiDiagramBBox: NormalizedRect | null
  aiDiagramImagePath: string | null
  aiKnowledgePoints: string[]
  knowledgePoints: string[]
  userKnowledgePoints: string[] | null
  aiConfidence: number | null
  aiWarnings: string[]
  aiUpdatedAt: number | null
  aiActiveModelRunId: string | null
  status: ProblemStatus
  verificationStatus: ProblemVerificationStatus
  createdAt: number
  updatedAt: number
  archivedAt: number | null
  deletedAt: number | null
}

export interface SavedProblem extends Problem {
  cropImagePath: string
  originalImagePath: string
  correctedImagePath: string | null
}

export interface ProblemUserEdits {
  title: string
  subject: string
  stemMarkdown: string
  knowledgePoints: string[]
}

export type AIProviderKind =
  | 'mock'
  | 'openai_compatible'
  | 'antigravity_cli'

export interface AIProviderProfile {
  id: string
  name: string
  provider: AIProviderKind
  baseUrl: string
  /** API Key 输入值。保存时存入 Keychain，不持久化到数据库。
   * 读取后为空字符串（key 不回传前端）。仅用于 UI 输入和校验。 */
  apiKey: string
  /** Keychain 凭据引用（即 provider id）。空表示尚未保存到 Keychain。 */
  credentialRef: string
  commandPath: string
  model: string
  supportsVision: boolean
  supportsText: boolean
  enabled: boolean
  sortOrder: number
  createdAt: number
  updatedAt: number
}

export interface DocumentProcessingResult {
  processingRunId: string
  correctedPath: string
  width: number
  height: number
  pageDetected: boolean
  corners: Record<string, Point>
  textLines: TextLine[]
  blocks: ProblemBlock[]
  enhancementMode: 'color' | 'grayscale'
  warnings: string[]
  durationMs: number
}

export type CameraStatus =
  | 'idle'
  | 'requesting'
  | 'ready'
  | 'denied'
  | 'unavailable'
  | 'error'

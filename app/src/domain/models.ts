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

export interface CameraOrientationUpdate {
  watchId: string
  deviceName: string
  isContinuityCamera: boolean
  rotationAngle: number
}

export type DocumentProcessingStage =
  | 'starting'
  | 'detecting_page'
  | 'correcting_page'
  | 'corrected_ready'
  | 'recognizing_text'
  | 'generating_blocks'
  | 'completed'
  | 'failed'

export interface DocumentProcessingProgress {
  sourceDocumentId: string
  stage: DocumentProcessingStage
  correctedPath?: string
  width?: number
  height?: number
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

export type HorizonTagType = 'knowledge' | 'method' | 'model' | 'error'
export type HorizonTagRole = 'primary' | 'secondary'
export type DifficultyLevel = 'basic' | 'intermediate' | 'advanced'

export interface AITagCandidate {
  /** Optional controlled ID proposed by the model; always revalidated before persistence. */
  canonicalTagId?: string | null
  name: string
  role: HorizonTagRole
  evidence: string
  source: 'problem' | 'solution' | 'student_attempt' | 'textbook_hint'
}

export interface AIDifficulty {
  level: DifficultyLevel
  score: number | null
  reason: string
}

export interface AITextbookHint {
  title: string | null
  grade: string | null
  volume: string | null
  publisher: string | null
  edition: string | null
  evidence: string
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
  knowledgeTags?: AITagCandidate[]
  unresolvedKnowledgeCandidates?: AITagCandidate[]
  methodTags?: AITagCandidate[]
  modelTags?: AITagCandidate[]
  difficulty?: AIDifficulty | null
  errorCategories?: AITagCandidate[]
  textbookHint?: AITextbookHint | null
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
  source: 'manual' | 'auto'
  createdAt: number
  updatedAt: number
}

export interface StudentAttemptStep {
  index: number
  contentMarkdown: string
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
  usage?: AIUsageMetrics | null
}

/**
 * 用户已确认并锁定的教材上下文，仅用于附加到分析 prompt，
 * 帮助 AI 将 textbook_hint 与知识点命名对齐到该教材。
 */
export interface LockedTextbookContext {
  title: string
  subject: string
  grade: string | null
  volume: string | null
  publisher: string | null
  edition: string | null
}

export interface CanonicalKnowledgeCandidate {
  canonicalTagId: string
  canonicalName: string
  aliases: string[]
  knowledgeNodeId: string
  chapter: string | null
  hierarchyPath: string
  taxonomyVersion: number
  evidence: string | null
}

export interface ResolvedTextbookContext extends LockedTextbookContext {
  textbookId: string
  taxonomyVersion: number
  candidates: CanonicalKnowledgeCandidate[]
  totalKnowledgeCount: number
  candidateLimit: number
  contextCharacterCount: number
}

export interface ProblemAnalysisInput extends AIProblemInput {
  questionImagePath: string
  diagramImagePaths: string[]
  answerImagePaths: string[]
  regionIds: string[]
  /** Legacy metadata-only context retained for compatibility with older callers. */
  lockedTextbookContext?: LockedTextbookContext
  /** 分析前由服务层解析并限定到单本教材的受控知识候选上下文。 */
  resolvedTextbookContext?: ResolvedTextbookContext
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
  | 'cancelled'

export interface AIUsageMetrics {
  promptTokens: number | null
  completionTokens: number | null
  totalTokens: number | null
}

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
  error?: import('./aiError').AIErrorEnvelope | null
  latencyMs?: number | null
  usage?: AIUsageMetrics
  /** Estimated from the provider profile's user-supplied USD pricing. */
  estimatedCostUsd?: number | null
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
  subjectId: string | null
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
  matchedTextbookId: string | null
  textbookMatchConfidence: number
  textbookMatchReason: string | null
  textbookMatchSource: import('./problemTextbook').ProblemTextbookMatchSource
  textbookMatchLocked: boolean
  textbookMatchUpdatedAt: number | null
}

export interface SavedProblem extends Problem {
  cropImagePath: string
  originalImagePath: string
  correctedImagePath: string | null
  searchText: string
  libraryMetadata: {
    difficulty: DifficultyLevel | null
    textbookTitle: string | null
    chapters: string[]
    tags: Array<{ id: string | null; name: string; type: HorizonTagType }>
    masteryEstimate: number | null
    nextReviewAt: number | null
    confirmed: boolean
    favorite: boolean
    note: string
  }
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

export type AIProviderTaskType =
  | 'problem_understanding'
  | 'solution_generation'
  | 'solution_review'
  | 'attempt_analysis'
  | 'tag_mapping'
  | 'variant_planning'
  | 'variant_generation'
  | 'variant_verification'
  | 'submission_grading'
  | 'explain_selection'
  | 'textbook_recognition'
  | 'curriculum_analysis'
  | 'geometry_scene'

export interface AIProviderProfile {
  id: string
  name: string
  provider: AIProviderKind
  baseUrl: string
  /** API Key 输入值。仅承载本次编辑的新值，读取数据库时始终为空，
   * 防止完整密钥进入 React state、日志或截图。 */
  apiKey: string
  /** 是否已在本机 SQLite 中保存真实 API Key。 */
  hasApiKey: boolean
  /** 数据库安全派生的末尾掩码片段，例如 `abcd`，绝不是真实 Key。 */
  apiKeySuffix: string
  /** 历史 Keychain 凭据引用，仅用于一次性回迁兼容；不参与 AI 调用。 */
  credentialRef: string
  commandPath: string
  model: string
  /** Optional USD prices per one million tokens; null means unconfigured. */
  inputCostPerMillionUsd?: number | null
  outputCostPerMillionUsd?: number | null
  supportsVision: boolean
  supportsText: boolean
  /** Empty/omitted keeps backward-compatible capability-based routing. */
  taskTypes?: AIProviderTaskType[]
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

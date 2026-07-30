import type { ExplainSelectionInput, ReasoningAnalysisInput, StudentAttemptInput } from '../domain/models'

export const INTELLIGENCE_SCHEMA_VERSION = 'intelligence-v1'
export const STUDENT_ATTEMPT_SCHEMA_VERSION = 'student-attempt-v1'
export const REASONING_ANALYSIS_SCHEMA_VERSION = 'reasoning-analysis-v1'
export const EXPLAIN_SELECTION_SCHEMA_VERSION = 'explain-selection-v1'

export const STUDENT_ATTEMPT_PROMPT_VERSION = 'student-attempt-v1'
export const REASONING_ANALYSIS_PROMPT_VERSION = 'reasoning-analysis-v1'
export const EXPLAIN_SELECTION_PROMPT_VERSION = 'explain-selection-v1'

export interface StudentAttemptJSON {
  raw_markdown: string
  steps: Array<{
    index: number
    content_markdown: string
    confidence: number | null
  }>
}

export interface ReasoningAnalysisJSON {
  approach: string | null
  step_evaluations: Array<{
    student_step_index: number
    status: 'correct' | 'wrong' | 'missing_reason' | 'unclear'
    comment: string
  }>
  first_wrong_step: number | null
  error_type:
    | 'concept_error'
    | 'calculation_error'
    | 'formula_error'
    | 'logic_gap'
    | 'reading_error'
    | 'incomplete_solution'
    | 'no_error'
    | 'unknown'
    | null
  reason: string | null
  knowledge_gaps: string[]
  suggestion: string | null
}

export interface ExplainSelectionJSON {
  explanation_markdown: string
  key_point: string | null
  related_knowledge_points: string[]
}

export const studentAttemptJSONSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['raw_markdown', 'steps'],
  properties: {
    raw_markdown: { type: 'string' },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['index', 'content_markdown', 'confidence'],
        properties: {
          index: { type: 'integer', minimum: 1 },
          content_markdown: { type: 'string' },
          confidence: { type: ['number', 'null'], minimum: 0, maximum: 1 },
        },
      },
    },
  },
} as const

export const reasoningAnalysisJSONSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'approach',
    'step_evaluations',
    'first_wrong_step',
    'error_type',
    'reason',
    'knowledge_gaps',
    'suggestion',
  ],
  properties: {
    approach: { type: ['string', 'null'] },
    step_evaluations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['student_step_index', 'status', 'comment'],
        properties: {
          student_step_index: { type: 'integer', minimum: 1 },
          status: {
            enum: ['correct', 'wrong', 'missing_reason', 'unclear'],
          },
          comment: { type: 'string' },
        },
      },
    },
    first_wrong_step: { type: ['integer', 'null'], minimum: 1 },
    error_type: {
      type: ['string', 'null'],
      enum: [
        'concept_error',
        'calculation_error',
        'formula_error',
        'logic_gap',
        'reading_error',
        'incomplete_solution',
        'no_error',
        'unknown',
        null,
      ],
    },
    reason: { type: ['string', 'null'] },
    knowledge_gaps: { type: 'array', items: { type: 'string' } },
    suggestion: { type: ['string', 'null'] },
  },
} as const

export const explainSelectionJSONSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['explanation_markdown', 'key_point', 'related_knowledge_points'],
  properties: {
    explanation_markdown: { type: 'string', minLength: 1 },
    key_point: { type: ['string', 'null'] },
    related_knowledge_points: { type: 'array', items: { type: 'string' } },
  },
} as const

// Antigravity CLI does not accept nullable union types. These compatibility
// schemas preserve the object shape while the strict schemas above remain the
// source of truth for application-side Ajv validation.
export const studentAttemptAntigravityJSONSchema = {
  type: 'object',
  required: ['raw_markdown', 'steps'],
  properties: {
    raw_markdown: { type: 'string' },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        required: ['index', 'content_markdown', 'confidence'],
        properties: {
          index: { type: 'integer' },
          content_markdown: { type: 'string' },
          confidence: {},
        },
      },
    },
  },
} as const

export const reasoningAnalysisAntigravityJSONSchema = {
  type: 'object',
  required: [
    'approach',
    'step_evaluations',
    'first_wrong_step',
    'error_type',
    'reason',
    'knowledge_gaps',
    'suggestion',
  ],
  properties: {
    approach: {},
    step_evaluations: {
      type: 'array',
      items: {
        type: 'object',
        required: ['student_step_index', 'status', 'comment'],
        properties: {
          student_step_index: { type: 'integer' },
          status: {
            enum: ['correct', 'wrong', 'missing_reason', 'unclear'],
          },
          comment: { type: 'string' },
        },
      },
    },
    first_wrong_step: {},
    error_type: {},
    reason: {},
    knowledge_gaps: { type: 'array', items: { type: 'string' } },
    suggestion: {},
  },
} as const

export const explainSelectionAntigravityJSONSchema = {
  type: 'object',
  required: ['explanation_markdown', 'key_point', 'related_knowledge_points'],
  properties: {
    explanation_markdown: { type: 'string' },
    key_point: {},
    related_knowledge_points: {
      type: 'array',
      items: { type: 'string' },
    },
  },
} as const

export const STUDENT_ATTEMPT_PROMPT = String.raw`
你是中国中学数学手写答案 OCR 模型。只识别学生实际写下的内容，不判断答案是否正确。

只返回符合 JSON Schema 的 JSON 对象，不要代码围栏、前言或解释。公式必须使用 LaTeX Markdown；无法辨认的内容使用简短的 [?]，不得臆造。raw_markdown 保存完整答案，steps 按书写顺序拆分，index 从 1 连续递增，confidence 为 0 到 1 或 null。

若作答区域为空白或未检测到任何手写内容，仍必须返回符合 Schema 的 JSON：raw_markdown 设为 "未检测到作答内容"，steps 设为包含单个步骤的数组，其 index 为 1、content_markdown 为 "未检测到作答内容"、confidence 为 0。不得返回空字符串或空数组。
`.trim()

export const REASONING_ANALYSIS_PROMPT = String.raw`
你是中国中学数学解题过程分析模型。根据题目、学生步骤和可选标准解法，分析学生思路与每一步。

只返回符合 JSON Schema 的 JSON 对象，不要代码围栏或解释性文字。允许学生采用与标准解法不同但正确的方法，不得仅因表达不同判错。指出首个可确认问题；无法确认时使用 unclear/unknown。公式使用 LaTeX Markdown。

error_type 字段必须严格使用以下取值之一（不要使用其他名称、变体或中文）：
- "concept_error"      概念错误（用错定理、定义或基本概念）
- "calculation_error"  计算错误（算术运算失误）
- "formula_error"      公式错误（记错或套错公式）
- "logic_gap"          逻辑跳跃或缺步骤（推理链不完整）
- "reading_error"      审题错误（误读题意、漏条件）
- "incomplete_solution" 解答未完成（中途停笔）
- "no_error"           全部正确
- "unknown"            无法判定
- null                 无学生步骤可分析时使用
`.trim()

export const EXPLAIN_SELECTION_PROMPT = String.raw`
你是中国中学数学辅导模型。解释用户选中的题目或解答片段，帮助用户理解其含义、公式来源和推理作用。

只返回符合 JSON Schema 的 JSON 对象，不要代码围栏或解释性文字。使用简洁中文和 LaTeX Markdown；行内公式使用 $...$，独立公式使用 $$...$$。不要把“解释”擅自扩展成判错，除非输入明确要求；信息不足时如实说明限制。
`.trim()

export function buildStudentAttemptPrompt(input: StudentAttemptInput) {
  return `${STUDENT_ATTEMPT_PROMPT}\n\n<problem_json>\n${JSON.stringify({
    problemId: input.problemId,
    subject: input.subject,
    problemContext: input.problemContext,
    choices: input.choices,
    subQuestions: input.subQuestions,
  })}\n</problem_json>`
}

export function buildReasoningAnalysisPrompt(input: ReasoningAnalysisInput) {
  return `${REASONING_ANALYSIS_PROMPT}\n\n<input_json>\n${JSON.stringify(input)}\n</input_json>`
}

export function buildExplainSelectionPrompt(input: ExplainSelectionInput) {
  return `${EXPLAIN_SELECTION_PROMPT}\n\n<input_json>\n${JSON.stringify(input)}\n</input_json>`
}

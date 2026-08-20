import {
  gradingRequiresReview,
  type PracticeGradingResult,
  type PracticeTagEvidence,
  type PracticeTagEvidenceResult,
  type SubjectivePracticeGradingInput,
} from '../domain/practiceGrading'

export const SUBJECTIVE_PRACTICE_GRADING_SCHEMA_VERSION = 'practice-grading-v2-tag-evidence'
export const SUBJECTIVE_PRACTICE_GRADING_PROMPT_VERSION = 'practice-grading-v2-first-error'

const evidenceResultEnum = ['demonstrated', 'contradicted', 'insufficient'] as const

export const subjectivePracticeGradingJSONSchema = {
  type: 'object', additionalProperties: false,
  required: [
    'correctness', 'score', 'process_complete', 'first_error_step', 'error_category',
    'error_reason', 'correct_alternative_step', 'used_target_method',
    'applied_target_knowledge', 'matched_target_model', 'independent_completion',
    'used_hint', 'evidence', 'tag_evidence', 'bundle_evidence', 'explanation',
    'overall_confidence', 'needs_review',
  ],
  properties: {
    correctness: { type: 'string', enum: ['correct', 'incorrect', 'partial', 'needs_review'] },
    score: { type: ['number', 'null'], minimum: 0, maximum: 100 },
    process_complete: { type: 'boolean' },
    first_error_step: { type: ['integer', 'null'], minimum: 1 },
    error_category: { type: ['string', 'null'] },
    error_reason: { type: ['string', 'null'] },
    correct_alternative_step: { type: ['string', 'null'] },
    used_target_method: { type: ['boolean', 'null'] },
    applied_target_knowledge: { type: ['boolean', 'null'] },
    matched_target_model: { type: ['boolean', 'null'] },
    independent_completion: { type: 'boolean' },
    used_hint: { type: 'boolean' },
    evidence: { type: 'array', items: { type: 'string' } },
    tag_evidence: {
      type: 'array', items: {
        type: 'object', additionalProperties: false,
        required: ['tag_id', 'tag_type', 'result', 'confidence', 'evidence', 'weight'],
        properties: {
          tag_id: { type: 'string' },
          tag_type: { type: 'string', enum: ['knowledge', 'method', 'model'] },
          result: { type: 'string', enum: evidenceResultEnum },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          evidence: { type: 'string' },
          weight: { type: 'number', minimum: 0, maximum: 1.25 },
        },
      },
    },
    bundle_evidence: {
      type: 'object', additionalProperties: false,
      required: ['skill_bundle_id', 'result', 'transfer', 'difficulty', 'confidence'],
      properties: {
        skill_bundle_id: { type: ['string', 'null'] },
        result: { type: 'string', enum: evidenceResultEnum },
        transfer: { type: 'boolean' },
        difficulty: { type: 'string', enum: ['basic', 'intermediate', 'advanced'] },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
      },
    },
    explanation: { type: 'string' },
    overall_confidence: { type: 'number', minimum: 0, maximum: 1 },
    needs_review: { type: 'boolean' },
  },
} as const

export function buildSubjectivePracticeGradingPrompt(input: SubjectivePracticeGradingInput) {
  return `你是中国中学作业分步批改模型。此阶段只批改已经识别出的作答，不重新做 OCR，也不直接更新学习状态。
根据题目、标准解、评分 rubric、学生逐步作答和本题目标标签，定位首个错误步骤并为每个目标标签分别给出证据。允许不同但正确的方法；不能因为最终计算错误而否定此前已正确证明的方法、知识或题型模型。

硬约束：
1. tag_evidence 必须且只能覆盖输入 targetTags 中具有非空 id 且 type 为 knowledge/method/model 的标签，tag_id 与 tag_type 原样返回，不得创造或跨科目补全标签。
2. demonstrated 表示作答中有明确正面证据；contradicted 表示作答明确违反该标签；insufficient 表示证据不足。只有最终答案、无过程时，方法和模型通常为 insufficient。
3. first_error_step 是学生步骤 index，不存在首错时为 null；错误时同时说明 error_reason 和 correct_alternative_step。
4. confidence 是本次具体判断的可验证程度，不是模型正确率。低于 0.72 或无法稳定判断时 needs_review 必须为 true。
5. 使用提示、非独立完成或过程不完整时降低 weight；变式题且独立完成可将 transfer 设为 true。
6. used_hint 以输入值为准，不得猜测。
7. 不输出题目或作答之外的敏感信息。只返回符合 JSON Schema 的 JSON，不要代码围栏。

<grading_input>
${JSON.stringify(input)}
</grading_input>`
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} 不是对象`)
  return value as Record<string, unknown>
}

function nullableString(value: unknown, name: string) {
  if (value === null) return null
  if (typeof value !== 'string') throw new Error(`${name} 类型无效`)
  return value
}

function nullableBoolean(value: unknown, name: string) {
  if (value === null) return null
  if (typeof value !== 'boolean') throw new Error(`${name} 类型无效`)
  return value
}

function confidence(value: unknown, name: string, maximum = 1) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > maximum) {
    throw new Error(`${name} 超出范围`)
  }
  return value
}

function parseTagEvidence(value: unknown): PracticeTagEvidence {
  const entry = record(value, 'tag_evidence')
  if (typeof entry.tag_id !== 'string' || !entry.tag_id
    || !['knowledge', 'method', 'model'].includes(String(entry.tag_type))
    || !evidenceResultEnum.includes(entry.result as PracticeTagEvidenceResult)
    || typeof entry.evidence !== 'string' || !entry.evidence.trim()) {
    throw new Error('tag_evidence 不符合结构化契约')
  }
  return {
    tagId: entry.tag_id,
    tagType: entry.tag_type as PracticeTagEvidence['tagType'],
    result: entry.result as PracticeTagEvidenceResult,
    confidence: confidence(entry.confidence, 'tag_evidence.confidence'),
    evidence: entry.evidence,
    weight: confidence(entry.weight, 'tag_evidence.weight', 1.25),
  }
}

export function parseSubjectivePracticeGrading(raw: string, input?: SubjectivePracticeGradingInput): PracticeGradingResult {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const value = record(JSON.parse(cleaned), 'grading')
  const correctness = value.correctness
  if (!['correct', 'incorrect', 'partial', 'needs_review'].includes(String(correctness))
    || (value.score !== null && (typeof value.score !== 'number' || value.score < 0 || value.score > 100))
    || typeof value.process_complete !== 'boolean'
    || (value.first_error_step !== null && (!Number.isInteger(value.first_error_step) || Number(value.first_error_step) < 1))
    || typeof value.independent_completion !== 'boolean' || typeof value.used_hint !== 'boolean'
    || !Array.isArray(value.evidence) || !value.evidence.every((entry) => typeof entry === 'string')
    || !Array.isArray(value.tag_evidence) || typeof value.explanation !== 'string'
    || typeof value.needs_review !== 'boolean') throw new Error('主观题批改结果不符合结构化契约')

  const tagEvidence = value.tag_evidence.map(parseTagEvidence)
  if (input) {
    const expected = input.targetTags.flatMap((tag) => tag.id && tag.type !== 'error' ? [`${tag.type}:${tag.id}`] : []).sort()
    const actual = tagEvidence.map((entry) => `${entry.tagType}:${entry.tagId}`).sort()
    if (new Set(actual).size !== actual.length || JSON.stringify(expected) !== JSON.stringify(actual)) {
      throw new Error('主观题批改未完整覆盖本题目标标签')
    }
    if (value.used_hint !== input.usedHint) throw new Error('主观题批改擅自改变了提示使用状态')
  }

  const bundle = record(value.bundle_evidence, 'bundle_evidence')
  if ((bundle.skill_bundle_id !== null && typeof bundle.skill_bundle_id !== 'string')
    || !evidenceResultEnum.includes(bundle.result as PracticeTagEvidenceResult)
    || typeof bundle.transfer !== 'boolean'
    || !['basic', 'intermediate', 'advanced'].includes(String(bundle.difficulty))) {
    throw new Error('bundle_evidence 不符合结构化契约')
  }
  if (input && (bundle.skill_bundle_id !== input.skillBundleId || bundle.difficulty !== input.difficulty)) {
    throw new Error('主观题批改的能力组合或难度与题目快照不一致')
  }

  const grading: PracticeGradingResult = {
    modelRunId: null,
    correctness: correctness as PracticeGradingResult['correctness'], score: value.score as number | null,
    method: 'subjective_ai', processComplete: value.process_complete,
    firstErrorStep: value.first_error_step as number | null,
    errorCategory: nullableString(value.error_category, 'error_category'),
    errorReason: nullableString(value.error_reason, 'error_reason'),
    correctAlternativeStep: nullableString(value.correct_alternative_step, 'correct_alternative_step'),
    usedTargetMethod: nullableBoolean(value.used_target_method, 'used_target_method'),
    appliedTargetKnowledge: nullableBoolean(value.applied_target_knowledge, 'applied_target_knowledge'),
    matchedTargetModel: nullableBoolean(value.matched_target_model, 'matched_target_model'),
    independentCompletion: value.independent_completion,
    usedHint: value.used_hint,
    evidence: value.evidence as string[], tagEvidence,
    bundleEvidence: {
      skillBundleId: bundle.skill_bundle_id as string | null,
      result: bundle.result as PracticeTagEvidenceResult,
      transfer: bundle.transfer,
      difficulty: bundle.difficulty as PracticeGradingResult['bundleEvidence']['difficulty'],
      confidence: confidence(bundle.confidence, 'bundle_evidence.confidence'),
    },
    explanation: value.explanation,
    overallConfidence: confidence(value.overall_confidence, 'overall_confidence'),
    requiresReview: false, userConfirmed: false,
  }
  grading.requiresReview = Boolean(value.needs_review) || gradingRequiresReview(grading)
  return grading
}

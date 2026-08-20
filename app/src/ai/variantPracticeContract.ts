import type {
  PracticeVariantCandidate,
  PracticeVariantGenerationInput,
  PracticeVariantVerification,
  PracticeVariantVerificationInput,
  VariantChangeKind,
} from '../domain/variantPractice'

const difficulties = ['basic', 'intermediate', 'advanced'] as const
const changeKinds: VariantChangeKind[] = [
  'numeric_values', 'symbols_or_names', 'narrative_order', 'real_world_context',
  'diagram_orientation', 'nonessential_distractor', 'known_condition',
]

const solutionSchema = {
  type: 'object', additionalProperties: false,
  required: ['content_markdown', 'steps'],
  properties: {
    content_markdown: { type: 'string' },
    steps: { type: 'array', items: { type: 'string' } },
  },
} as const

export const practiceVariantGenerationJSONSchema = {
  type: 'object', additionalProperties: false,
  required: ['subject', 'statement_markdown', 'options', 'canonical_answer', 'solution', 'difficulty', 'target_tag_ids', 'changes', 'diagram_policy'],
  properties: {
    subject: { type: 'string' },
    statement_markdown: { type: 'string' },
    options: { anyOf: [{ type: 'null' }, { type: 'array', minItems: 2, items: { type: 'string' } }] },
    canonical_answer: { type: 'string' },
    solution: solutionSchema,
    difficulty: { type: 'string', enum: difficulties },
    target_tag_ids: { type: 'array', items: { type: 'string' } },
    changes: {
      type: 'array', minItems: 1,
      items: {
        type: 'object', additionalProperties: false, required: ['kind', 'summary'],
        properties: { kind: { type: 'string', enum: changeKinds }, summary: { type: 'string' } },
      },
    },
    diagram_policy: { type: 'string', enum: ['none', 'preserved'] },
  },
} as const

export const practiceVariantVerificationJSONSchema = {
  type: 'object', additionalProperties: false,
  required: [
    'independent_answer', 'independent_solution', 'condition_complete', 'unique_answer',
    'preserves_core_knowledge', 'preserves_core_method', 'preserves_core_model',
    'target_tag_ids', 'difficulty', 'diagram_compatible', 'uses_out_of_scope_knowledge', 'notes',
  ],
  properties: {
    independent_answer: { type: 'string' },
    independent_solution: solutionSchema,
    condition_complete: { type: 'boolean' },
    unique_answer: { type: 'boolean' },
    preserves_core_knowledge: { type: 'boolean' },
    preserves_core_method: { type: 'boolean' },
    preserves_core_model: { type: 'boolean' },
    target_tag_ids: { type: 'array', items: { type: 'string' } },
    difficulty: { type: 'string', enum: difficulties },
    diagram_compatible: { type: 'boolean' },
    uses_out_of_scope_knowledge: { type: 'boolean' },
    notes: { type: 'array', items: { type: 'string' } },
  },
} as const

function cleanJSON(raw: string) {
  return raw.trim().replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '')
}

function string(value: unknown, field: string) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`变式结果缺少 ${field}`)
  return value.trim()
}

function strings(value: unknown, field: string) {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) throw new Error(`变式结果的 ${field} 格式错误`)
  return value.map((item) => item.trim()).filter(Boolean)
}

function solutionJson(value: unknown) {
  if (!value || typeof value !== 'object') throw new Error('变式结果缺少结构化解析')
  const record = value as Record<string, unknown>
  const contentMarkdown = typeof record.content_markdown === 'string' ? record.content_markdown.trim() : ''
  const steps = strings(record.steps, 'solution.steps').map((content, index) => ({ index: index + 1, contentMarkdown: content }))
  if (!contentMarkdown && !steps.length) throw new Error('变式解析内容为空')
  return JSON.stringify({ contentMarkdown, steps })
}

function bool(value: unknown, field: string) {
  if (typeof value !== 'boolean') throw new Error(`变式验证的 ${field} 格式错误`)
  return value
}

export function buildPracticeVariantGenerationPrompt(input: PracticeVariantGenerationInput) {
  return `你是中国中学受约束变式题生成器。生成一道新题以检验迁移能力，不得只是复制或改写标点。
必须严格保持 plan.invariants 中的科目、核心知识点、核心方法、题型模型、难度和必要步骤；只能使用 allowedChanges，绝不能使用 forbiddenChanges。
若原题有图，diagram_policy 必须是 preserved，题干变化不得使原图条件失效；否则使用 none。
选择题 canonical_answer 必须是 options 数组中的完整选项文本。数学内容使用 Markdown/LaTeX。只返回符合 JSON Schema 的 JSON。

<variant_generation_input>
${JSON.stringify(input)}
</variant_generation_input>`
}

export function buildPracticeVariantVerificationPrompt(input: PracticeVariantVerificationInput) {
  const candidateWithoutAnswer = {
    subject: input.candidate.subject,
    statementMarkdown: input.candidate.statementMarkdown,
    options: input.candidate.options,
    difficulty: input.candidate.difficulty,
    targetTagIds: input.candidate.targetTagIds,
    changes: input.candidate.changes,
    diagramPolicy: input.candidate.diagramPolicy,
  }
  return `你是与出题阶段独立的中国中学题目审校器。请从题干重新求解，不要接受或猜测出题器的答案。
检查条件是否完整、答案是否唯一、核心知识/方法/模型是否保持、难度是否匹配、图形是否仍兼容、是否使用教材范围外知识，并重新映射目标标签。
只返回符合 JSON Schema 的 JSON。

<variant_plan>
${JSON.stringify(input.plan)}
</variant_plan>
<candidate_without_answer>
${JSON.stringify(candidateWithoutAnswer)}
</candidate_without_answer>`
}

export function parsePracticeVariantCandidate(raw: string): PracticeVariantCandidate {
  const value = JSON.parse(cleanJSON(raw)) as Record<string, unknown>
  const difficulty = string(value.difficulty, 'difficulty')
  if (!difficulties.includes(difficulty as typeof difficulties[number])) throw new Error('变式难度不在受控枚举中')
  const options = value.options === null ? null : strings(value.options, 'options')
  if (options && options.length < 2) throw new Error('变式选择题选项不足')
  if (!Array.isArray(value.changes)) throw new Error('变式结果缺少变化说明')
  const changes = value.changes.map((entry) => {
    if (!entry || typeof entry !== 'object') throw new Error('变式变化说明格式错误')
    const record = entry as Record<string, unknown>
    const kind = string(record.kind, 'changes.kind') as VariantChangeKind
    if (!changeKinds.includes(kind)) throw new Error('变式包含未允许的变化类型')
    return { kind, summary: string(record.summary, 'changes.summary') }
  })
  const diagramPolicy = string(value.diagram_policy, 'diagram_policy')
  if (diagramPolicy !== 'none' && diagramPolicy !== 'preserved') throw new Error('变式图形策略无效')
  return {
    subject: string(value.subject, 'subject'),
    statementMarkdown: string(value.statement_markdown, 'statement_markdown'),
    options,
    canonicalAnswer: string(value.canonical_answer, 'canonical_answer'),
    solutionJson: solutionJson(value.solution),
    difficulty: difficulty as PracticeVariantCandidate['difficulty'],
    targetTagIds: strings(value.target_tag_ids, 'target_tag_ids'),
    changes,
    diagramPolicy,
  }
}

export function parsePracticeVariantVerification(raw: string): PracticeVariantVerification {
  const value = JSON.parse(cleanJSON(raw)) as Record<string, unknown>
  const difficulty = string(value.difficulty, 'difficulty')
  if (!difficulties.includes(difficulty as typeof difficulties[number])) throw new Error('变式审校难度不在受控枚举中')
  return {
    independentAnswer: string(value.independent_answer, 'independent_answer'),
    independentSolutionJson: solutionJson(value.independent_solution),
    conditionComplete: bool(value.condition_complete, 'condition_complete'),
    uniqueAnswer: bool(value.unique_answer, 'unique_answer'),
    preservesCoreKnowledge: bool(value.preserves_core_knowledge, 'preserves_core_knowledge'),
    preservesCoreMethod: bool(value.preserves_core_method, 'preserves_core_method'),
    preservesCoreModel: bool(value.preserves_core_model, 'preserves_core_model'),
    targetTagIds: strings(value.target_tag_ids, 'target_tag_ids'),
    difficulty: difficulty as PracticeVariantVerification['difficulty'],
    diagramCompatible: bool(value.diagram_compatible, 'diagram_compatible'),
    usesOutOfScopeKnowledge: bool(value.uses_out_of_scope_knowledge, 'uses_out_of_scope_knowledge'),
    notes: strings(value.notes, 'notes'),
  }
}

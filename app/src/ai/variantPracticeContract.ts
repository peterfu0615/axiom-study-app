import type {
  PracticeVariantCandidate,
  PracticeVariantGenerationInput,
  PracticeVariantVerification,
  PracticeVariantVerificationInput,
  VariantChangeKind,
} from '../domain/variantPractice'
import { normalizeGeometryScene } from '../domain/geometryScene'
import { geometrySceneJSONSchema } from './geometrySceneContract'

const { $defs: geometrySceneDefinitions, ...geometrySceneShape } = geometrySceneJSONSchema

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
  required: ['subject', 'statement_markdown', 'options', 'canonical_answer', 'solution', 'difficulty', 'target_tag_ids', 'changes', 'diagram_policy', 'geometry_scene'],
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
    diagram_policy: { type: 'string', enum: ['none', 'preserved', 'generated'] },
    geometry_scene: { anyOf: [{ type: 'null' }, geometrySceneShape] },
  },
  $defs: geometrySceneDefinitions,
} as const

export const practiceVariantVerificationJSONSchema = {
  type: 'object', additionalProperties: false,
  required: [
    'independent_answer', 'independent_solution', 'condition_complete', 'unique_answer',
    'preserves_core_knowledge', 'preserves_core_method', 'preserves_core_model',
    'target_tag_ids', 'difficulty', 'diagram_compatible', 'uses_out_of_scope_knowledge', 'required_step_coverage', 'notes',
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
    required_step_coverage: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['step', 'covered', 'evidence'],
        properties: { step: { type: 'string' }, covered: { type: 'boolean' }, evidence: { type: 'string' } },
      },
    },
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
  const promptInput = {
    plan: input.plan,
    source: {
      statementMarkdown: input.source.statementMarkdown,
      options: input.source.options,
      canonicalAnswer: input.source.canonicalAnswer,
      solutionJson: input.source.solutionJson,
      hasQuestionImage: Boolean(input.source.questionImagePath),
      hasDiagramImages: input.source.diagramImagePaths.length > 0,
    },
  }
  return `你是中国中学受约束变式题生成器。生成一道新题以检验迁移能力，不得只是复制或改写标点。
必须严格保持原题可确定的科目、核心知识、核心方法、题型模型和目标难度；只能使用 allowedChanges，绝不能使用 forbiddenChanges。plan.invariants 中的标签、答案或步骤可能为空，这表示用户尚未整理这些字段，不表示原题没有对应知识或解法。此时先根据题干、选项和题图独立理解原题，再生成变式，不得要求用户补字段，也不得凭空补造原题中无法确定的条件。
变化等级必须服从 plan.variationLevel：numeric 只改变数字、符号、名称或非关键干扰项；condition 可替换、增减或重组已知条件与数据，但必须保持结论、核心知识和解法，禁止条件与结论互换；rebuild 可更换情境、叙述和图形表现，但仍须保持知识、方法、题型模型与目标难度。
若原题有图且变化后仍完全兼容，diagram_policy 使用 preserved；若改变朝向、标签、数值或关系，必须使用 generated 并返回受控 GeometryScene；无图使用 none。
选择题 canonical_answer 必须是 options 数组中的完整选项文本。数学内容使用 Markdown/LaTeX。只返回符合 JSON Schema 的 JSON。

<variant_generation_input>
${JSON.stringify(promptInput)}
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
    geometryScene: input.candidate.geometryScene ?? null,
  }
  return `你是与出题阶段独立的中国中学题目审校器。请从题干重新求解，不要接受或猜测出题器的答案。
检查条件是否完整、答案是否唯一、核心知识/方法/模型是否保持、难度是否匹配、图形是否仍兼容、是否使用教材范围外知识，并重新映射目标标签。对 plan.invariants.requiredSteps 中每一项原文逐项返回覆盖结论和候选解答中的证据。
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
  if (diagramPolicy !== 'none' && diagramPolicy !== 'preserved' && diagramPolicy !== 'generated') throw new Error('变式图形策略无效')
  const geometryScene = value.geometry_scene == null ? null : normalizeGeometryScene(value.geometry_scene)
  if (diagramPolicy === 'generated' && (!geometryScene || !geometryScene.valid)) throw new Error('变式几何场景无效')
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
    geometryScene: geometryScene?.scene ?? null,
  }
}

export function parsePracticeVariantVerification(raw: string): PracticeVariantVerification {
  const value = JSON.parse(cleanJSON(raw)) as Record<string, unknown>
  const difficulty = string(value.difficulty, 'difficulty')
  if (!difficulties.includes(difficulty as typeof difficulties[number])) throw new Error('变式审校难度不在受控枚举中')
  if (!Array.isArray(value.required_step_coverage)) throw new Error('变式审校缺少必要步骤覆盖结果')
  const requiredStepCoverage = value.required_step_coverage.map((entry) => {
    if (!entry || typeof entry !== 'object') throw new Error('必要步骤覆盖结果格式错误')
    const record = entry as Record<string, unknown>
    return { step: string(record.step, 'required_step_coverage.step'), covered: bool(record.covered, 'required_step_coverage.covered'), evidence: string(record.evidence, 'required_step_coverage.evidence') }
  })
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
    requiredStepCoverage,
    notes: strings(value.notes, 'notes'),
  }
}

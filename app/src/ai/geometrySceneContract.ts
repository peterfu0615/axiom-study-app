import { normalizeGeometryScene, type GeometrySceneInput } from '../domain/geometryScene'

export const GEOMETRY_SCENE_PROMPT_VERSION = 'geometry-scene-v2'
export const GEOMETRY_SCENE_SCHEMA_VERSION = 'geometry-scene-schema-v1'

export const geometrySceneJSONSchema = {
  type: 'object', additionalProperties: false,
  required: ['points', 'segments', 'rays', 'lines', 'circles', 'polygons', 'angle_markers', 'constraints', 'confidence', 'warnings'],
  properties: {
    points: { type: 'array', maxItems: 64, items: { type: 'object', additionalProperties: false, required: ['id', 'label', 'x', 'y', 'relative_position', 'source', 'confidence'], properties: {
      id: { type: 'string' }, label: { type: ['string', 'null'] }, x: { type: ['number', 'null'] }, y: { type: ['number', 'null'] },
      relative_position: { type: ['string', 'null'] }, source: { type: 'string', enum: ['stated', 'derived'] }, confidence: { type: 'number' },
    } } },
    segments: { $ref: '#/$defs/linearEntities' }, rays: { $ref: '#/$defs/linearEntities' }, lines: { $ref: '#/$defs/linearEntities' },
    circles: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'center', 'through'], properties: { id: { type: 'string' }, center: { type: 'string' }, through: { type: 'string' } } } },
    polygons: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'points'], properties: { id: { type: 'string' }, points: { type: 'array', items: { type: 'string' } } } } },
    angle_markers: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'vertex', 'from', 'to', 'kind'], properties: { id: { type: 'string' }, vertex: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' }, kind: { type: 'string', enum: ['arc', 'right_angle'] } } } },
    constraints: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'type', 'entity_ids', 'source', 'evidence', 'confidence'], properties: {
      id: { type: 'string' }, type: { type: 'string', enum: ['parallel', 'perpendicular', 'equal_length', 'tangent', 'collinear'] },
      entity_ids: { type: 'array', items: { type: 'string' } }, source: { type: 'string', enum: ['stated', 'derived'] }, evidence: { type: 'string' }, confidence: { type: 'number' },
    } } },
    confidence: { type: 'number' }, warnings: { type: 'array', items: { type: 'string' } },
  },
  $defs: { linearEntities: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'from', 'to'], properties: { id: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' } } } } },
} as const

export const GEOMETRY_SCENE_PROMPT = `你是 Axiom 的平面几何场景提取器。结合题图、题干和已完成正解，输出忠实、可读的 GeometryScene JSON。
题图是布局与拓扑的第一依据：保持原图的整体横纵比例、顶点相对位置、线段连接、交点、内外关系和标签所在方位。不要把宽图压成窄图，也不要为了对称或美观移动点。坐标覆盖 0..1 中尽可能大的有效区域，并为点名留出空间。
逐条检查可见边，只描述真实存在的连接；同一条边不要同时重复为 polygon 边界和 segment。交叉但不相连的线不得虚构交点，已有交点必须建成共享 point。
视觉比例不是数学条件：不得因为“看起来相等、平行、垂直或相切”创建约束。每个约束必须带 stated 或 derived 来源及简短题面证据。
正解可以帮助确认题干蕴含的关系，但只能由正解推导出的点或约束必须标为 derived；题图或题干直接给出的标为 stated。坐标只用于相对布局，归一化到 0..1；无法可靠判断时填 null。复杂手绘图、立体几何、标签不可读或整体置信度不足时，将 confidence 设为低于 0.70 并写入 warnings，让客户端回退原图。
禁止输出 SVG、TikZ、TeX、Markdown 或任何可执行内容。`

export function buildGeometryScenePrompt(input: GeometrySceneInput) {
  return `${GEOMETRY_SCENE_PROMPT}\n\n<geometry_context_json>\n${JSON.stringify({
    stem: input.stemMarkdown,
    choices: input.choices,
    sub_questions: input.subQuestions,
    completed_solution: {
      content_markdown: input.solutionContentMarkdown,
      steps: input.solutionSteps,
      key_method: input.keyMethod,
      used_formulas: input.usedFormulas,
    },
  })}\n</geometry_context_json>\n视觉可直接确认的事实标为 stated；只能由正解推导出的关系标为 derived，并在 evidence 中写明推导依据。`
}

export function parseGeometryScene(rawOutput: string) {
  const parsed = JSON.parse(rawOutput) as unknown
  const validation = normalizeGeometryScene(parsed)
  return validation
}

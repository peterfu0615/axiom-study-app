export type GeometryEvidenceSource = 'stated' | 'derived'
export type GeometryConstraintType =
  | 'parallel'
  | 'perpendicular'
  | 'equal_length'
  | 'tangent'
  | 'collinear'

export interface GeometryPoint {
  id: string
  label: string | null
  x: number | null
  y: number | null
  relativePosition: string | null
  source: GeometryEvidenceSource
  confidence: number
}

export interface GeometryLinearEntity {
  id: string
  from: string
  to: string
}

export interface GeometryCircle {
  id: string
  center: string
  through: string
}

export interface GeometryPolygon {
  id: string
  points: string[]
}

export interface GeometryAngleMarker {
  id: string
  vertex: string
  from: string
  to: string
  kind: 'arc' | 'right_angle'
}

export interface GeometryConstraint {
  id: string
  type: GeometryConstraintType
  entityIds: string[]
  source: GeometryEvidenceSource
  evidence: string
  confidence: number
}

export interface GeometryScene {
  version: 1
  points: GeometryPoint[]
  segments: GeometryLinearEntity[]
  rays: GeometryLinearEntity[]
  lines: GeometryLinearEntity[]
  circles: GeometryCircle[]
  polygons: GeometryPolygon[]
  angleMarkers: GeometryAngleMarker[]
  constraints: GeometryConstraint[]
  confidence: number
  warnings: string[]
}

export interface GeometrySceneValidation {
  valid: boolean
  errors: string[]
  scene: GeometryScene
}

export interface GeometrySceneInput {
  problemId: string
  imagePath: string
  stemMarkdown: string
}

export interface GeometrySceneProviderResult extends GeometrySceneValidation {
  rawOutput: string
  usage?: import('./models').AIUsageMetrics | null
}

export interface PersistedGeometryScene {
  id: string
  problemId: string
  modelRunId: string
  sourceImagePath: string
  scene: GeometryScene
  validationStatus: 'validated' | 'rejected'
  validationErrors: string[]
  confidence: number
  createdAt: number
  updatedAt: number
}

const idPattern = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/u
const clampConfidence = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : 0
const optionalCoordinate = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : null
const text = (value: unknown, limit: number) =>
  typeof value === 'string' ? value.trim().slice(0, limit) : ''
const source = (value: unknown): GeometryEvidenceSource =>
  value === 'derived' ? 'derived' : 'stated'
const records = (value: unknown) => Array.isArray(value)
  ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
  : []
const idsFrom = (value: unknown, limit: number) => Array.isArray(value)
  ? value.map((id) => text(id, 32)).filter(Boolean).slice(0, limit)
  : []

export function normalizeGeometryScene(value: unknown): GeometrySceneValidation {
  const root = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  const errors: string[] = []
  const ids = new Set<string>()
  const takeId = (candidate: unknown, kind: string) => {
    const id = text(candidate, 32)
    if (!idPattern.test(id)) {
      errors.push(`${kind} ID 无效`)
      return ''
    }
    if (ids.has(id)) errors.push(`${kind} ID 重复：${id}`)
    ids.add(id)
    return id
  }
  const takeSource = (candidate: unknown, kind: string) => {
    if (candidate !== 'stated' && candidate !== 'derived') {
      errors.push(`${kind} 的条件来源无效，不能把视觉比例当作数学条件`)
    }
    return source(candidate)
  }
  const points = records(root.points).slice(0, 64).map((item) => ({
    id: takeId(item.id, '点'),
    label: text(item.label, 12) || null,
    x: optionalCoordinate(item.x),
    y: optionalCoordinate(item.y),
    relativePosition: text(item.relative_position ?? item.relativePosition, 40) || null,
    source: takeSource(item.source, '点'),
    confidence: clampConfidence(item.confidence),
  }))
  if (points.length < 2) errors.push('场景至少需要两个点')
  const pointIds = new Set(points.map((point) => point.id).filter(Boolean))
  const linear = (key: string, kind: string) => records(root[key]).slice(0, 96).map((item) => {
    const entity = { id: takeId(item.id, kind), from: text(item.from, 32), to: text(item.to, 32) }
    if (!pointIds.has(entity.from) || !pointIds.has(entity.to) || entity.from === entity.to) {
      errors.push(`${kind} ${entity.id || '?'} 引用了无效端点`)
    }
    return entity
  })
  const segments = linear('segments', '线段')
  const rays = linear('rays', '射线')
  const lines = linear('lines', '直线')
  const circles = records(root.circles).slice(0, 24).map((item) => {
    const circle = { id: takeId(item.id, '圆'), center: text(item.center, 32), through: text(item.through, 32) }
    if (!pointIds.has(circle.center) || !pointIds.has(circle.through) || circle.center === circle.through) {
      errors.push(`圆 ${circle.id || '?'} 引用了无效点`)
    }
    return circle
  })
  const polygons = records(root.polygons).slice(0, 24).map((item) => {
    const polygon = {
      id: takeId(item.id, '多边形'),
      points: Array.isArray(item.points) ? item.points.map((id) => text(id, 32)).slice(0, 16) : [],
    }
    if (polygon.points.length < 3 || polygon.points.some((id) => !pointIds.has(id))) {
      errors.push(`多边形 ${polygon.id || '?'} 的顶点无效`)
    }
    return polygon
  })
  const angleMarkers = records(root.angle_markers ?? root.angleMarkers).slice(0, 32).map((item) => {
    const marker: GeometryAngleMarker = {
      id: takeId(item.id, '角标'), vertex: text(item.vertex, 32),
      from: text(item.from, 32), to: text(item.to, 32),
      kind: item.kind === 'right_angle' ? 'right_angle' : 'arc',
    }
    if ([marker.vertex, marker.from, marker.to].some((id) => !pointIds.has(id))) {
      errors.push(`角标 ${marker.id || '?'} 引用了无效点`)
    }
    return marker
  })
  const entityIds = new Set([
    ...pointIds,
    ...segments.map((item) => item.id), ...rays.map((item) => item.id),
    ...lines.map((item) => item.id), ...circles.map((item) => item.id),
    ...polygons.map((item) => item.id),
  ])
  const allowedConstraints = new Set<GeometryConstraintType>([
    'parallel', 'perpendicular', 'equal_length', 'tangent', 'collinear',
  ])
  const constraints = records(root.constraints).slice(0, 64).map((item) => {
    const type = allowedConstraints.has(item.type as GeometryConstraintType)
      ? item.type as GeometryConstraintType
      : 'collinear'
    if (!allowedConstraints.has(item.type as GeometryConstraintType)) errors.push('存在未知几何约束')
    const constraint: GeometryConstraint = {
      id: takeId(item.id, '约束'), type,
      entityIds: idsFrom(item.entity_ids ?? item.entityIds, 8),
      source: takeSource(item.source, '约束'), evidence: text(item.evidence, 160),
      confidence: clampConfidence(item.confidence),
    }
    if (constraint.entityIds.length < 2 || constraint.entityIds.some((id) => !entityIds.has(id))) {
      errors.push(`约束 ${constraint.id || '?'} 引用了无效对象`)
    }
    if (!constraint.evidence) errors.push(`约束 ${constraint.id || '?'} 缺少题面证据`)
    return constraint
  })
  const confidence = clampConfidence(root.confidence)
  if (confidence < 0.7) errors.push('场景整体置信度低于 0.70，必须回退原图')
  const scene: GeometryScene = {
    version: 1, points, segments, rays, lines, circles, polygons,
    angleMarkers, constraints, confidence,
    warnings: Array.isArray(root.warnings)
      ? root.warnings.map((item) => text(item, 120)).filter(Boolean).slice(0, 16)
      : [],
  }
  return { valid: errors.length === 0, errors: [...new Set(errors)], scene }
}

export function layoutGeometryScene(scene: GeometryScene) {
  const ordered = [...scene.points].sort((left, right) => left.id.localeCompare(right.id))
  return new Map(ordered.map((point, index) => {
    const angle = (Math.PI * 2 * index) / Math.max(ordered.length, 1) - Math.PI / 2
    return [point.id, {
      x: point.x ?? 0.5 + Math.cos(angle) * 0.36,
      y: point.y ?? 0.5 + Math.sin(angle) * 0.36,
    }]
  }))
}

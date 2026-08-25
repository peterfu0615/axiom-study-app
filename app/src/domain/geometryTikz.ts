import {
  layoutGeometryScene,
  type GeometryConstraintType,
  type GeometryLinearEntity,
  type GeometryScene,
} from './geometryScene'
import type { DiagramValidationContract } from './diagram'

export interface CompiledGeometryTikz {
  source: string
  contract: DiagramValidationContract
}

type Position = { x: number; y: number }

const relationStyle: Record<GeometryConstraintType, string> = {
  parallel: 'axiomParallel',
  perpendicular: 'axiomRightAngle',
  equal_length: 'axiomEqualLength',
  tangent: 'axiomTangent',
  collinear: 'axiomCollinear',
}

const number = (value: number) => {
  const rounded = Math.round(value * 1_000) / 1_000
  return Object.is(rounded, -0) ? '0' : String(rounded)
}

const point = ({ x, y }: Position) => `(${number(x)},${number(y)})`

function safeLabel(value: string | null) {
  return (value ?? '').replace(/[{}\\%]/gu, '').trim().slice(0, 12)
}

function extend(from: Position, through: Position, bothDirections: boolean) {
  const dx = through.x - from.x
  const dy = through.y - from.y
  const length = Math.hypot(dx, dy) || 1
  const ux = dx / length
  const uy = dy / length
  // A fixed extension used to dominate the SVG bounds and made the actual
  // construction look like a tiny mark in the middle of a large canvas.
  // Keep enough overhang to communicate a ray/line without changing the
  // scale of the underlying figure.
  const overhang = Math.max(.65, Math.min(1.8, length * .28))
  return {
    from: bothDirections ? { x: from.x - ux * overhang, y: from.y - uy * overhang } : from,
    to: { x: through.x + ux * overhang, y: through.y + uy * overhang },
  }
}

function fitPositions(scene: GeometryScene) {
  const laidOut = [...layoutGeometryScene(scene)].map(([id, value]) => [id, {
    x: value.x,
    y: 1 - value.y,
  }] as const)
  if (!laidOut.length) return new Map<string, Position>()
  const xs = laidOut.map(([, value]) => value.x)
  const ys = laidOut.map(([, value]) => value.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const spanX = Math.max(maxX - minX, .08)
  const spanY = Math.max(maxY - minY, .08)
  const scale = 8.6 / Math.max(spanX, spanY)
  const width = spanX * scale
  const height = spanY * scale
  const offsetX = (10 - width) / 2
  const offsetY = (10 - height) / 2
  return new Map(laidOut.map(([id, value]) => [id, {
    x: offsetX + (value.x - minX) * scale,
    y: offsetY + (value.y - minY) * scale,
  }]))
}

function edgeKey(from: string, to: string) {
  return [from, to].sort().join('\u0000')
}

function labelPosition(
  at: Position,
  center: Position,
  fallbackAngle: number,
) {
  let dx = at.x - center.x
  let dy = at.y - center.y
  let length = Math.hypot(dx, dy)
  if (length < .08) {
    dx = Math.cos(fallbackAngle)
    dy = Math.sin(fallbackAngle)
    length = 1
  }
  const distance = .38
  return { x: at.x + dx / length * distance, y: at.y + dy / length * distance }
}

function relationStyles(scene: GeometryScene) {
  const styles = new Map<string, Set<string>>()
  scene.constraints.forEach((constraint) => {
    const style = relationStyle[constraint.type]
    constraint.entityIds.forEach((id) => {
      const current = styles.get(id) ?? new Set<string>()
      current.add(style)
      styles.set(id, current)
    })
  })
  return styles
}

function options(id: string, styles: Map<string, Set<string>>, extras: string[] = []) {
  return [...new Set(['axiomLine', ...extras, ...(styles.get(id) ?? [])])].join(',')
}

function linearCommand(
  entity: GeometryLinearEntity,
  positions: Map<string, Position>,
  styles: Map<string, Set<string>>,
  kind: 'segment' | 'ray' | 'line',
) {
  const from = positions.get(entity.from)
  const to = positions.get(entity.to)
  if (!from || !to) return null
  const endpoints = kind === 'segment'
    ? { from, to }
    : extend(from, to, kind === 'line')
  return `\\draw[${options(entity.id, styles, kind === 'ray' ? ['->'] : [])}] ${point(endpoints.from)} -- ${point(endpoints.to)};`
}

/**
 * Compiles a validated GeometryScene into the intentionally tiny TikZ subset
 * understood by the Rust renderer. The result contains no macros, loops,
 * environments, file access, or model-authored TeX.
 */
export function compileGeometrySceneToTikz(scene: GeometryScene): CompiledGeometryTikz {
  const positions = fitPositions(scene)
  const styles = relationStyles(scene)
  const commands: string[] = []
  const drawnEdges = new Set<string>()

  scene.lines.forEach((entity) => {
    const command = linearCommand(entity, positions, styles, 'line')
    if (command) commands.push(command)
  })
  scene.rays.forEach((entity) => {
    const command = linearCommand(entity, positions, styles, 'ray')
    if (command) commands.push(command)
  })
  scene.segments.forEach((entity) => {
    const command = linearCommand(entity, positions, styles, 'segment')
    if (command) {
      commands.push(command)
      drawnEdges.add(edgeKey(entity.from, entity.to))
    }
  })
  // AI responses commonly describe a boundary both as a polygon and as
  // individual segments. Draw every physical edge only once so the outline
  // does not become unevenly bold.
  scene.polygons.forEach((polygon) => {
    polygon.points.forEach((fromId, index) => {
      const toId = polygon.points[(index + 1) % polygon.points.length]
      const key = edgeKey(fromId, toId)
      const from = positions.get(fromId)
      const to = positions.get(toId)
      if (!from || !to || drawnEdges.has(key)) return
      commands.push(`\\draw[${options(polygon.id, styles, ['thick'])}] ${point(from)} -- ${point(to)};`)
      drawnEdges.add(key)
    })
  })
  scene.circles.forEach((circle) => {
    const center = positions.get(circle.center)
    const through = positions.get(circle.through)
    if (!center || !through) return
    const radius = Math.max(.08, Math.hypot(through.x - center.x, through.y - center.y))
    commands.push(`\\draw[${options(circle.id, styles)}] ${point(center)} circle (${number(radius)});`)
  })
  scene.angleMarkers.forEach((marker) => {
    const vertex = positions.get(marker.vertex)
    const from = positions.get(marker.from)
    const to = positions.get(marker.to)
    if (!vertex || !from || !to) return
    const toward = (target: Position, scale: number) => {
      const dx = target.x - vertex.x
      const dy = target.y - vertex.y
      const length = Math.hypot(dx, dy) || 1
      return { x: vertex.x + dx / length * scale, y: vertex.y + dy / length * scale }
    }
    const markerScale = Math.max(.34, Math.min(
      .62,
      Math.min(
        Math.hypot(from.x - vertex.x, from.y - vertex.y),
        Math.hypot(to.x - vertex.x, to.y - vertex.y),
      ) * .16,
    ))
    const first = toward(from, markerScale)
    const second = toward(to, markerScale)
    const middle = { x: first.x + second.x - vertex.x, y: first.y + second.y - vertex.y }
    const style = marker.kind === 'right_angle' ? 'axiomRightAngle' : 'axiomAngle'
    commands.push(`\\draw[${style}] ${point(first)} -- ${point(middle)} -- ${point(second)};`)
  })
  const center = [...positions.values()].reduce(
    (sum, item) => ({ x: sum.x + item.x / Math.max(positions.size, 1), y: sum.y + item.y / Math.max(positions.size, 1) }),
    { x: 0, y: 0 },
  )
  scene.points.forEach((item, index) => {
    const at = positions.get(item.id)
    if (!at) return
    commands.push(`\\fill[axiomPoint] ${point(at)} circle (0.075);`)
    const label = safeLabel(item.label)
    const labelAt = labelPosition(at, center, (index / Math.max(scene.points.length, 1)) * Math.PI * 2)
    if (label) commands.push(`\\node[axiomLabel] at ${point(labelAt)} {${label}};`)
  })

  const requiredRelations = [...new Set<DiagramValidationContract['requiredRelations'][number]>([
    ...scene.constraints.map((constraint) => constraint.type),
    ...scene.angleMarkers.filter((marker) => marker.kind === 'right_angle').map(() => 'right_angle' as const),
  ])]
  return {
    source: commands.join(' '),
    contract: {
      requiredLabels: scene.points.map((item) => safeLabel(item.label)).filter(Boolean),
      requiredRelations,
    },
  }
}

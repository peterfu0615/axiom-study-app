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
  return {
    from: bothDirections ? { x: from.x - ux * 12, y: from.y - uy * 12 } : from,
    to: { x: through.x + ux * 12, y: through.y + uy * 12 },
  }
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
  const normalized = layoutGeometryScene(scene)
  const positions = new Map([...normalized].map(([id, value]) => [id, {
    x: value.x * 10,
    y: (1 - value.y) * 10,
  }]))
  const styles = relationStyles(scene)
  const commands: string[] = []

  scene.polygons.forEach((polygon) => {
    const points = polygon.points.map((id) => positions.get(id)).filter((value): value is Position => Boolean(value))
    if (points.length >= 3) commands.push(`\\draw[${options(polygon.id, styles, ['thick'])}] ${points.map(point).join(' -- ')} -- cycle;`)
  })
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
    if (command) commands.push(command)
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
    const first = toward(from, .38)
    const second = toward(to, .38)
    const middle = { x: first.x + second.x - vertex.x, y: first.y + second.y - vertex.y }
    const style = marker.kind === 'right_angle' ? 'axiomRightAngle' : 'axiomAngle'
    commands.push(`\\draw[${style}] ${point(first)} -- ${point(middle)} -- ${point(second)};`)
  })
  scene.points.forEach((item) => {
    const at = positions.get(item.id)
    if (!at) return
    commands.push(`\\fill[axiomPoint] ${point(at)} circle (0.075);`)
    const label = safeLabel(item.label)
    if (label) commands.push(`\\node[axiomLabel] at (${number(at.x + .28)},${number(at.y + .28)}) {${label}};`)
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

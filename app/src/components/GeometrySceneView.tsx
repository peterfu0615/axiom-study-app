import type { ReactNode } from 'react'
import { layoutGeometryScene, type GeometryScene } from '../domain/geometryScene'
import './GeometrySceneView.css'

const canvas = 420
const padding = 34
const pointOnCanvas = (point: { x: number; y: number }) => ({
  x: padding + point.x * (canvas - padding * 2),
  y: padding + point.y * (canvas - padding * 2),
})

export function GeometrySceneView({
  scene,
  fallback,
  alt = '重建的几何图形',
}: {
  scene: GeometryScene | null
  fallback: ReactNode
  alt?: string
}) {
  if (!scene || scene.confidence < 0.7) return <>{fallback}</>
  const layout = layoutGeometryScene(scene)
  const at = (id: string) => pointOnCanvas(layout.get(id) ?? { x: 0.5, y: 0.5 })
  return (
    <figure className="geometry-scene-view">
      <svg aria-label={alt} role="img" viewBox={`0 0 ${canvas} ${canvas}`}>
        {scene.polygons.map((polygon) => (
          <polygon
            fill="none"
            key={polygon.id}
            points={polygon.points.map((id) => {
              const point = at(id)
              return `${point.x},${point.y}`
            }).join(' ')}
          />
        ))}
        {[...scene.lines, ...scene.rays, ...scene.segments].map((entity) => {
          const from = at(entity.from)
          const to = at(entity.to)
          return <line key={entity.id} x1={from.x} x2={to.x} y1={from.y} y2={to.y} />
        })}
        {scene.circles.map((circle) => {
          const center = at(circle.center)
          const through = at(circle.through)
          const radius = Math.hypot(through.x - center.x, through.y - center.y)
          return <circle cx={center.x} cy={center.y} fill="none" key={circle.id} r={radius} />
        })}
        {scene.points.map((point) => {
          const position = at(point.id)
          return <g key={point.id}>
            <circle className="geometry-scene-view__point" cx={position.x} cy={position.y} r="4" />
            {point.label && <text x={position.x + 8} y={position.y - 8}>{point.label}</text>}
          </g>
        })}
      </svg>
      <figcaption>结构化几何图 · 置信度 {Math.round(scene.confidence * 100)}%</figcaption>
    </figure>
  )
}

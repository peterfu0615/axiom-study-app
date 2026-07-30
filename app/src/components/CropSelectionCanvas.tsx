import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import type { NormalizedRect } from '../domain/models'
import { mediaAssetUrl } from '../platform/native'

type DragKind = 'move' | 'nw' | 'ne' | 'sw' | 'se'

interface CropRegion {
  id: string
  rect: NormalizedRect
  label?: string
  tone?: 'question' | 'answer' | 'diagram' | 'annotation'
  active?: boolean
  selected?: boolean
}

interface DragState {
  id: string
  kind: DragKind
  startX: number
  startY: number
  original: NormalizedRect
  frameWidth: number
  frameHeight: number
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

export function CropSelectionCanvas({
  alt,
  children,
  className = '',
  disabled = false,
  imagePath,
  onActivate,
  onRectChange,
  regions,
}: {
  alt: string
  children?: ReactNode
  className?: string
  disabled?: boolean
  imagePath: string
  onActivate?: (id: string) => void
  onRectChange?: (id: string, rect: NormalizedRect) => void
  regions: CropRegion[]
}) {
  const frameRef = useRef<HTMLDivElement>(null)
  const onRectChangeRef = useRef(onRectChange)
  const [drag, setDrag] = useState<DragState | null>(null)

  useEffect(() => {
    onRectChangeRef.current = onRectChange
  }, [onRectChange])

  useEffect(() => {
    if (!drag) return
    const activeDrag = drag
    const minimumSize = 0.025

    function handlePointerMove(event: PointerEvent) {
      const dx =
        (event.clientX - activeDrag.startX) / activeDrag.frameWidth
      const dy =
        (event.clientY - activeDrag.startY) / activeDrag.frameHeight
      const original = activeDrag.original
      const originalMaxX = original.x + original.width
      const originalMaxY = original.y + original.height
      let rect = { ...original }

      if (activeDrag.kind === 'move') {
        rect.x = clamp(original.x + dx, 0, 1 - original.width)
        rect.y = clamp(original.y + dy, 0, 1 - original.height)
      } else {
        if (activeDrag.kind.includes('w')) {
          rect.x = clamp(original.x + dx, 0, originalMaxX - minimumSize)
          rect.width = originalMaxX - rect.x
        }
        if (activeDrag.kind.includes('e')) {
          rect.width = clamp(
            original.width + dx,
            minimumSize,
            1 - original.x,
          )
        }
        if (activeDrag.kind.includes('n')) {
          rect.y = clamp(original.y + dy, 0, originalMaxY - minimumSize)
          rect.height = originalMaxY - rect.y
        }
        if (activeDrag.kind.includes('s')) {
          rect.height = clamp(
            original.height + dy,
            minimumSize,
            1 - original.y,
          )
        }
      }

      onRectChangeRef.current?.(activeDrag.id, rect)
    }

    function handlePointerUp() {
      setDrag(null)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp, { once: true })
    window.addEventListener('pointercancel', handlePointerUp, { once: true })
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
    }
  }, [drag])

  const beginDrag = (
    event: ReactPointerEvent,
    region: CropRegion,
    kind: DragKind,
  ) => {
    if (disabled || !onRectChange) return
    event.preventDefault()
    event.stopPropagation()
    const frame = frameRef.current?.getBoundingClientRect()
    if (!frame || frame.width <= 0 || frame.height <= 0) return
    onActivate?.(region.id)
    setDrag({
      id: region.id,
      kind,
      startX: event.clientX,
      startY: event.clientY,
      original: { ...region.rect },
      frameWidth: frame.width,
      frameHeight: frame.height,
    })
  }

  return (
    <div
      className={`document-canvas ${className}`.trim()}
      ref={frameRef}
    >
      <img alt={alt} src={mediaAssetUrl(imagePath)} />
      {regions.map((region) => (
        <div
          className={`problem-box region-${region.tone ?? 'question'} ${region.active ? 'active' : ''} ${
            region.selected ? 'selected' : ''
          }`}
          key={region.id}
          onPointerDown={(event) => beginDrag(event, region, 'move')}
          style={{
            left: `${region.rect.x * 100}%`,
            top: `${region.rect.y * 100}%`,
            width: `${region.rect.width * 100}%`,
            height: `${region.rect.height * 100}%`,
          }}
        >
          {region.label && (
            <span className="problem-box-label">{region.label}</span>
          )}
          {(['nw', 'ne', 'sw', 'se'] as const).map((kind) => (
            <span
              className={`resize-handle ${kind}`}
              key={kind}
              onPointerDown={(event) => beginDrag(event, region, kind)}
            />
          ))}
        </div>
      ))}
      {children}
    </div>
  )
}

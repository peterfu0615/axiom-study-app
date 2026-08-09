import { createPortal } from 'react-dom'
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react'
import { getListboxNavigationIndex, getListboxTypeaheadIndex } from './ListboxSelect.utils'
import { Icon } from '../Icon'

export interface SelectOption {
  value: string
  label: string
  description?: string
  disabled?: boolean
}

export interface ListboxSelectProps {
  value: string
  options: SelectOption[]
  onValueChange: (value: string) => void
  label?: string
  placeholder?: string
  disabled?: boolean
  ariaLabel?: string
  className?: string
}

interface ListboxPosition {
  left: number
  top: number
  width: number
  maxHeight: number
  placement: 'above' | 'below'
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum))
}

export function ListboxSelect({
  value,
  options,
  onValueChange,
  label,
  placeholder = '请选择',
  disabled = false,
  ariaLabel,
  className = '',
}: ListboxSelectProps) {
  const fieldId = useId()
  const listId = `${fieldId}-listbox`
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const optionRefs = useRef<Record<number, HTMLButtonElement | null>>({})
  const [open, setOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const [position, setPosition] = useState<ListboxPosition | null>(null)
  const [typeahead, setTypeahead] = useState('')
  const typeaheadTimer = useRef<number | null>(null)

  const selectedIndex = useMemo(
    () => options.findIndex((option) => option.value === value),
    [options, value],
  )
  const selectedOption = selectedIndex >= 0 ? options[selectedIndex] : undefined

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    const gutter = 10
    const belowSpace = window.innerHeight - rect.bottom - gutter
    const aboveSpace = rect.top - gutter
    const placement = belowSpace < 220 && aboveSpace > belowSpace ? 'above' : 'below'
    const maxHeight = Math.max(140, Math.min(360, placement === 'above' ? aboveSpace : belowSpace))
    const width = Math.min(Math.max(rect.width, 180), Math.max(120, window.innerWidth - gutter * 2))
    setPosition({
      left: clamp(rect.left, gutter, window.innerWidth - width - gutter),
      top: placement === 'above' ? Math.max(gutter, rect.top - 5) : rect.bottom + 5,
      width,
      maxHeight,
      placement,
    })
  }, [])

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null)
      return undefined
    }
    updatePosition()
    const onViewportChange = () => updatePosition()
    window.addEventListener('resize', onViewportChange)
    window.addEventListener('scroll', onViewportChange, true)
    return () => {
      window.removeEventListener('resize', onViewportChange)
      window.removeEventListener('scroll', onViewportChange, true)
    }
  }, [open, updatePosition])

  useEffect(() => {
    if (!open) return undefined
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node
      if (!rootRef.current?.contains(target) && !popoverRef.current?.contains(target)) {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  useEffect(() => {
    if (!open || highlightedIndex < 0) return
    optionRefs.current[highlightedIndex]?.scrollIntoView({ block: 'nearest' })
  }, [highlightedIndex, open])

  useEffect(() => () => {
    if (typeaheadTimer.current !== null) window.clearTimeout(typeaheadTimer.current)
  }, [])

  const openListbox = () => {
    if (disabled) return
    setHighlightedIndex(selectedIndex >= 0 && !options[selectedIndex]?.disabled
      ? selectedIndex
      : getListboxNavigationIndex(options, -1, 1))
    setOpen(true)
  }

  const choose = (index: number) => {
    const option = options[index]
    if (!option || option.disabled) return
    onValueChange(option.value)
    setOpen(false)
    triggerRef.current?.focus()
  }

  const moveHighlight = (direction: 1 | -1) => {
    const next = getListboxNavigationIndex(options, highlightedIndex, direction)
    if (next >= 0) setHighlightedIndex(next)
  }

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Tab') {
      setOpen(false)
      return
    }
    if (event.key === 'Escape') {
      if (open) {
        event.preventDefault()
        setOpen(false)
      }
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) {
        openListbox()
      } else {
        moveHighlight(event.key === 'ArrowDown' ? 1 : -1)
      }
      return
    }
    if (event.key === 'Home' || event.key === 'End') {
      if (!open) return
      event.preventDefault()
      const direction = event.key === 'Home' ? 1 : -1
      const start = event.key === 'Home' ? -1 : 0
      setHighlightedIndex(getListboxNavigationIndex(options, start, direction))
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (!open) openListbox()
      else if (highlightedIndex >= 0) choose(highlightedIndex)
      return
    }
    if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return
    if (!open) openListbox()
    const nextQuery = `${typeahead}${event.key}`
    const nextIndex = getListboxTypeaheadIndex(options, nextQuery, highlightedIndex)
    const fallbackIndex = nextIndex >= 0
      ? nextIndex
      : getListboxTypeaheadIndex(options, event.key, highlightedIndex)
    if (fallbackIndex >= 0) setHighlightedIndex(fallbackIndex)
    setTypeahead(nextIndex >= 0 ? nextQuery : event.key)
    if (typeaheadTimer.current !== null) window.clearTimeout(typeaheadTimer.current)
    typeaheadTimer.current = window.setTimeout(() => setTypeahead(''), 500)
  }

  const menu = open && position && typeof document !== 'undefined'
    ? createPortal(
        <div
          className={`ax-listbox-popover ax-listbox-popover--${position.placement}`}
          ref={popoverRef}
          style={{
            '--ax-listbox-left': `${position.left}px`,
            '--ax-listbox-top': `${position.top}px`,
            '--ax-listbox-width': `${position.width}px`,
            '--ax-listbox-max-height': `${position.maxHeight}px`,
          } as CSSProperties}
        >
          <div
            aria-label={!label ? ariaLabel ?? placeholder : undefined}
            aria-labelledby={label ? `${fieldId}-label` : undefined}
            className="ax-listbox"
            id={listId}
            role="listbox"
          >
            {options.map((option, index) => (
              <button
                aria-selected={value === option.value}
                className={`ax-listbox__option${highlightedIndex === index ? ' is-highlighted' : ''}${value === option.value ? ' is-selected' : ''}`}
                disabled={option.disabled}
                id={`${listId}-option-${index}`}
                key={option.value}
                onClick={() => choose(index)}
                onMouseEnter={() => { if (!option.disabled) setHighlightedIndex(index) }}
                onMouseDown={(event) => event.preventDefault()}
                ref={(element) => { optionRefs.current[index] = element }}
                role="option"
                type="button"
              >
                <span className="ax-listbox__option-copy">
                  <span className="ax-listbox__option-label">{option.label}</span>
                  {option.description && <small>{option.description}</small>}
                </span>
                {value === option.value && <span aria-hidden="true" className="ax-listbox__check"><Icon name="check" size={16} /></span>}
              </button>
            ))}
          </div>
        </div>,
        document.body,
      )
    : null

  return (
    <div className={`ax-listbox-field ${className}`.trim()} ref={rootRef}>
      {label && <span className="ax-field-label" id={`${fieldId}-label`}>{label}</span>}
      <button
        aria-controls={open ? listId : undefined}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel ?? (!label ? placeholder : undefined)}
        aria-labelledby={!ariaLabel && label ? `${fieldId}-label` : undefined}
        className={`ax-listbox-trigger${open ? ' is-open' : ''}`}
        disabled={disabled}
        onClick={() => { if (open) setOpen(false); else openListbox() }}
        onKeyDown={onTriggerKeyDown}
        ref={triggerRef}
        type="button"
      >
        <span className={`ax-listbox-trigger__value${selectedOption ? '' : ' is-placeholder'}`}>
          {selectedOption?.label ?? placeholder}
        </span>
        <span aria-hidden="true" className="ax-listbox-trigger__arrow"><Icon name="chevron" size={16} /></span>
      </button>
      {menu}
    </div>
  )
}

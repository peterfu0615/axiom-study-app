import {
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ChangeEvent,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from 'react'
import type { AIErrorEnvelope } from '../../domain/aiError'
import { Icon, type IconName } from '../Icon'
export { FlowingTaskSurface } from './FlowingTaskSurface'
export type { FlowingTaskState, FlowingTaskSurfaceProps } from './FlowingTaskSurface'
export { ListboxSelect } from './ListboxSelect'
export type { ListboxSelectProps, SelectOption } from './ListboxSelect'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

export function Button({
  children,
  className = '',
  loading = false,
  variant = 'secondary',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  loading?: boolean
  variant?: ButtonVariant
}) {
  return (
    <button
      {...props}
      aria-busy={loading || undefined}
      className={`ax-button ax-button--${variant} ${className}`.trim()}
      disabled={loading || props.disabled}
    >
      {loading && <span aria-hidden="true" className="ax-spinner ax-button__spinner" />}
      <span className="ax-button__content">{children}</span>
    </button>
  )
}

export function PageHeader({
  eyebrow,
  title,
  summary,
  leading,
  actions,
  className = '',
}: {
  eyebrow: ReactNode
  title: ReactNode
  summary?: ReactNode
  leading?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <header className={`workspace-header ax-page-header ${className}`.trim()}>
      <div className="ax-page-header__main">
        {leading && <div className="ax-page-header__leading">{leading}</div>}
        <div className="ax-page-header__copy">
          <p className="eyebrow ax-page-header__eyebrow">{eyebrow}</p>
          <h1 className="ax-page-header__title">{title}</h1>
          {summary && <p className="subtitle ax-page-header__summary">{summary}</p>}
        </div>
      </div>
      {actions && <div className="ax-page-header__actions">{actions}</div>}
    </header>
  )
}

export function IconButton({
  label,
  children,
  className = '',
  appearance = 'surface',
  tone = 'default',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string
  appearance?: 'surface' | 'plain'
  tone?: 'default' | 'danger'
  ref?: Ref<HTMLButtonElement>
}) {
  return (
    <button
      {...props}
      aria-label={label}
      className={`ax-icon-button ax-icon-button--${appearance} ax-icon-button--${tone} ${className}`.trim()}
      title={label}
      type={props.type ?? 'button'}
    >
      {children}
    </button>
  )
}

export type FeedbackTone = 'success' | 'warning' | 'danger'
export type Feedback = { tone: FeedbackTone; message: string } | null

export function InlineNotice({
  feedback,
  onClose,
  action,
}: {
  feedback: Feedback
  onClose?: () => void
  action?: ReactNode
}) {
  if (!feedback) return null
  return (
    <div
      aria-live={feedback.tone === 'danger' ? undefined : 'polite'}
      className={`ax-inline-notice ax-inline-notice--${feedback.tone}`}
      role={feedback.tone === 'danger' ? 'alert' : 'status'}
    >
      <span aria-hidden="true" className="ax-inline-notice__icon">
        <Icon name={feedback.tone === 'success' ? 'check' : feedback.tone === 'warning' ? 'alert' : 'close'} size={16} />
      </span>
      <span className="ax-inline-notice__message">{feedback.message}</span>
      {action && <span className="ax-inline-notice__action">{action}</span>}
      {onClose && <IconButton label="关闭提示" onClick={onClose}><Icon name="close" size={16} /></IconButton>}
    </div>
  )
}

export interface TabOption<T extends string> {
  value: T
  label: ReactNode
  icon?: IconName
  count?: number
  disabled?: boolean
}

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: T
  onChange: (value: T) => void
  options: Array<{ value: T; label: ReactNode; disabled?: boolean }>
  ariaLabel: string
}) {
  return (
    <div aria-label={ariaLabel} className="segmented-control" role="tablist">
      {options.map((option) => (
        <button
          aria-selected={value === option.value}
          className={value === option.value ? 'active' : ''}
          disabled={option.disabled}
          key={option.value}
          onClick={() => onChange(option.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              onChange(option.value)
            }
          }}
          role="tab"
          tabIndex={value === option.value ? 0 : -1}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function Tabs<T extends string>({
  value,
  onChange,
  options,
  variant = 'underline',
  ariaLabel,
}: {
  value: T
  onChange: (value: T) => void
  options: TabOption<T>[]
  variant?: 'underline' | 'rail' | 'segment'
  ariaLabel: string
}) {
  return (
    <div aria-label={ariaLabel} className={`ax-tabs ax-tabs--${variant}`} role="tablist">
      {options.map((option) => (
        <button
          aria-selected={value === option.value}
          className={value === option.value ? 'is-selected' : ''}
          disabled={option.disabled}
          key={option.value}
          onClick={() => onChange(option.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              onChange(option.value)
            }
          }}
          role="tab"
          tabIndex={value === option.value ? 0 : -1}
          type="button"
        >
          <span className="ax-tabs__content">
            {option.icon && <span className="ax-tabs__icon"><Icon name={option.icon} size={20} /></span>}
            <span>{option.label}</span>
          </span>
          {option.count !== undefined && <small>{option.count}</small>}
        </button>
      ))}
    </div>
  )
}

export function StatusBadge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'brand'
}) {
  return <span className={`ax-status-badge ax-status-badge--${tone}`}>{children}</span>
}

export type StatusTagKind =
  | 'completed' | 'in-progress' | 'pending' | 'deferred'
  | 'again' | 'hard' | 'good' | 'easy'

export function StatusTag({ children, kind }: { children: ReactNode; kind: StatusTagKind }) {
  return <span className={`ax-status-tag ax-status-tag--${kind}`}>{children}</span>
}

export function Badge({ children }: { children: ReactNode }) {
  return <span className="ax-badge">{children}</span>
}

export function Input({
  label,
  hint,
  error,
  className = '',
  id,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label?: string
  hint?: string
  error?: string
}) {
  const generatedId = useId()
  const fieldId = id ?? generatedId
  const descriptionId = hint || error ? `${fieldId}-description` : undefined
  return (
    <label className={`ax-input-field ${className}`.trim()} htmlFor={fieldId}>
      {label && <span className="ax-field-label">{label}</span>}
      <input {...props} aria-describedby={descriptionId} aria-invalid={Boolean(error) || undefined} id={fieldId} />
      {(error || hint) && <small className={error ? 'ax-field-error' : 'ax-field-hint'} id={descriptionId}>{error || hint}</small>}
    </label>
  )
}

export function EmptyState({
  title,
  description,
  action,
  secondaryAction,
  icon,
}: {
  title: string
  description: string
  action?: ReactNode
  secondaryAction?: ReactNode
  icon?: ReactNode
}) {
  return (
    <section className="ax-empty-state">
      {icon && <div aria-hidden="true" className="ax-empty-state__icon">{icon}</div>}
      <h2>{title}</h2>
      <p>{description}</p>
      {(action || secondaryAction) && <div className="ax-empty-state__actions">{action}{secondaryAction}</div>}
    </section>
  )
}

export function AsyncState({
  children,
  error,
  loading = false,
  onRetry,
  loadingLabel = '正在加载…',
}: {
  children: ReactNode
  error?: string | null
  loading?: boolean
  onRetry?: () => void
  loadingLabel?: string
}) {
  if (loading) {
    return <div className="ax-async-state" role="status"><span className="ax-spinner" />{loadingLabel}</div>
  }
  if (error) {
    return (
      <div className="ax-async-state ax-async-state--error" role="alert">
        <strong>暂时无法完成此操作</strong>
        <span>{error}</span>
        {onRetry && <Button onClick={onRetry}>重试</Button>}
      </div>
    )
  }
  return <>{children}</>
}

export function ErrorState({
  error,
  onRetry,
  secondaryAction,
}: {
  error: AIErrorEnvelope
  onRetry?: () => void
  secondaryAction?: ReactNode
}) {
  return (
    <section className="ax-error-state" role="alert">
      <div className="ax-error-state__copy">
        <strong>{error.title}</strong>
        <p>{error.userMessage}</p>
        {error.detailSafe && (
          <details>
            <summary>详情</summary>
            <code>{error.code} · {error.detailSafe}</code>
          </details>
        )}
      </div>
      {(onRetry || secondaryAction) && (
        <div className="ax-error-state__actions">
          {onRetry && error.retryable && <Button onClick={onRetry}>重新尝试</Button>}
          {secondaryAction}
        </div>
      )}
    </section>
  )
}

export function Progress({
  value,
  label,
  detail,
}: {
  value: number
  label: string
  detail?: string
}) {
  const normalized = Math.min(100, Math.max(0, value))
  return (
    <div className="ax-progress" role="status">
      <div><strong>{label}</strong>{detail && <span>{detail}</span>}</div>
      <div aria-label={`${label} ${Math.round(normalized)}%`} className="ax-progress__track">
        <span style={{ width: `${normalized}%` }} />
      </div>
    </div>
  )
}

const DIALOG_FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

function dialogFocusableElements(dialog: HTMLElement | null) {
  if (!dialog) return []
  return Array.from(dialog.querySelectorAll<HTMLElement>(DIALOG_FOCUSABLE_SELECTOR))
    .filter((element) => !element.hasAttribute('disabled') && element.offsetParent !== null)
}

export function Dialog({
  children,
  onClose,
  open,
  title,
}: {
  children: ReactNode
  onClose: () => void
  open: boolean
  title: string
}) {
  const titleId = useId()
  const dialogRef = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!open) return undefined
    // Remember where focus came from so it can be restored on close.
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialogFocusableElements(dialogRef.current)[0]?.focus()
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      // Keep Tab cycling inside the dialog instead of reaching the page
      // behind the backdrop.
      const elements = dialogFocusableElements(dialogRef.current)
      if (!elements.length) return
      const first = elements[0]
      const last = elements[elements.length - 1]
      const active = document.activeElement
      if (event.shiftKey && (active === first || !(active instanceof HTMLElement) || !dialogRef.current?.contains(active))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      previouslyFocused?.focus()
    }
  }, [onClose, open])
  if (!open) return null
  return (
    <div className="ax-dialog-backdrop" onMouseDown={onClose} role="presentation">
      <section
        aria-label={title}
        aria-labelledby={titleId}
        aria-modal="true"
        className="ax-dialog"
        onMouseDown={(event) => event.stopPropagation()}
        ref={dialogRef}
        role="dialog"
      >
        <header><h2 id={titleId}>{title}</h2><IconButton label="关闭" onClick={onClose}><Icon name="close" size={16} /></IconButton></header>
        <div className="ax-dialog__body">{children}</div>
      </section>
    </div>
  )
}

export function Menu({
  children,
  label = '更多操作',
}: {
  children: ReactNode
  label?: string
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return undefined
    const close = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])
  const focusMenuItem = (index: number) => {
    const items = Array.from(
      root.current?.querySelectorAll<HTMLButtonElement>('.ax-menu__item:not([disabled])') ?? [],
    )
    if (items.length) items[Math.max(0, Math.min(index, items.length - 1))].focus()
  }
  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!open) return
    const items = Array.from(
      root.current?.querySelectorAll<HTMLButtonElement>('.ax-menu__item:not([disabled])') ?? [],
    )
    if (!items.length) return
    const currentIndex = items.findIndex((item) => item === document.activeElement)
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      focusMenuItem(currentIndex < 0 ? 0 : (currentIndex + 1) % items.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      focusMenuItem(currentIndex < 0 ? items.length - 1 : (currentIndex - 1 + items.length) % items.length)
    } else if (event.key === 'Home') {
      event.preventDefault()
      focusMenuItem(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      focusMenuItem(items.length - 1)
    }
  }
  return (
    <div className="ax-menu" ref={root} onKeyDown={onMenuKeyDown}>
      <IconButton
        aria-expanded={open}
        aria-haspopup="menu"
        label={label}
        onClick={() => setOpen((value) => !value)}
        ref={triggerRef}
      >
        ⋯
      </IconButton>
      {open && (
        <div className="ax-menu__popover" onClick={() => setOpen(false)} role="menu">
          {children}
        </div>
      )}
    </div>
  )
}

export function MenuItem({
  children,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} className={`ax-menu__item ${className}`.trim()} role="menuitem" type="button">{children}</button>
}

export function FileDropzone({
  accept,
  children,
  disabled = false,
  onFiles,
}: {
  accept?: string
  children: ReactNode
  disabled?: boolean
  onFiles: (files: File[]) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const pick = () => input.current?.click()
  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files?.length) onFiles(Array.from(event.target.files))
    event.target.value = ''
  }
  return (
    <div
      className={`ax-file-dropzone ${dragging ? 'is-dragging' : ''}`}
      onDragEnter={(event) => { event.preventDefault(); if (!disabled) setDragging(true) }}
      onDragLeave={(event) => { event.preventDefault(); setDragging(false) }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault(); setDragging(false)
        if (!disabled && event.dataTransfer.files.length) onFiles(Array.from(event.dataTransfer.files))
      }}
    >
      <input accept={accept} disabled={disabled} onChange={onChange} ref={input} type="file" />
      <button disabled={disabled} onClick={pick} type="button">{children}</button>
    </div>
  )
}

export function Surface({ className = '', children, ...props }: HTMLAttributes<HTMLElement>) {
  return <section {...props} className={`ax-surface ${className}`.trim()}>{children}</section>
}

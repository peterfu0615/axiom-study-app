import {
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ChangeEvent,
  type HTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react'

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
      <span>{children}</span>
    </button>
  )
}

export function IconButton({
  label,
  children,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      {...props}
      aria-label={label}
      className={`ax-icon-button ${className}`.trim()}
      title={label}
      type={props.type ?? 'button'}
    >
      {children}
    </button>
  )
}

export function SelectField({
  label,
  hint,
  className = '',
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & {
  label?: string
  hint?: string
}) {
  const id = useId()
  return (
    <label className={`ax-select-field ${className}`.trim()} htmlFor={id}>
      {label && <span className="ax-field-label">{label}</span>}
      <select {...props} id={id}>{children}</select>
      {hint && <span className="ax-field-hint">{hint}</span>}
    </label>
  )
}

export interface TabOption<T extends string> {
  value: T
  label: ReactNode
  count?: number
  disabled?: boolean
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
  variant?: 'underline' | 'rail'
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
          role="tab"
          type="button"
        >
          <span>{option.label}</span>
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
  useEffect(() => {
    if (!open) return undefined
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, open])
  if (!open) return null
  return (
    <div className="ax-dialog-backdrop" onMouseDown={onClose} role="presentation">
      <section
        aria-label={title}
        aria-modal="true"
        className="ax-dialog"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header><h2>{title}</h2><IconButton label="关闭" onClick={onClose}>×</IconButton></header>
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
  useEffect(() => {
    if (!open) return undefined
    const close = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  return (
    <div className="ax-menu" ref={root}>
      <IconButton aria-expanded={open} label={label} onClick={() => setOpen((value) => !value)}>⋯</IconButton>
      {open && <div className="ax-menu__popover" role="menu" onClick={() => setOpen(false)}>{children}</div>}
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

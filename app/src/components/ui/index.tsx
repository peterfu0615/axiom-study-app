import {
  cloneElement,
  createElement,
  isValidElement,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ChangeEvent,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
  type TextareaHTMLAttributes,
} from 'react'
import type { AIErrorEnvelope } from '../../domain/aiError'
import { Icon, type IconName } from '../Icon'
import { discreteSliderIndexFromPointer } from './discreteSlider'
import { ListboxSelect, type ListboxSelectProps, type SelectOption } from './ListboxSelect'
import { isTabNavigationKey, nextEnabledTabIndex } from './tabNavigation'
export { FlowingTaskSurface } from './FlowingTaskSurface'
export type { FlowingTaskState, FlowingTaskSurfaceProps } from './FlowingTaskSurface'
export { ListboxSelect }
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
      type={props.type ?? 'button'}
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

export function NavigationItem({
  active = false,
  className = '',
  icon,
  label,
  shortcut,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  active?: boolean
  icon?: IconName
  label: string
  shortcut?: string
}) {
  const title = shortcut ? `${label}（${shortcut}）` : label
  return (
    <button
      {...props}
      aria-current={active ? 'page' : undefined}
      className={`ax-navigation-item${active ? ' is-selected' : ''} ${className}`.trim()}
      title={title}
      type={props.type ?? 'button'}
    >
      {icon && <span aria-hidden="true" className="ax-navigation-item__icon"><Icon name={icon} size={20} /></span>}
      <span className="ax-navigation-item__label">{label}</span>
      {shortcut && <kbd aria-hidden="true" className="ax-navigation-item__shortcut">{shortcut}</kbd>}
    </button>
  )
}

export function SidebarItem(props: Parameters<typeof NavigationItem>[0]) {
  return <NavigationItem {...props} className={`ax-sidebar-item ${props.className ?? ''}`.trim()} />
}

export interface BreadcrumbItem {
  label: string
  onClick?: () => void
}

export function Breadcrumb({ items, className = '' }: { items: BreadcrumbItem[]; className?: string }) {
  return (
    <nav aria-label="面包屑" className={`ax-breadcrumb ${className}`.trim()}>
      <ol>
        {items.map((item, index) => {
          const current = index === items.length - 1
          return (
            <li key={`${item.label}-${index}`}>
              {index > 0 && <Icon name="chevron" size={12} />}
              {current || !item.onClick
                ? <span aria-current={current ? 'page' : undefined}>{item.label}</span>
                : <button onClick={item.onClick} type="button">{item.label}</button>}
            </li>
          )
        })}
      </ol>
    </nav>
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

export function Tooltip({
  children,
  content,
  placement = 'top',
}: {
  children: ReactElement<Record<string, unknown>>
  content: string
  placement?: 'top' | 'bottom'
}) {
  const id = useId()
  const describedBy = typeof children.props['aria-describedby'] === 'string'
    ? `${children.props['aria-describedby']} ${id}`
    : id
  const trigger = isValidElement(children)
    ? cloneElement(children, { 'aria-describedby': describedBy })
    : children
  return (
    <span className={`ax-tooltip ax-tooltip--${placement}`}>
      {trigger}
      <span className="ax-tooltip__content" id={id} role="tooltip">{content}</span>
    </span>
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

function handleTabKeyDown<T extends string>(
  event: KeyboardEvent<HTMLButtonElement>,
  options: Array<{ value: T; disabled?: boolean }>,
  currentIndex: number,
  onChange: (value: T) => void,
) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    onChange(options[currentIndex].value)
    return
  }
  if (!isTabNavigationKey(event.key)) return

  event.preventDefault()
  const nextIndex = nextEnabledTabIndex(options, currentIndex, event.key)
  const nextOption = options[nextIndex]
  if (!nextOption) return
  const tabs = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
  tabs?.[nextIndex]?.focus({ preventScroll: true })
  onChange(nextOption.value)
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
      {options.map((option, index) => (
        <button
          aria-selected={value === option.value}
          className={value === option.value ? 'active' : ''}
          disabled={option.disabled}
          key={option.value}
          onClick={() => onChange(option.value)}
          onKeyDown={(event) => handleTabKeyDown(event, options, index, onChange)}
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

export function DiscreteSlider<T extends string>({
  ariaLabel,
  disabled = false,
  onChange,
  options,
  value,
}: {
  ariaLabel: string
  disabled?: boolean
  onChange: (value: T) => void
  options: Array<{ value: T; label: string }>
  value: T
}) {
  const [dragging, setDragging] = useState(false)
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value))
  const selectIndex = (index: number) => {
    const option = options[Math.max(0, Math.min(options.length - 1, index))]
    if (option && option.value !== value) onChange(option.value)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      event.preventDefault(); selectIndex(selectedIndex - 1)
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      event.preventDefault(); selectIndex(selectedIndex + 1)
    } else if (event.key === 'Home') {
      event.preventDefault(); selectIndex(0)
    } else if (event.key === 'End') {
      event.preventDefault(); selectIndex(options.length - 1)
    }
  }
  const selectFromPointer = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (disabled || options.length < 2) return
    const bounds = event.currentTarget.getBoundingClientRect()
    selectIndex(discreteSliderIndexFromPointer(event.clientX, bounds.left, bounds.width, options.length))
  }
  const progress = options.length > 1 ? selectedIndex / (options.length - 1) * 100 : 0
  return (
    <div className="ax-discrete-slider-field">
      <span className="ax-field-label">{ariaLabel}</span>
      <button
        aria-label={ariaLabel}
        aria-valuemax={Math.max(0, options.length - 1)}
        aria-valuemin={0}
        aria-valuenow={selectedIndex}
        aria-valuetext={options[selectedIndex]?.label}
        className={`ax-discrete-slider${dragging ? ' is-dragging' : ''}`}
        disabled={disabled}
        onKeyDown={onKeyDown}
        onPointerCancel={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
          setDragging(false)
        }}
        onPointerDown={(event) => {
          if (disabled) return
          event.preventDefault()
          event.currentTarget.setPointerCapture(event.pointerId)
          setDragging(true)
          selectFromPointer(event)
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) selectFromPointer(event)
        }}
        onPointerUp={(event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
          selectFromPointer(event)
          event.currentTarget.releasePointerCapture(event.pointerId)
          setDragging(false)
        }}
        role="slider"
        type="button"
      >
        <span aria-hidden="true" className="ax-discrete-slider__track">
          <span className="ax-discrete-slider__fill" style={{ width: `${progress}%` }} />
        </span>
        {options.map((option, index) => <span
          aria-hidden="true"
          className={`ax-discrete-slider__stop${index === 0 ? ' is-first' : ''}${index === options.length - 1 ? ' is-last' : ''}${index <= selectedIndex ? ' is-reached' : ''}${index === selectedIndex ? ' is-current' : ''}`}
          key={option.value}
          style={{ left: `${options.length > 1 ? index / (options.length - 1) * 100 : 0}%` }}
        />)}
      </button>
      <div aria-hidden="true" className="ax-discrete-slider__labels">
        {options.map((option, index) => <span className={index === selectedIndex ? 'is-current' : ''} key={option.value}>{option.label}</span>)}
      </div>
    </div>
  )
}

export function Tabs<T extends string>({
  value,
  onChange,
  options,
  variant = 'underline',
  ariaLabel,
  className = '',
}: {
  value: T
  onChange: (value: T) => void
  options: TabOption<T>[]
  variant?: 'underline' | 'rail' | 'segment'
  ariaLabel: string
  className?: string
}) {
  return (
    <div aria-label={ariaLabel} className={`ax-tabs ax-tabs--${variant} ${className}`.trim()} role="tablist">
      {options.map((option, index) => (
        <button
          aria-selected={value === option.value}
          className={value === option.value ? 'is-selected' : ''}
          disabled={option.disabled}
          key={option.value}
          onClick={() => onChange(option.value)}
          onKeyDown={(event) => handleTabKeyDown(event, options, index, onChange)}
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

export function TabPanel({
  active = true,
  children,
  className = '',
  ...props
}: HTMLAttributes<HTMLDivElement> & { active?: boolean }) {
  if (!active) return null
  return <div {...props} className={`ax-tab-panel ${className}`.trim()} role="tabpanel">{children}</div>
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

export function Tag({
  children,
  onRemove,
  removeLabel = '移除标签',
}: {
  children: ReactNode
  onRemove?: () => void
  removeLabel?: string
}) {
  return (
    <span className="ax-tag">
      <span>{children}</span>
      {onRemove && <IconButton appearance="plain" label={removeLabel} onClick={onRemove}><Icon name="close" size={12} /></IconButton>}
    </span>
  )
}

export function Card({
  as = 'article',
  children,
  className = '',
  padding = 'standard',
  ...props
}: HTMLAttributes<HTMLElement> & {
  as?: 'article' | 'section' | 'div'
  padding?: 'compact' | 'standard' | 'spacious'
}) {
  return createElement(as, {
    ...props,
    className: `ax-card ax-card--padding-${padding} ${className}`.trim(),
  }, children)
}

export type TextRole = 'eyebrow' | 'body' | 'secondary' | 'label' | 'meta' | 'caption'
export type HeadingRole = 'page' | 'section' | 'card'

export function Text({
  as = 'p',
  children,
  className = '',
  reading = false,
  role = 'body',
  tone = 'primary',
  ...props
}: HTMLAttributes<HTMLElement> & {
  as?: 'p' | 'span' | 'small' | 'strong' | 'div'
  reading?: boolean
  role?: TextRole
  tone?: 'primary' | 'secondary' | 'tertiary' | 'danger'
}) {
  return createElement(as, {
    ...props,
    className: `ax-text ax-text--${role} ax-text-tone--${tone}${reading ? ' ax-text--reading' : ''} ${className}`.trim(),
  }, children)
}

export function Heading({
  as = 'h2',
  children,
  className = '',
  reading = false,
  role = 'section',
  ...props
}: HTMLAttributes<HTMLHeadingElement> & {
  as?: 'h1' | 'h2' | 'h3' | 'h4'
  reading?: boolean
  role?: HeadingRole
}) {
  return createElement(as, {
    ...props,
    className: `ax-heading ax-heading--${role}${reading ? ' ax-heading--reading' : ''} ${className}`.trim(),
  }, children)
}

export function Select(props: ListboxSelectProps) {
  return <ListboxSelect {...props} />
}

export function Input({
  label,
  hint,
  error,
  className = '',
  id,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label?: ReactNode
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

export function TextField(props: Parameters<typeof Input>[0]) {
  return <Input {...props} />
}

export function SearchField({
  className = '',
  label,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const generatedId = useId()
  const fieldId = props.id ?? generatedId
  return (
    <label className={`ax-search-field ${className}`.trim()} htmlFor={fieldId}>
      <span aria-hidden="true" className="ax-search-field__icon"><Icon name="search" size={16} /></span>
      <span className="sr-only">{label}</span>
      <input {...props} aria-label={props['aria-label'] ?? label} id={fieldId} type="search" />
    </label>
  )
}

export function Checkbox({
  className = '',
  label,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { label: ReactNode }) {
  return (
    <label className={`ax-checkbox ${className}`.trim()}>
      <input {...props} type="checkbox" />
      <span aria-hidden="true" className="ax-checkbox__box"><Icon name="check" size={12} /></span>
      <span className="ax-checkbox__label">{label}</span>
    </label>
  )
}

export interface RadioOption<T extends string> {
  value: T
  label: ReactNode
  description?: ReactNode
  disabled?: boolean
}

export function RadioGroup<T extends string>({
  ariaLabel,
  className = '',
  name,
  onChange,
  options,
  value,
  variant = 'standard',
}: {
  ariaLabel: string
  className?: string
  name?: string
  onChange: (value: T) => void
  options: RadioOption<T>[]
  value: T
  variant?: 'standard' | 'cards'
}) {
  const generatedName = useId()
  const groupName = name ?? generatedName
  return (
    <fieldset aria-label={ariaLabel} className={`ax-radio-group ax-radio-group--${variant} ${className}`.trim()}>
      <legend className="sr-only">{ariaLabel}</legend>
      {options.map((option) => (
        <label className="ax-radio" key={option.value}>
          <input
            checked={value === option.value}
            disabled={option.disabled}
            name={groupName}
            onChange={() => onChange(option.value)}
            type="radio"
            value={option.value}
          />
          <span aria-hidden="true" className="ax-radio__control"><span /></span>
          <span className="ax-radio__copy">
            <strong>{option.label}</strong>
            {option.description && <small>{option.description}</small>}
          </span>
        </label>
      ))}
    </fieldset>
  )
}

export function Switch({
  className = '',
  description,
  label,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  description?: ReactNode
  label: ReactNode
}) {
  return (
    <label className={`ax-switch ${className}`.trim()}>
      <span className="ax-switch__copy">
        <strong>{label}</strong>
        {description && <small>{description}</small>}
      </span>
      <input {...props} role="switch" type="checkbox" />
      <span aria-hidden="true" className="ax-switch__track"><span /></span>
    </label>
  )
}

export function Combobox({
  ariaLabel,
  className = '',
  disabled = false,
  label,
  onValueChange,
  options,
  placeholder = '输入以筛选',
  value,
}: {
  ariaLabel?: string
  className?: string
  disabled?: boolean
  label?: string
  onValueChange: (value: string) => void
  options: SelectOption[]
  placeholder?: string
  value: string
}) {
  const id = useId()
  const listId = `${id}-listbox`
  const selected = options.find((option) => option.value === value)
  const [query, setQuery] = useState(selected?.label ?? '')
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    return options.filter((option) => !needle || option.label.toLocaleLowerCase().includes(needle))
  }, [options, query])

  useEffect(() => {
    if (!open) setQuery(selected?.label ?? '')
  }, [open, selected?.label])

  const choose = (option: SelectOption) => {
    if (option.disabled) return
    onValueChange(option.value)
    setQuery(option.label)
    setOpen(false)
  }
  const enabledIndexFrom = (start: number, direction: 1 | -1) => {
    if (!filtered.length) return 0
    for (let offset = 1; offset <= filtered.length; offset += 1) {
      const index = (start + direction * offset + filtered.length) % filtered.length
      if (!filtered[index]?.disabled) return index
    }
    return Math.max(0, start)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) setOpen(true)
      const direction = event.key === 'ArrowDown' ? 1 : -1
      setActiveIndex((current) => enabledIndexFrom(current, direction))
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      setOpen(true)
      const start = event.key === 'Home' ? -1 : 0
      setActiveIndex(enabledIndexFrom(start, event.key === 'Home' ? 1 : -1))
    } else if (event.key === 'Enter' && open && filtered[activeIndex]) {
      event.preventDefault()
      choose(filtered[activeIndex])
    } else if (event.key === 'Escape') {
      setOpen(false)
      setQuery(selected?.label ?? '')
    }
  }

  return (
    <div
      className={`ax-combobox ${className}`.trim()}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false)
      }}
    >
      {label && <label className="ax-field-label" htmlFor={id}>{label}</label>}
      <div className="ax-combobox__control">
        <Icon name="search" size={16} />
        <input
          aria-activedescendant={open && filtered[activeIndex] ? `${listId}-option-${activeIndex}` : undefined}
          aria-autocomplete="list"
          aria-controls={open ? listId : undefined}
          aria-expanded={open}
          aria-label={ariaLabel ?? label}
          autoComplete="off"
          disabled={disabled}
          id={id}
          onChange={(event) => {
            setQuery(event.target.value)
            setActiveIndex(0)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          role="combobox"
          value={query}
        />
      </div>
      {open && !disabled && (
        <div className="ax-combobox__popover" id={listId} role="listbox">
          {filtered.length ? filtered.map((option, index) => (
            <button
              aria-selected={option.value === value}
              className={index === activeIndex ? 'is-highlighted' : ''}
              disabled={option.disabled}
              id={`${listId}-option-${index}`}
              key={option.value}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => choose(option)}
              role="option"
              type="button"
            >
              <span><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span>
              {option.value === value && <Icon name="check" size={16} />}
            </button>
          )) : <div className="ax-combobox__empty">没有匹配项</div>}
        </div>
      )}
    </div>
  )
}

export function Textarea({
  label,
  hint,
  error,
  className = '',
  id,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label?: ReactNode
  hint?: string
  error?: string
}) {
  const generatedId = useId()
  const fieldId = id ?? generatedId
  const descriptionId = hint || error ? `${fieldId}-description` : undefined
  return (
    <label className={`ax-textarea-field ${className}`.trim()} htmlFor={fieldId}>
      {label && <span className="ax-field-label">{label}</span>}
      <textarea {...props} aria-describedby={descriptionId} aria-invalid={Boolean(error) || undefined} id={fieldId} />
      {(error || hint) && <small className={error ? 'ax-field-error' : 'ax-field-hint'} id={descriptionId}>{error || hint}</small>}
    </label>
  )
}

export function Toolbar({
  children,
  className = '',
  label = '页面工具',
  ...props
}: HTMLAttributes<HTMLDivElement> & { label?: string }) {
  return <div {...props} aria-label={label} className={`ax-toolbar ${className}`.trim()} role="toolbar">{children}</div>
}

export function DetailHeader({
  actions,
  className = '',
  eyebrow,
  leading,
  metadata,
  title,
}: {
  actions?: ReactNode
  className?: string
  eyebrow?: ReactNode
  leading?: ReactNode
  metadata?: ReactNode
  title: ReactNode
}) {
  return (
    <header className={`ax-detail-header ${className}`.trim()}>
      <div className="ax-detail-header__main">
        {leading && <div className="ax-detail-header__leading">{leading}</div>}
        <div className="ax-detail-header__copy">
          {eyebrow && <Text role="eyebrow" tone="secondary">{eyebrow}</Text>}
          <Heading as="h2" role="section">{title}</Heading>
          {metadata && <div className="ax-detail-header__metadata">{metadata}</div>}
        </div>
      </div>
      {actions && <div className="ax-detail-header__actions">{actions}</div>}
    </header>
  )
}

export function ListRow({
  actions,
  className = '',
  description,
  leading,
  metadata,
  onClick,
  selected = false,
  selection,
  status,
  title,
}: {
  actions?: ReactNode
  className?: string
  description?: ReactNode
  leading?: ReactNode
  metadata?: ReactNode
  onClick?: () => void
  selected?: boolean
  selection?: ReactNode
  status?: ReactNode
  title: ReactNode
}) {
  const content = <>
    {leading && <span className="ax-list-row__leading">{leading}</span>}
    <span className="ax-list-row__copy">
      <strong>{title}</strong>
      {description && <span className="ax-list-row__description">{description}</span>}
      {metadata && <span className="ax-list-row__metadata">{metadata}</span>}
    </span>
    {status && <span className="ax-list-row__status">{status}</span>}
  </>
  return (
    <article className={`ax-list-row${selected ? ' is-selected' : ''} ${className}`.trim()}>
      {selection && <div className="ax-list-row__selection">{selection}</div>}
      {onClick
        ? <button aria-current={selected ? 'true' : undefined} className="ax-list-row__main" onClick={onClick} type="button">{content}</button>
        : <div className="ax-list-row__main">{content}</div>}
      {actions && <div className="ax-list-row__actions">{actions}</div>}
    </article>
  )
}

export interface TableColumn {
  key: string
  label: ReactNode
  className?: string
}

export function Table({
  caption,
  children,
  className = '',
  columns,
}: {
  caption: string
  children: ReactNode
  className?: string
  columns: TableColumn[]
}) {
  return (
    <div className={`ax-table-wrap ${className}`.trim()}>
      <table className="ax-table">
        <caption className="sr-only">{caption}</caption>
        <thead><tr>{columns.map((column) => <th className={column.className} key={column.key} scope="col">{column.label}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

export function TableRow({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <tr className={className}>{children}</tr>
}

export function TableCell({
  as = 'td',
  children,
  className = '',
}: {
  as?: 'td' | 'th'
  children: ReactNode
  className?: string
}) {
  return createElement(as, { className, ...(as === 'th' ? { scope: 'row' } : {}) }, children)
}

export function SettingsSection({
  children,
  className = '',
  description,
  eyebrow,
  title,
}: {
  children: ReactNode
  className?: string
  description?: ReactNode
  eyebrow?: ReactNode
  title: ReactNode
}) {
  return (
    <section className={`ax-settings-section ${className}`.trim()}>
      <header>
        {eyebrow && <Text role="eyebrow">{eyebrow}</Text>}
        <Heading as="h2" role="section">{title}</Heading>
        {description && <Text tone="secondary">{description}</Text>}
      </header>
      <div className="ax-settings-section__content">{children}</div>
    </section>
  )
}

export function SettingRow({
  children,
  className = '',
  description,
  label,
}: {
  children: ReactNode
  className?: string
  description?: ReactNode
  label: ReactNode
}) {
  return (
    <div className={`ax-setting-row ${className}`.trim()}>
      <div className="ax-setting-row__copy">
        <strong>{label}</strong>
        {description && <small>{description}</small>}
      </div>
      <div className="ax-setting-row__control">{children}</div>
    </div>
  )
}

export interface ProgressStep<T extends string> {
  value: T
  label: string
}

export function ProgressSteps<T extends string>({
  current,
  label = '任务进度',
  steps,
}: {
  current: T
  label?: string
  steps: ProgressStep<T>[]
}) {
  const currentIndex = Math.max(0, steps.findIndex((step) => step.value === current))
  return (
    <nav aria-label={label} className="ax-progress-steps">
      <ol>
        {steps.map((step, index) => (
          <li className={index < currentIndex ? 'is-completed' : index === currentIndex ? 'is-current' : ''} key={step.value}>
            <span aria-hidden="true" className="ax-progress-steps__marker">{index < currentIndex ? <Icon name="check" size={12} /> : index + 1}</span>
            <span aria-current={index === currentIndex ? 'step' : undefined}>{step.label}</span>
          </li>
        ))}
      </ol>
    </nav>
  )
}

export function EmptyState({
  title,
  description,
  action,
  secondaryAction,
  icon,
  size = 'standard',
}: {
  title: string
  description: string
  action?: ReactNode
  secondaryAction?: ReactNode
  icon?: ReactNode
  size?: 'compact' | 'standard'
}) {
  return (
    <section className={`ax-empty-state ax-empty-state--${size}`}>
      {icon && <div aria-hidden="true" className="ax-empty-state__icon">{icon}</div>}
      <h2>{title}</h2>
      <p>{description}</p>
      {(action || secondaryAction) && <div className="ax-empty-state__actions">{action}{secondaryAction}</div>}
    </section>
  )
}

export function Skeleton({
  label = '正在加载',
  lines = 3,
}: {
  label?: string
  lines?: number
}) {
  return (
    <div aria-label={label} className="ax-skeleton" role="status">
      {Array.from({ length: Math.max(1, lines) }, (_, index) => <span key={index} />)}
    </div>
  )
}

export function LoadingState({ label = '正在加载…' }: { label?: string }) {
  return <div className="ax-loading-state" role="status"><span aria-hidden="true" className="ax-spinner" /><span>{label}</span></div>
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
        <strong>内容未能加载</strong>
        <span>{error}</span>
        {onRetry && <Button onClick={onRetry}>重新加载</Button>}
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
  dismissible = true,
  onClose,
  open,
  role = 'dialog',
  title,
}: {
  children: ReactNode
  dismissible?: boolean
  onClose: () => void
  open: boolean
  role?: 'dialog' | 'alertdialog'
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
      if (event.key === 'Escape' && dismissible) {
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
  }, [dismissible, onClose, open])
  if (!open) return null
  return (
    <div className="ax-dialog-backdrop" onMouseDown={dismissible ? onClose : undefined} role="presentation">
      <section
        aria-label={title}
        aria-labelledby={titleId}
        aria-modal="true"
        className="ax-dialog"
        onMouseDown={(event) => event.stopPropagation()}
        ref={dialogRef}
        role={role}
      >
        <header><h2 id={titleId}>{title}</h2>{dismissible && <IconButton label="关闭" onClick={onClose}><Icon name="close" size={16} /></IconButton>}</header>
        <div className="ax-dialog__body">{children}</div>
      </section>
    </div>
  )
}

export function DialogFooter({ children }: { children: ReactNode }) {
  return <footer className="ax-dialog__footer">{children}</footer>
}

export function Sheet({
  children,
  onClose,
  open,
  side = 'right',
  title,
}: {
  children: ReactNode
  onClose: () => void
  open: boolean
  side?: 'left' | 'right'
  title: string
}) {
  const titleId = useId()
  const sheetRef = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!open) return undefined
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialogFocusableElements(sheetRef.current)[0]?.focus()
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const elements = dialogFocusableElements(sheetRef.current)
      if (!elements.length) return
      const first = elements[0]
      const last = elements[elements.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus()
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
    <div className="ax-sheet-backdrop" onMouseDown={onClose} role="presentation">
      <section
        aria-labelledby={titleId}
        aria-modal="true"
        className={`ax-sheet ax-sheet--${side}`}
        onMouseDown={(event) => event.stopPropagation()}
        ref={sheetRef}
        role="dialog"
      >
        <header><h2 id={titleId}>{title}</h2><IconButton label="关闭" onClick={onClose}><Icon name="close" size={16} /></IconButton></header>
        <div className="ax-sheet__body">{children}</div>
      </section>
    </div>
  )
}

export function Popover({
  children,
  label,
  trigger,
}: {
  children: ReactNode
  label: string
  trigger: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return undefined
    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])
  return (
    <div className="ax-popover" ref={root}>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        className="ax-popover__trigger"
        onClick={() => setOpen((current) => !current)}
        ref={triggerRef}
        type="button"
      >{trigger}</button>
      {open && <div aria-label={label} className="ax-popover__content" role="dialog">{children}</div>}
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
  const openFromKeyboard = (index: number) => {
    setOpen(true)
    window.requestAnimationFrame(() => focusMenuItem(index))
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
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            openFromKeyboard(0)
          } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            openFromKeyboard(Number.MAX_SAFE_INTEGER)
          }
        }}
        ref={triggerRef}
      >
        <Icon name="menu" size={16} />
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

export function DropdownMenu(props: Parameters<typeof Menu>[0]) {
  return <Menu {...props} />
}

export function DropdownMenuItem(props: Parameters<typeof MenuItem>[0]) {
  return <MenuItem {...props} />
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

export function Surface({
  as = 'section',
  className = '',
  children,
  padding = 'none',
  variant = 'default',
  ...props
}: HTMLAttributes<HTMLElement> & {
  as?: 'section' | 'article' | 'div' | 'aside'
  padding?: 'none' | 'compact' | 'standard' | 'spacious'
  variant?: 'default' | 'raised' | 'inset'
}) {
  return createElement(as, {
    ...props,
    className: `ax-surface ax-surface--${variant} ax-surface--padding-${padding} ${className}`.trim(),
  }, children)
}

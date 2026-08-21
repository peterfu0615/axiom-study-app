import { createPortal } from 'react-dom'
import type { ToastState } from '../platform/useToast'
import { Icon } from './Icon'

// All toasts render into one shared fixed-position stack so independently
// owned useToast instances (app-level + per-workspace) stack vertically
// instead of overlapping at identical coordinates.
let stackElement: HTMLDivElement | null = null
function getStackElement() {
  if (!stackElement) {
    stackElement = document.createElement('div')
    stackElement.className = 'ax-toast-stack'
    document.body.appendChild(stackElement)
  }
  return stackElement
}

export function Toast({
  onClose,
  onPause,
  onResume,
  toast,
}: {
  toast: ToastState | null
  onClose?: () => void
  onPause?: () => void
  onResume?: () => void
}) {
  if (!toast) return null
  return createPortal(
    <div
      className={`toast-message toast-${toast.tone} ${
        toast.visible ? 'toast-visible' : 'toast-leaving'
      }`}
      aria-live={toast.tone === 'error' ? 'assertive' : 'polite'}
      onMouseEnter={onPause}
      onMouseLeave={onResume}
      role={toast.tone === 'error' ? 'alert' : 'status'}
    >
      <span className="toast-message__text">{toast.message}</span>
      {toast.visible && toast.action && (
        <button
          className="toast-action"
          onClick={toast.action.onClick}
          type="button"
        >
          {toast.action.label}
        </button>
      )}
      {toast.visible && toast.tone === 'error' && onClose && (
        <button
          aria-label="关闭提示"
          className="toast-close"
          onClick={onClose}
          type="button"
        >
          <Icon name="close" size={14} />
        </button>
      )}
    </div>,
    getStackElement(),
  )
}

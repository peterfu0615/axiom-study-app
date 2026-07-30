import type { ToastState } from '../platform/useToast'

export function Toast({ toast }: { toast: ToastState | null }) {
  if (!toast) return null
  return (
    <div
      className={`toast-message toast-${toast.tone} ${
        toast.visible ? 'toast-visible' : 'toast-leaving'
      }`}
      role="status"
      aria-live="polite"
    >
      {toast.message}
    </div>
  )
}

import { useCallback, useEffect, useRef, useState } from 'react'

export type ToastTone = 'info' | 'success' | 'error'

export interface ToastAction {
  label: string
  onClick: () => void
}

export interface ToastOptions {
  /** Optional inline action (e.g. 「前往错题库」) rendered next to the message. */
  action?: ToastAction
  /** Override the tone-specific default duration (ms). */
  duration?: number
}

export interface ToastState {
  message: string
  tone: ToastTone
  visible: boolean
  action?: ToastAction
}

const DEFAULT_DURATION = 3200
// Errors usually require a decision; they stay up long enough to be read and
// can always be dismissed manually.
const ERROR_DURATION = 8000
const LEAVE_ANIMATION_MS = 220

/**
 * 轻量级 Toast hook：自动在 duration 后消失，支持滑出动画。
 *
 * 用法：
 *   const { toast, notify, dismiss } = useToast()
 *   notify('保存成功', 'success')
 *   notify('保存失败：xxx', 'error')
 *   <Toast toast={toast} onClose={dismiss} onPause={pauseAutoDismiss} onResume={resumeAutoDismiss} />
 */
export function useToast(duration = DEFAULT_DURATION) {
  const [toast, setToast] = useState<ToastState | null>(null)
  const dismissTimerRef = useRef<number | null>(null)
  const hideTimerRef = useRef<number | null>(null)
  // Remaining auto-dismiss time while the toast is hovered (timer paused).
  const remainingRef = useRef<number | null>(null)
  const startedAtRef = useRef(0)

  const clearTimers = useCallback(() => {
    if (dismissTimerRef.current !== null) {
      window.clearTimeout(dismissTimerRef.current)
      dismissTimerRef.current = null
    }
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
    remainingRef.current = null
  }, [])

  const dismiss = useCallback(() => {
    // 触发滑出动画，动画结束后再清空 state
    setToast((current) =>
      current ? { ...current, visible: false } : null,
    )
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
    remainingRef.current = null
    dismissTimerRef.current = window.setTimeout(() => {
      setToast(null)
      dismissTimerRef.current = null
    }, LEAVE_ANIMATION_MS)
  }, [])

  const armHideTimer = useCallback((ms: number) => {
    if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current)
    startedAtRef.current = Date.now()
    remainingRef.current = ms
    hideTimerRef.current = window.setTimeout(() => {
      hideTimerRef.current = null
      remainingRef.current = null
      dismiss()
    }, ms)
  }, [dismiss])

  /** Hovering a toast pauses its auto-dismiss countdown. */
  const pauseAutoDismiss = useCallback(() => {
    if (hideTimerRef.current === null) return
    window.clearTimeout(hideTimerRef.current)
    hideTimerRef.current = null
    remainingRef.current = Math.max(
      0,
      (remainingRef.current ?? 0) - (Date.now() - startedAtRef.current),
    )
  }, [])

  const resumeAutoDismiss = useCallback(() => {
    if (remainingRef.current === null || remainingRef.current <= 0) return
    armHideTimer(remainingRef.current)
  }, [armHideTimer])

  const notify = useCallback(
    (message: string, tone: ToastTone = 'info', options?: ToastOptions) => {
      clearTimers()
      setToast({ message, tone, visible: true, action: options?.action })
      armHideTimer(options?.duration ?? (tone === 'error' ? ERROR_DURATION : duration))
    },
    [duration, clearTimers, armHideTimer],
  )

  // 组件 unmount 时清理定时器，避免内存泄漏
  useEffect(() => clearTimers, [clearTimers])

  return { toast, notify, dismiss, pauseAutoDismiss, resumeAutoDismiss }
}

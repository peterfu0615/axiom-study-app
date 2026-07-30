import { useCallback, useEffect, useRef, useState } from 'react'

export type ToastTone = 'info' | 'success' | 'error'

export interface ToastState {
  message: string
  tone: ToastTone
  visible: boolean
}

const DEFAULT_DURATION = 3200
const LEAVE_ANIMATION_MS = 220

/**
 * 轻量级 Toast hook：自动在 duration 后消失，支持滑出动画。
 *
 * 用法：
 *   const { toast, notify, dismiss } = useToast()
 *   notify('保存成功', 'success')
 *   notify('保存失败：xxx', 'error')
 *   <Toast toast={toast} />
 */
export function useToast(duration = DEFAULT_DURATION) {
  const [toast, setToast] = useState<ToastState | null>(null)
  const dismissTimerRef = useRef<number | null>(null)
  const hideTimerRef = useRef<number | null>(null)

  const clearTimers = useCallback(() => {
    if (dismissTimerRef.current !== null) {
      window.clearTimeout(dismissTimerRef.current)
      dismissTimerRef.current = null
    }
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
  }, [])

  const dismiss = useCallback(() => {
    // 触发滑出动画，动画结束后再清空 state
    setToast((current) =>
      current ? { ...current, visible: false } : null,
    )
    dismissTimerRef.current = window.setTimeout(() => {
      setToast(null)
      dismissTimerRef.current = null
    }, LEAVE_ANIMATION_MS)
  }, [])

  const notify = useCallback(
    (message: string, tone: ToastTone = 'info') => {
      clearTimers()
      setToast({ message, tone, visible: true })
      hideTimerRef.current = window.setTimeout(() => {
        hideTimerRef.current = null
        dismiss()
      }, duration)
    },
    [duration, clearTimers, dismiss],
  )

  // 组件 unmount 时清理定时器，避免内存泄漏
  useEffect(() => clearTimers, [clearTimers])

  return { toast, notify, dismiss }
}

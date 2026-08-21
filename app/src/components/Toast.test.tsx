import { describe, expect, it } from 'vitest'
// @ts-expect-error Vitest executes this contract in Node, while the app tsconfig is browser-only.
import { readFileSync } from 'node:fs'
import type { ToastState } from '../platform/useToast'

const toastSource = readFileSync(new URL('./Toast.tsx', import.meta.url), 'utf8')
const hookSource = readFileSync(new URL('../platform/useToast.ts', import.meta.url), 'utf8')

function state(overrides: Partial<ToastState> = {}): ToastState {
  return { message: '提示', tone: 'info', visible: true, ...overrides }
}

describe('Toast', () => {
  it('portals every instance into one shared stack so concurrent toasts stack, not overlap', () => {
    expect(toastSource).toContain('createPortal')
    expect(toastSource).toContain("stackElement.className = 'ax-toast-stack'")
    expect(toastSource).toContain('document.body.appendChild(stackElement)')
  })

  it('errors are assertive alerts; other tones stay polite status', () => {
    expect(toastSource).toContain("role={toast.tone === 'error' ? 'alert' : 'status'}")
    expect(toastSource).toContain("aria-live={toast.tone === 'error' ? 'assertive' : 'polite'}")
  })

  it('errors can be dismissed manually and support an inline action', () => {
    expect(toastSource).toContain('toast-action')
    expect(toastSource).toContain("toast.visible && toast.tone === 'error' && onClose")
    expect(toastSource).toContain('<Icon name="close" size={14} />')
    // The legacy bare × text symbol must not come back.
    expect(toastSource).not.toContain('>×<')
  })

  it('errors stay visible longer than success/info toasts', () => {
    expect(hookSource).toContain('ERROR_DURATION = 8000')
    expect(hookSource).toContain("tone === 'error' ? ERROR_DURATION : duration")
  })

  it('hovering a toast pauses its auto-dismiss countdown', () => {
    expect(hookSource).toContain('pauseAutoDismiss')
    expect(hookSource).toContain('resumeAutoDismiss')
    expect(toastSource).toContain('onMouseEnter={onPause}')
    expect(toastSource).toContain('onMouseLeave={onResume}')
  })

  it('keeps the action clickable only while visible', () => {
    const visibleAction = state({ action: { label: '前往错题库', onClick: () => undefined } })
    expect(visibleAction.action?.label).toBe('前往错题库')
    expect(toastSource).toContain('toast.visible && toast.action &&')
  })
})

import { describe, expect, it } from 'vitest'
// @ts-expect-error Vitest executes this contract in Node, while the app tsconfig is browser-only.
import { readFileSync } from 'node:fs'

const uiSource = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8')

describe('Dialog overlay behavior', () => {
  it('traps focus and restores it after close', () => {
    expect(uiSource).toContain('DIALOG_FOCUSABLE_SELECTOR')
    expect(uiSource).toContain("event.key !== 'Tab'")
    expect(uiSource).toContain('previouslyFocused?.focus()')
  })

  it('locks background scroll while open', () => {
    expect(uiSource).toContain("document.body.style.overflow = 'hidden'")
    expect(uiSource).toContain('document.body.style.overflow = previousOverflow')
  })

  it('closes on Escape with preventDefault so underlying layers do not react', () => {
    const dialogBlock = uiSource.slice(
      uiSource.indexOf('export function Dialog'),
      uiSource.indexOf('export function Menu'),
    )
    expect(dialogBlock).toContain("event.key === 'Escape'")
    expect(dialogBlock).toContain('event.preventDefault()')
  })

  it('labels the dialog via the title element id', () => {
    expect(uiSource).toContain('aria-labelledby={titleId}')
    expect(uiSource).toContain('<h2 id={titleId}>')
  })
})

describe('Menu keyboard support', () => {
  it('closes on Escape and returns focus to the trigger', () => {
    const menuBlock = uiSource.slice(uiSource.indexOf('export function Menu'))
    expect(menuBlock).toContain("event.key !== 'Escape'")
    expect(menuBlock).toContain('triggerRef.current?.focus()')
  })

  it('supports arrow/Home/End navigation across enabled items', () => {
    const menuBlock = uiSource.slice(uiSource.indexOf('export function Menu'))
    expect(menuBlock).toContain("'.ax-menu__item:not([disabled])'")
    expect(menuBlock).toContain("'ArrowDown'")
    expect(menuBlock).toContain("'ArrowUp'")
    expect(menuBlock).toContain("'Home'")
    expect(menuBlock).toContain("'End'")
  })

  it('declares menu semantics on trigger and popover', () => {
    expect(uiSource).toContain('aria-haspopup="menu"')
    expect(uiSource).toContain('role="menu"')
  })
})

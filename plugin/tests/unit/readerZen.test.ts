/**
 * Zen mode (`src/reader/zen.ts`, `zenChrome.ts`): the device's own choice, when the row under the
 * page shows, when Esc leaves the mode, and one tab's chrome — its classes, the peek and how long
 * it lasts, and Obsidian's phone navigation hidden and given back.
 */
import 'obsidian'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { nextTick, reactive } from 'vue'
import {
  PEEK_LEAVE_MS,
  PEEK_MS,
  ZEN_CLASS,
  ZEN_KEY,
  ZEN_PEEK_CLASS,
  escLeavesZen,
  initZen,
  navHidden,
  setZen,
  zen,
  zenFootAtTop,
  zenFootShown,
  zenStateFrom,
} from '@/reader/zen'
import { ZenChrome, type ZenHost } from '@/reader/zenChrome'
import { emptyBookModel, type BookModel } from '@/reader/model'

const storage = () => {
  const kept = new Map<string, unknown>()
  return {
    kept,
    loadLocalStorage: (k: string) => kept.get(k) ?? null,
    saveLocalStorage: (k: string, v: unknown) => (v === null ? kept.delete(k) : kept.set(k, v)),
  }
}

describe('the device’s choice', () => {
  it('reads anything unknown as off', () => {
    expect(zenStateFrom(null)).toEqual({ on: false })
    expect(zenStateFrom({ on: 'yes' })).toEqual({ on: false })
    expect(zenStateFrom({ on: true })).toEqual({ on: true })
  })

  it('is kept on this device while on, and leaves nothing behind when off', () => {
    const s = storage()
    initZen(s)
    expect(zen().on).toBe(false)
    setZen(true)
    expect(s.kept.get(ZEN_KEY)).toEqual({ on: true })
    initZen(s)
    expect(zen().on).toBe(true)
    setZen(false)
    expect(s.kept.has(ZEN_KEY)).toBe(false)
  })
})

describe('what shows in zen mode', () => {
  const m = (patch: Partial<BookModel> = {}) => ({ ...emptyBookModel(), ...patch })
  const sel = { cfi: 'x', text: 'words', label: '' }

  it('hides the row under the page unless something needs it', () => {
    expect(zenFootShown(m())).toBe(false)
    expect(zenFootShown(m({ zenPeek: true }))).toBe(true)
    expect(zenFootShown(m({ selection: sel }))).toBe(true)
    // Still selecting: the bar waits until the finger lets go, as it does outside the mode.
    expect(zenFootShown(m({ selection: sel, selecting: true }))).toBe(false)
    expect(zenFootShown(m({ ink: { ...emptyBookModel().ink, on: true } }))).toBe(true)
  })

  it('puts the bar for words at the top of the page when at the foot it would cover them', () => {
    const page = { top: 0, bottom: 800 }
    const line = (top: number) => ({ top, bottom: top + 20 })
    // Nothing selected, or words high on the page: the bar stays at the foot.
    expect(zenFootAtTop([], page, 44)).toBe(false)
    expect(zenFootAtTop([line(100)], page, 44)).toBe(false)
    expect(zenFootAtTop([line(730)], page, 44)).toBe(false)
    // On the last lines, where the bar lies: it goes to the top.
    expect(zenFootAtTop([line(760)], page, 44)).toBe(true)
    expect(zenFootAtTop([line(700), line(770)], page, 44)).toBe(true)
    // Words at both ends of the page: nowhere is free, it stays where it always is.
    expect(zenFootAtTop([line(10), line(770)], page, 44)).toBe(false)
    // Measured against the page where it is, not the window.
    expect(zenFootAtTop([line(760)], { top: 100, bottom: 900 }, 44)).toBe(false)
  })

  it('lets Esc leave the mode only when there is nothing nearer to close', () => {
    expect(escLeavesZen(m())).toBe(true)
    expect(escLeavesZen(m({ selection: sel }))).toBe(false)
    expect(escLeavesZen(m({ panel: true }))).toBe(false)
    expect(escLeavesZen(m({ settingsOpen: true }))).toBe(false)
    // A peek is not something to close first.
    expect(escLeavesZen(m({ zenPeek: true }))).toBe(true)
  })

  it('hides Obsidian’s navigation only on a phone, for the tab in front, without a peek', () => {
    const on = { on: true, front: true, phone: true, peek: false }
    expect(navHidden(on)).toBe(true)
    expect(navHidden({ ...on, on: false })).toBe(false)
    expect(navHidden({ ...on, front: false })).toBe(false)
    expect(navHidden({ ...on, phone: false })).toBe(false)
    expect(navHidden({ ...on, peek: true })).toBe(false)
  })
})

describe('one tab’s chrome', () => {
  let host: ZenHost & { el: HTMLElement }
  let navbar: {
    hideNavigation: ReturnType<typeof vi.fn>
    restoreNavigation: ReturnType<typeof vi.fn>
  }
  let chrome: ZenChrome | null = null
  let front = true

  const make = (opts: { phone?: boolean; touch?: boolean } = {}) => {
    const el = document.createElement('div')
    document.body.appendChild(el)
    navbar = {
      // What Obsidian's own does: a class on the body.
      hideNavigation: vi.fn(() => document.body.classList.add('is-hidden-nav')),
      restoreNavigation: vi.fn(() => document.body.classList.remove('is-hidden-nav')),
    }
    host = {
      el,
      containerEl: el,
      model: reactive(emptyBookModel()),
      navbar: () => navbar,
      phone: opts.phone ?? false,
      touch: opts.touch ?? false,
      front: () => front,
      still: () => false,
    }
    chrome = new ZenChrome(host)
    return chrome
  }

  beforeEach(() => {
    vi.useFakeTimers()
    initZen(storage())
    front = true
    document.body.className = ''
  })

  afterEach(() => {
    chrome?.destroy()
    chrome = null
    document.body.replaceChildren()
    vi.useRealTimers()
  })

  it('carries the mode’s class while it is on', async () => {
    make()
    expect(host.el.classList.contains(ZEN_CLASS)).toBe(false)
    setZen(true)
    await nextTick()
    expect(host.el.classList.contains(ZEN_CLASS)).toBe(true)
    setZen(false)
    await nextTick()
    expect(host.el.classList.contains(ZEN_CLASS)).toBe(false)
  })

  it('shows the chrome on a tap in the middle of a touch screen, for a moment or until the next', async () => {
    const c = make({ touch: true })
    c.middleTap()
    expect(host.model.zenPeek).toBe(false)
    setZen(true)
    await nextTick()
    c.middleTap()
    await nextTick()
    expect(host.model.zenPeek).toBe(true)
    expect(host.el.classList.contains(ZEN_PEEK_CLASS)).toBe(true)
    c.middleTap()
    expect(host.model.zenPeek).toBe(false)
    c.middleTap()
    vi.advanceTimersByTime(PEEK_MS + 10)
    expect(host.model.zenPeek).toBe(false)
  })

  it('keeps the peek while a menu opened from the chrome is up', async () => {
    const c = make({ touch: true })
    setZen(true)
    await nextTick()
    c.middleTap()
    const menu = document.body.createDiv({ cls: 'menu' })
    vi.advanceTimersByTime(PEEK_MS + 2000)
    expect(host.model.zenPeek).toBe(true)
    menu.remove()
    vi.advanceTimersByTime(1100)
    expect(host.model.zenPeek).toBe(false)
  })

  it('does nothing on a tap in the middle of a computer’s page', async () => {
    const c = make({ touch: false })
    setZen(true)
    await nextTick()
    c.middleTap()
    expect(host.model.zenPeek).toBe(false)
  })

  it('shows the chrome under the mouse at the top of the tab, and puts it away after it leaves', async () => {
    make()
    setZen(true)
    await nextTick()
    const edge = host.el.querySelector('.abele-book-zen-edge')!
    edge.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    expect(host.model.zenPeek).toBe(true)
    vi.advanceTimersByTime(PEEK_MS * 3)
    expect(host.model.zenPeek).toBe(true)
    const page = host.el.createDiv()
    page.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    expect(host.model.zenPeek).toBe(true)
    vi.advanceTimersByTime(PEEK_LEAVE_MS + 10)
    expect(host.model.zenPeek).toBe(false)
  })

  it('hides Obsidian’s phone navigation, hides it again when Obsidian brings it back, and gives it back', async () => {
    const c = make({ phone: true, touch: true })
    expect(navbar.hideNavigation).not.toHaveBeenCalled()
    setZen(true)
    await nextTick()
    expect(document.body.classList.contains('is-hidden-nav')).toBe(true)
    // Obsidian restores it on any press in the app's window.
    document.body.classList.remove('is-hidden-nav')
    await Promise.resolve()
    expect(document.body.classList.contains('is-hidden-nav')).toBe(true)
    // A peek shows it; the peek running out hides it again.
    c.middleTap()
    await nextTick()
    expect(document.body.classList.contains('is-hidden-nav')).toBe(false)
    vi.advanceTimersByTime(PEEK_MS + 10)
    await nextTick()
    expect(document.body.classList.contains('is-hidden-nav')).toBe(true)
    // Another tab in front: given back.
    front = false
    c.frontChanged()
    expect(document.body.classList.contains('is-hidden-nav')).toBe(false)
    front = true
    c.frontChanged()
    expect(document.body.classList.contains('is-hidden-nav')).toBe(true)
    setZen(false)
    await nextTick()
    expect(document.body.classList.contains('is-hidden-nav')).toBe(false)
  })

  it('gives the navigation back when the tab closes in zen mode', async () => {
    const c = make({ phone: true, touch: true })
    setZen(true)
    await nextTick()
    c.destroy()
    chrome = null
    expect(document.body.classList.contains('is-hidden-nav')).toBe(false)
    expect(host.el.classList.contains(ZEN_CLASS)).toBe(false)
  })
})

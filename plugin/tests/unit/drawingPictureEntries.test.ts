/**
 * The pen in the header of Obsidian's picture tabs (`drawing/pictureEntries.ts`): one per tab
 * showing a picture that can be drawn on, none on any other, and none left once the plugin stops.
 */
import { describe, it, expect, vi } from 'vitest'
import {
  PenOnPictureTabs,
  PictureEmbedMenus,
  PEN_ACTION_CLASS,
  type EmbeddedPicture,
  type PictureTab,
} from '@/drawing/pictureEntries'
import type { App } from 'obsidian'

function tab(path: string | null): PictureTab & { header: HTMLElement; click(): void } {
  const header = document.createElement('div')
  const t = {
    header,
    file: path ? { path, extension: path.slice(path.lastIndexOf('.') + 1) } : null,
    addAction(icon: string, title: string, callback: (evt: MouseEvent) => unknown) {
      const el = document.createElement('button')
      el.dataset.icon = icon
      el.setAttribute('aria-label', title)
      el.addEventListener('click', (e) => callback(e))
      header.prepend(el)
      return el
    },
    click() {
      header.querySelector<HTMLElement>(`.${PEN_ACTION_CLASS}`)?.click()
    },
  }
  return t
}

describe('the pen in a picture tab', () => {
  it('is added once to a tab showing a picture that can be drawn on, and opens it', () => {
    const cat = tab('Pics/cat.PNG')
    const open = vi.fn()
    const pens = new PenOnPictureTabs(() => [cat], open)
    pens.sync()
    pens.sync()
    const buttons = cat.header.querySelectorAll(`.${PEN_ACTION_CLASS}`)
    expect(buttons).toHaveLength(1)
    expect(buttons[0].getAttribute('aria-label')).toBe('Draw on this picture')
    expect((buttons[0] as HTMLElement).dataset.icon).toBe('pen-line')
    cat.click()
    expect(open).toHaveBeenCalledWith('Pics/cat.PNG')
  })

  it('is not added to a picture that cannot be drawn on, and leaves when the file changes', () => {
    const svg = tab('a.svg')
    const cat = tab('cat.jpg')
    const pens = new PenOnPictureTabs(() => [svg, cat], vi.fn())
    pens.sync()
    expect(svg.header.children).toHaveLength(0)
    expect(cat.header.children).toHaveLength(1)
    cat.file = { path: 'b.svg', extension: 'svg' }
    pens.sync()
    expect(cat.header.children).toHaveLength(0)
    cat.file = { path: 'c.webp', extension: 'webp' }
    pens.sync()
    expect(cat.header.children).toHaveLength(1)
  })

  it('is taken off every tab when the plugin stops, and forgets a closed tab', () => {
    const one = tab('one.gif')
    const two = tab('two.bmp')
    let open = [one, two]
    const pens = new PenOnPictureTabs(() => open, vi.fn())
    pens.sync()
    open = [one]
    pens.sync()
    pens.stop()
    expect(one.header.children).toHaveLength(0)
    pens.sync()
    expect(one.header.children).toHaveLength(1)
    pens.stop()
    expect(one.header.children).toHaveLength(0)
  })
})

describe('a long press on a picture being edited, on a phone', () => {
  /** A picture in an editor, the press on it held `heldMs`, and whether its lift was cancelled. */
  function press(heldMs: number, menuUp: boolean): boolean {
    vi.useFakeTimers()
    try {
      const menus = new PictureEmbedMenus({} as App, () => {})
      const found = { file: { path: 'pic.png' }, anchor: null, reading: false }
      vi.spyOn(menus, 'pictureAt').mockReturnValue(found as unknown as EmbeddedPicture)
      document.body.innerHTML =
        '<div class="cm-editor"><span class="internal-embed image-embed"><img></span></div>'
      const img = document.querySelector('img')!
      const touch = { clientX: 5, clientY: 5 }
      menus.onTouchStart({ target: img, touches: [touch] } as unknown as TouchEvent)
      vi.advanceTimersByTime(heldMs)
      // Obsidian's own image menu, which it opens for the press about 0.8 s in.
      if (menuUp) document.body.appendChild(document.createElement('div')).className = 'menu'
      const preventDefault = vi.fn()
      menus.onTouchEnd({
        target: img,
        touches: [],
        cancelable: true,
        preventDefault,
      } as unknown as TouchEvent)
      return preventDefault.mock.calls.length > 0
    } finally {
      document.body.innerHTML = ''
      vi.useRealTimers()
    }
  }

  it('lifts without a tap once Obsidian has opened its menu for it, so the menu stays', () => {
    expect(press(900, true)).toBe(true)
  })

  it('leaves a tap a tap, and a long press with no menu yet alone', () => {
    expect(press(100, false)).toBe(false)
    expect(press(100, true)).toBe(false)
    expect(press(900, false)).toBe(false)
  })
})

/**
 * The box a drawing is shown in inside a note (`drawing/embed.ts`), as a phone runs it: the
 * picture follows the drawing when the phone's address of the file never changes, and the
 * buttons over the part being changed answer a finger. Its buttons wait for a finger: the first
 * tap on the drawing shows them and does nothing else, and they go again after a while or a tap
 * elsewhere; a mouse sees them while it is over the drawing, and a finger's hover is not that.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { TFile, type App } from 'obsidian'
import { DrawingEmbed } from '@/drawing/embed'
import { drawingSvg } from '@/drawing/drawingFile'
import type { DrawingItem } from '@/drawing/items'

/** A pen stroke from one point to another, as the drawing keeps it. */
const stroke = (x1: number, y1: number, x2: number, y2: number): DrawingItem =>
  ({
    type: 'stroke',
    id: `s${x1}${y1}`,
    tool: 'pen',
    color: 'black',
    size: 3,
    points: [x1, y1, 0.5, x2, y2, 0.5],
  }) as DrawingItem

/** An iPad's app: the address of a file is the same before and after it changes. */
function phoneApp(file: TFile, text: { now: string }, start = '> [!drawing]\n> ![[Sketch.svg]]\n') {
  const modified: ((f: TFile) => void)[] = []
  const written: string[] = []
  let note = start
  const noteFile = Object.assign(new TFile(), { path: 'Note.md', extension: 'md' })
  const app = {
    metadataCache: {
      getFirstLinkpathDest: (link: string) => (link === file.path ? file : null),
    },
    vault: {
      on: (name: string, cb: (f: TFile) => void) => {
        if (name === 'modify') modified.push(cb)
        return {}
      },
      cachedRead: () => Promise.resolve(text.now),
      getResourcePath: () => 'capacitor://localhost/_capacitor_file_/vault/Sketch.svg',
      getAbstractFileByPath: (p: string) => (p === 'Note.md' ? noteFile : null),
      process: (_f: TFile, fn: (t: string) => string) => {
        note = fn(note)
        written.push(note)
        return Promise.resolve(note)
      },
    },
  } as unknown as App
  return {
    app,
    written,
    modify: () => {
      file.stat = { ...file.stat, mtime: file.stat.mtime + 1000, size: text.now.length }
      for (const cb of modified) cb(file)
    },
  }
}

import { useFakeClock } from '../helpers/fakeClock'
const advance = useFakeClock()
const settle = () => advance(20)

describe('a drawing’s box in a note on an iPad', () => {
  let file: TFile
  let text: { now: string }
  let callout: HTMLElement
  let embed: HTMLElement

  beforeEach(() => {
    text = { now: drawingSvg({ items: [] }) }
    file = Object.assign(new TFile(), {
      path: 'Sketch.svg',
      basename: 'Sketch',
      extension: 'svg',
      stat: { ctime: 1, mtime: 1000, size: text.now.length },
    })
    document.body.empty()
    callout = document.body.createDiv({ cls: 'callout' })
    callout.setAttribute('data-callout', 'drawing')
    embed = callout.createSpan({ cls: 'internal-embed' })
    embed.setAttribute('src', 'Sketch.svg')
  })

  it('shows what was drawn after the drawing is saved, though the file’s address is the same', async () => {
    const phone = phoneApp(file, text)
    const box = new DrawingEmbed(phone.app, embed, file, {
      sourcePath: 'Note.md',
      callout,
      place: () => ({ from: 0 }),
    })
    box.load()
    box.onload()
    await settle()
    const img = embed.querySelector<HTMLImageElement>('.abele-drawing-embed__picture')!
    const before = img.getAttribute('src')
    expect(before).toBeTruthy()

    text.now = drawingSvg({ items: [stroke(0, 0, 400, 500)] })
    phone.modify()
    await settle()
    // The browser loads a picture again only for another address: the same one keeps the old one.
    expect(img.getAttribute('src')).not.toBe(before)
  })

  it('keeps the part when ✓ is tapped with a finger after the part was moved', async () => {
    const phone = phoneApp(file, text)
    const box = new DrawingEmbed(phone.app, embed, file, {
      sourcePath: 'Note.md',
      callout,
      place: () => ({ from: 0 }),
    })
    box.load()
    box.onload()
    await settle()
    embed.querySelector<HTMLElement>('.abele-drawing-embed__adjust')!.click()
    const keep = embed.querySelector<HTMLElement>('.abele-drawing-embed__keep')!
    expect(keep).toBeTruthy()

    // Safari makes the click out of the finger's lift only if nothing cancelled that lift.
    const lift = new Event('touchend', { bubbles: true, cancelable: true })
    keep.dispatchEvent(new Event('touchstart', { bubbles: true, cancelable: true }))
    keep.dispatchEvent(lift)
    expect(lift.defaultPrevented).toBe(false)
    keep.click()
    await settle()
    expect(phone.written).toHaveLength(1)
    expect(embed.querySelector('.abele-drawing-embed__keep')).toBeNull()
  })

  it('keeps a part changed in an embed alone in its link, with no callout round it', async () => {
    const phone = phoneApp(file, text, 'Plan\n\n![[Sketch.svg#part=0,0,300,200|240]]\n')
    document.body.empty()
    const line = document.body.createDiv()
    const plain = line.createSpan({ cls: 'internal-embed' })
    plain.setAttribute('src', 'Sketch.svg#part=0,0,300,200')
    const box = new DrawingEmbed(phone.app, plain, file, {
      sourcePath: 'Note.md',
      callout: null,
      place: () => ({ from: 2, to: 2 }),
    })
    box.load()
    box.onload()
    await settle()
    plain.querySelector<HTMLElement>('.abele-drawing-embed__adjust')!.click()
    plain.querySelector<HTMLElement>('.abele-drawing-embed__whole')!.click()
    plain.querySelector<HTMLElement>('.abele-drawing-embed__keep')!.click()
    await settle()
    expect(phone.written).toEqual(['Plan\n\n![[Sketch.svg|240]]\n'])
  })

  describe('its buttons, on a touch screen', () => {
    afterEach(() => vi.useRealTimers())

    const tap = (el: HTMLElement, pointerType = 'touch') => {
      const down = new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType })
      el.dispatchEvent(down)
      if (pointerType !== 'mouse') {
        el.dispatchEvent(new Event('touchstart', { bubbles: true, cancelable: true }))
        el.dispatchEvent(new Event('touchend', { bubbles: true, cancelable: true }))
      }
      const press = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
      el.dispatchEvent(press)
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }))
      const click = new MouseEvent('click', { bubbles: true, cancelable: true })
      el.dispatchEvent(click)
      return Object.assign(click, { press })
    }

    const mount = async () => {
      const phone = phoneApp(file, text)
      const box = new DrawingEmbed(phone.app, embed, file, {
        sourcePath: 'Note.md',
        callout,
        place: () => ({ from: 0 }),
      })
      box.load()
      box.onload()
      await settle()
      return embed.querySelector<HTMLElement>('.abele-drawing-embed')!
    }

    it('shows them on the first tap, which reaches nothing else, and hides them after a while', async () => {
      const heard: string[] = []
      for (const type of ['pointerdown', 'touchstart', 'mousedown', 'click'])
        document.body.addEventListener(type, () => heard.push(type))
      const el = await mount()
      expect(el.classList.contains('abele-drawing-embed_shown')).toBe(false)
      vi.useFakeTimers()
      const first = tap(el)
      expect(el.classList.contains('abele-drawing-embed_shown')).toBe(true)
      // Not the note's: the cursor is not moved into the embed and nothing is opened, and the
      // embed is not focused, which would bring the keyboard up.
      expect(heard).toEqual([])
      expect(first.press.defaultPrevented).toBe(true)
      // Shown, a tap on the drawing is the note's again.
      tap(el)
      expect(heard).toContain('click')
      vi.advanceTimersByTime(6000)
      expect(el.classList.contains('abele-drawing-embed_shown')).toBe(false)
    })

    it('hides them at a tap elsewhere, and leaves a mouse’s click alone', async () => {
      const el = await mount()
      tap(el)
      expect(el.classList.contains('abele-drawing-embed_shown')).toBe(true)
      tap(document.body.createDiv())
      expect(el.classList.contains('abele-drawing-embed_shown')).toBe(false)
      const click = tap(el, 'mouse')
      expect(click.defaultPrevented).toBe(false)
      expect(el.classList.contains('abele-drawing-embed_shown')).toBe(false)
    })

    it('shows them to a mouse over the drawing, and not to a finger resting there', async () => {
      const el = await mount()
      el.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'touch' }))
      expect(el.classList.contains('abele-drawing-embed_hover')).toBe(false)
      el.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }))
      expect(el.classList.contains('abele-drawing-embed_hover')).toBe(true)
      el.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }))
      expect(el.classList.contains('abele-drawing-embed_hover')).toBe(false)
    })

    it('leaves a finger on the resizing corner to the corner, buttons or not', async () => {
      const el = await mount()
      const handle = el.querySelector<HTMLElement>('.abele-drawing-embed__resize')!
      let heard = false
      handle.addEventListener('pointerdown', () => (heard = true))
      handle.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'touch' })
      )
      expect(heard).toBe(true)
      expect(el.classList.contains('abele-drawing-embed_shown')).toBe(false)
    })

    it('keeps them while the part is being changed', async () => {
      const el = await mount()
      vi.useFakeTimers()
      tap(el)
      el.querySelector<HTMLElement>('.abele-drawing-embed__adjust')!.click()
      vi.advanceTimersByTime(10000)
      expect(el.querySelector('.abele-drawing-embed__keep')).not.toBeNull()
      expect(
        el.classList.contains('abele-drawing-embed_shown') ||
          el.classList.contains('abele-drawing-embed_adjusting')
      ).toBe(true)
    })
  })
})

/**
 * The box a drawing is shown in inside a note (`drawing/embed.ts`), as a phone runs it: the
 * picture follows the drawing when the phone's address of the file never changes, and the
 * buttons over the part being changed answer a finger.
 */
import { describe, it, expect, beforeEach } from 'vitest'
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
function phoneApp(file: TFile, text: { now: string }) {
  const modified: ((f: TFile) => void)[] = []
  const written: string[] = []
  let note = '> [!drawing]\n> ![[Sketch.svg]]\n'
  const noteFile = Object.assign(new TFile(), { path: 'Note.md', extension: 'md' })
  const app = {
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

const settle = () => new Promise((r) => setTimeout(r, 20))

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
})

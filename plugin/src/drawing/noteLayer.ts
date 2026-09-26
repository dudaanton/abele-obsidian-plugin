/**
 * Notes shown on a drawing, in its tab: each note rendered as Obsidian renders it, in a card of
 * its box, under the ink — what is drawn goes over a note. A card is a picture of its note: a
 * card scaled up shows the same lines larger, and a card moves and scales as any item. It follows
 * its note as the note changes.
 *
 * The cards take no touches of their own; the drawing's surface does, and a tap on a card with
 * drawing off opens its note.
 *
 * The card is white paper like the drawing, so the note's text inside it is set in the light
 * theme's colours whatever the app's theme.
 */
import { Component, MarkdownRenderer, TFile, type App } from 'obsidian'
import { boundsOf, intersects, type DrawingItem, type NoteItem, type Rect } from './items'
import { toScreen, visibleRect, type Camera } from './camera'
import { CARD, noteName } from './noteCard'
import { floatedBox, type Float } from './editTools'

const XHTML = 'http://www.w3.org/1999/xhtml'

interface Card {
  item: NoteItem
  el: HTMLElement
  title: HTMLElement
  body: HTMLElement
  component: Component | null
  /** The path its body was rendered from; empty until it is. */
  rendered: string
}

export class NoteLayer {
  readonly el: HTMLElement
  private readonly cards = new Map<string, Card>()

  constructor(
    parent: HTMLElement,
    private readonly app: App,
    private readonly sourcePath: () => string
  ) {
    this.el = parent.ownerDocument.createElementNS(XHTML, 'div')
    this.el.className = 'abele-drawing-notes'
    parent.prepend(this.el)
  }

  destroy(): void {
    for (const card of this.cards.values()) card.component?.unload()
    this.cards.clear()
    this.el.remove()
  }

  /**
   * Every note of the drawing in its place for a camera; the ones being dragged where the drag
   * puts them. A card out of view is hidden, and rendered only once it first comes into view.
   */
  sync(
    items: readonly DrawingItem[],
    camera: Camera,
    width: number,
    height: number,
    drag: { ids: ReadonlySet<string>; float: Float } | null
  ): void {
    const seen = new Set<string>()
    const view = visibleRect(camera, width, height)
    for (const item of items) {
      if (item.type !== 'note') continue
      seen.add(item.id)
      let card = this.cards.get(item.id)
      if (!card) {
        card = this.make(item)
        this.cards.set(item.id, card)
      }
      card.item = item
      const box: Rect = drag?.ids.has(item.id)
        ? floatedBox(boundsOf(item), drag.float)
        : boundsOf(item)
      const shown = intersects(box, view)
      card.el.toggle(shown)
      if (!shown) continue
      if (card.rendered !== item.path) void this.render(card)
      const scale = (box.w / item.w) * item.scale
      const [sx, sy] = toScreen(camera, box.x, box.y)
      card.el.setCssStyles({
        width: `${item.w / item.scale}px`,
        height: `${item.h / item.scale}px`,
        transform: `translate(${sx}px, ${sy}px) scale(${camera.zoom * scale})`,
      })
    }
    for (const [id, card] of this.cards)
      if (!seen.has(id)) {
        card.component?.unload()
        card.el.remove()
        this.cards.delete(id)
      }
  }

  /** A note changed: every card of it shows it as it is now. */
  refresh(path: string): void {
    for (const card of this.cards.values())
      if (card.item.path === path && card.rendered) void this.render(card)
  }

  private make(item: NoteItem): Card {
    const el = this.el.createDiv({ cls: 'abele-drawing-note theme-light' })
    el.setCssStyles({ backgroundColor: CARD.fill, borderColor: CARD.edge })
    const title = el.createDiv({ cls: 'abele-drawing-note__title', text: noteName(item.path) })
    const body = el.createDiv({ cls: 'abele-drawing-note__body markdown-rendered' })
    return { item, el, title, body, component: null, rendered: '' }
  }

  private async render(card: Card): Promise<void> {
    const path = card.item.path
    card.rendered = path
    card.title.setText(noteName(path))
    const file = this.app.vault.getAbstractFileByPath(path)
    card.component?.unload()
    card.component = new Component()
    card.component.load()
    card.body.empty()
    if (!(file instanceof TFile)) {
      card.body.createEl('p', {
        cls: 'abele-drawing-note__missing',
        text: 'This note is not in the vault.',
      })
      return
    }
    const text = await this.app.vault.cachedRead(file)
    if (card.rendered !== path) return
    await MarkdownRenderer.render(
      this.app,
      text,
      card.body,
      file.path || this.sourcePath(),
      card.component
    )
  }
}

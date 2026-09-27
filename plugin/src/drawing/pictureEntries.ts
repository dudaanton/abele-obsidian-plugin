/**
 * Drawing on a picture, begun where the picture is looked at: a pen in the header of Obsidian's
 * own picture tab, and "Draw on this picture" in the menu of a picture embedded in a note — in
 * reading view, where Obsidian gives a picture no menu of its own, and in live preview, where
 * its link menu already carries the item and only needs to know which embed it was opened on.
 *
 * Knowing the embed is what lets the drawing be saved back into the note in its place.
 */
import { EditorView } from '@codemirror/view'
import { TFile, editorInfoField, type App, type MarkdownPostProcessorContext, Menu } from 'obsidian'
import { DRAWABLE_PICTURES } from './viewType'
import { pickEmbed, type EmbedAnchor, type EmbedHint } from './embedRelink'

export const DRAW_ON_PICTURE = 'Draw on this picture'
export const PEN_ACTION_CLASS = 'abele-draw-on-picture'
/** How long a press has to be held to be a long one. */
const LONG_PRESS_MS = 500
/**
 * When the plugin's own menu opens after a long press began, if Obsidian's has not: Obsidian's
 * comes about 0.8 s in, and is given time to.
 */
const OWN_MENU_MS = 1200

/** A file that can be drawn on. */
export function isDrawable(file: { extension: string } | null | undefined): boolean {
  return !!file && DRAWABLE_PICTURES.includes(file.extension.toLowerCase())
}

/** What of a picture tab the pen needs: its file, and a place for a button in its header. */
export interface PictureTab {
  file: { path: string; extension: string } | null
  addAction(icon: string, title: string, callback: (evt: MouseEvent) => unknown): HTMLElement
}

/**
 * The pen in the header of every picture tab: added once to each, taken off a tab whose file
 * can no longer be drawn on, and off all of them when the plugin stops.
 */
export class PenOnPictureTabs {
  private readonly pens = new Map<PictureTab, HTMLElement>()

  constructor(
    private readonly tabs: () => PictureTab[],
    private readonly open: (path: string) => void
  ) {}

  sync(): void {
    const live = new Set(this.tabs())
    for (const tab of live) {
      const pen = this.pens.get(tab)
      if (isDrawable(tab.file) && !pen) {
        const el = tab.addAction('pen-line', DRAW_ON_PICTURE, () => {
          if (tab.file) this.open(tab.file.path)
        })
        el.classList.add(PEN_ACTION_CLASS)
        this.pens.set(tab, el)
      } else if (!isDrawable(tab.file) && pen) {
        pen.remove()
        this.pens.delete(tab)
      }
    }
    // A tab closed takes its header, and its pen, with it.
    for (const tab of [...this.pens.keys()]) if (!live.has(tab)) this.pens.delete(tab)
  }

  stop(): void {
    for (const el of this.pens.values()) el.remove()
    this.pens.clear()
  }
}

/** A picture embedded in a note, as found under a click. */
export interface EmbeddedPicture {
  file: TFile
  /** The embed it was shown by, when it can be told apart from the note's other embeds. */
  anchor: EmbedAnchor | null
  /** Shown in reading view (or a note embedded in one), where Obsidian gives it no menu. */
  reading: boolean
}

/**
 * The menus of pictures embedded in notes. Reading view's blocks are remembered as they are
 * rendered, for the lines each came from; a right click on a picture is caught on its way down, so the embed is known by the time any menu is built.
 */
export class PictureEmbedMenus {
  private readonly blocks = new WeakMap<HTMLElement, MarkdownPostProcessorContext>()
  private last: { path: string; anchor: EmbedAnchor | null; at: number; taken: boolean } | null =
    null

  constructor(
    private readonly app: App,
    private readonly open: (path: string, anchor: EmbedAnchor | null) => void
  ) {}

  /** For `registerMarkdownPostProcessor`: remembers a rendered block and where it came from. */
  readonly remember = (el: HTMLElement, ctx: MarkdownPostProcessorContext): void => {
    this.blocks.set(el, ctx)
  }

  /** For a capturing `contextmenu` listener on every window's document. */
  readonly onContextMenu = (evt: MouseEvent): void => {
    // Duck-typed: a popout window's elements are not this window's `HTMLElement`.
    const target = evt.target as HTMLElement | null
    if (target?.tagName !== 'IMG') return
    const span = target.closest<HTMLElement>('.internal-embed.image-embed')
    if (!span) return
    const found = this.pictureAt(span)
    if (!found) return
    const last = { path: found.file.path, anchor: found.anchor, at: Date.now(), taken: false }
    this.last = last
    if (!found.reading) return
    evt.preventDefault()
    // Obsidian's own menu, should it ever give one here, carries the item already.
    const { clientX: x, clientY: y } = evt
    window.setTimeout(() => {
      if (last.taken) return
      last.taken = true
      this.showMenu(found, x, y, span.ownerDocument)
    }, 0)
  }

  /**
   * A long press on a picture being edited, on a phone. There no `contextmenu` arrives: Obsidian
   * answers the press with its image menu about 0.8 s in, though not every time was it seen to,
   * and that menu is built without the embed being known. So the embed is noted as
   * the finger lands — for Obsidian's menu, should it come — and, if no menu has come a moment
   * after a long press, the plugin's own is shown. Reading view is left alone: the system's own
   * menu for a picture (Share, Save to Photos) answers there.
   */
  private press: { timer: number; x: number; y: number; fired: boolean; since: number } | null =
    null

  readonly onTouchStart = (evt: TouchEvent): void => {
    this.cancelPress()
    const target = evt.target as HTMLElement | null
    if (evt.touches.length !== 1 || target?.tagName !== 'IMG') return
    const span = target.closest<HTMLElement>('.cm-editor .internal-embed.image-embed')
    if (!span) return
    const found = this.pictureAt(span)
    if (!found) return
    const last = { path: found.file.path, anchor: found.anchor, at: Date.now(), taken: false }
    this.last = last
    const { clientX: x, clientY: y } = evt.touches[0]
    const press = { timer: 0, x, y, fired: false, since: Date.now() }
    press.timer = window.setTimeout(() => {
      if (last.taken || span.ownerDocument.querySelector('.menu')) return
      last.taken = true
      press.fired = true
      this.showMenu(found, x, y, span.ownerDocument)
    }, OWN_MENU_MS)
    this.press = press
  }

  readonly onTouchMove = (evt: TouchEvent): void => {
    const press = this.press
    const touch = evt.touches[0]
    if (
      press &&
      !press.fired &&
      touch &&
      Math.hypot(touch.clientX - press.x, touch.clientY - press.y) > 10
    )
      this.cancelPress()
  }

  readonly onTouchEnd = (evt: TouchEvent): void => {
    const press = this.press
    if (!press) return
    const held = Date.now() - press.since >= LONG_PRESS_MS
    // The finger lifted after a menu opened, the plugin's or the one Obsidian opens for the press:
    // not a tap that puts the caret into the embed — nor, where the browser turns the lift into a
    // click, one that lands outside that menu and closes it again.
    const doc = (evt.target as Node | null)?.ownerDocument
    const menuUp = held && !!doc?.querySelector('.menu')
    if ((press.fired || menuUp) && evt.cancelable) evt.preventDefault()
    // A long press lifted before any menu came still gets one; a tap does not.
    if (press.fired || !held) this.cancelPress()
  }

  private cancelPress(): void {
    if (this.press) window.clearTimeout(this.press.timer)
    this.press = null
  }

  private showMenu(found: EmbeddedPicture, x: number, y: number, doc: Document): void {
    const menu = new Menu()
    menu.addItem((item) =>
      item
        .setTitle(DRAW_ON_PICTURE)
        .setIcon('pen-line')
        .onClick(() => this.open(found.file.path, found.anchor))
    )
    menu.showAtPosition({ x, y }, doc)
  }

  /** The embed of `path` right-clicked a moment ago, for the link menu being built for it. */
  take(path: string): EmbedAnchor | null {
    const last = this.last
    if (!last || last.path !== path || Date.now() - last.at > 5000) return null
    last.taken = true
    return last.anchor
  }

  /** The vault picture an embed shows, and which embed of which note it is. */
  pictureAt(span: HTMLElement): EmbeddedPicture | null {
    const src = span.getAttribute('src')
    if (!src || /^[a-z][a-z0-9+.-]*:/i.test(src)) return null
    const linkpath = src.split('#')[0]

    let note = ''
    let hint: EmbedHint = null
    let reading = false
    const block = this.blockOf(span)
    const cm = block ? null : EditorView.findFromDOM(span)
    if (block) {
      reading = true
      note = block.ctx.sourcePath
      const info = block.ctx.getSectionInfo(block.el)
      if (info) {
        const file = this.app.metadataCache.getFirstLinkpathDest(linkpath, note)
        const same = Array.from(
          block.el.querySelectorAll<HTMLElement>('.internal-embed.image-embed')
        ).filter((s) => this.resolve(s.getAttribute('src') ?? '', note) === file)
        hint = { lineStart: info.lineStart, lineEnd: info.lineEnd, index: same.indexOf(span) }
      }
    } else if (cm) {
      note = cm.state.field(editorInfoField, false)?.file?.path ?? ''
      try {
        hint = { at: cm.posAtDOM(span) }
      } catch {
        hint = null
      }
    }
    if (!note) return null
    const file = this.resolve(linkpath, note)
    if (!file || !isDrawable(file)) return null

    const noteFile = this.app.vault.getAbstractFileByPath(note)
    const embeds =
      noteFile instanceof TFile ? (this.app.metadataCache.getFileCache(noteFile)?.embeds ?? []) : []
    const picked = pickEmbed(embeds, (link) => this.resolve(link, note) === file, hint)
    const anchor = picked
      ? { note, start: picked.position.start.offset, original: picked.original }
      : null
    return { file, anchor, reading }
  }

  private resolve(link: string, note: string): TFile | null {
    return this.app.metadataCache.getFirstLinkpathDest(link.split('#')[0], note)
  }

  /** The rendered block of a note the element is in, the nearest one. */
  private blockOf(el: HTMLElement): { el: HTMLElement; ctx: MarkdownPostProcessorContext } | null {
    for (let at: HTMLElement | null = el; at; at = at.parentElement) {
      const ctx = this.blocks.get(at)
      if (ctx) return { el: at, ctx }
    }
    return null
  }
}

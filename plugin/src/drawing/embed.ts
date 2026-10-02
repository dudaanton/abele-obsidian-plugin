/**
 * A drawing in a note — its embed, `![[Sketch.svg]]`, the part of it to show named in the link
 * (`![[Sketch.svg#part=…]]`, `embedFormat.ts`) or, in notes written before, in a callout round it
 * — shown as what is drawn, following the file as the drawing changes, with buttons over it: one
 * opens the drawing, one opens it to draw on, one lets the part be changed — a drag moves it, the
 * wheel, a trackpad's pinch or two fingers zoom it — and kept, written back where it was named. A handle at its corner makes it bigger or
 * smaller, kept as the embed's size (`![[Sketch.svg|300]]`).
 *
 * Obsidian's own picture of the file stays where it is and is hidden: the box is put inside its
 * embed, so it goes when the embed goes, in reading view and in live preview alike. The picture in
 * the box is the drawing's own file, shown by the browser as any SVG is, placed and scaled so the
 * part fills the box.
 */
import { EditorView } from '@codemirror/view'
import {
  MarkdownRenderChild,
  Notice,
  TFile,
  setIcon,
  setTooltip,
  type App,
  type MarkdownPostProcessorContext,
} from 'obsidian'
import { guardSurface } from '@/reader/ink/inkGuard'
import { PAPER } from './drawingFile'
import {
  DRAWING_CALLOUT,
  embedBox,
  parseEmbedSize,
  paperOfSvg,
  parseView,
  partOfLink,
  withEmbedPart,
  withEmbedSize,
  withView,
  type EmbedSize,
} from './embedFormat'
import { vaultUrl } from '@/helpers/vaultUrl'
import { isDrawingFile, openDrawing } from './files'
import type { Rect } from './items'

const XHTML = 'http://www.w3.org/1999/xhtml'
const HOST = 'abele-drawing-embed__source'
const CALLOUT = `.callout[data-callout="${DRAWING_CALLOUT}"]`

/** The class that shows the buttons after a tap. */
const SHOWN = 'abele-drawing-embed_shown'
/** The class that shows the buttons while a mouse is over the drawing. */
const HOVER = 'abele-drawing-embed_hover'
/** How long the buttons stay after a tap, when nothing else hides them. */
const SHOWN_MS = 4000

/** The smallest a box is dragged to. */
const MIN_DRAG_W = 60

/** Embeds a drawing box already sits in; a second one is never put there. */
const claimed = new WeakSet<HTMLElement>()

/** The file an embed shows, when it is an SVG. */
export function embeddedSvg(app: App, embed: HTMLElement, sourcePath: string): TFile | null {
  const src = embed.getAttribute('src') ?? ''
  const linkpath = src.split('#')[0].split('|')[0]
  const file = app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath)
  return file && file.extension === 'svg' ? file : null
}

/** Where an embed's text is in its note, for writing its part or its size back. */
export interface EmbedPlace {
  /** The first line of the block it is in: its callout's header, or its paragraph's first line. */
  from: number
  /** The last line, when it is known; a callout is read to its end. */
  to?: number
}

/** Finds the drawings embedded in what was rendered — reading view, and callouts in live preview. */
export function drawingEmbedProcessor(app: App) {
  return (el: HTMLElement, ctx: MarkdownPostProcessorContext): void => {
    const embeds = el.matches('.internal-embed[src]')
      ? [el]
      : Array.from(el.querySelectorAll<HTMLElement>('.internal-embed[src]'))
    for (const embed of embeds) {
      if (claimed.has(embed) || !embed.instanceOf(HTMLElement)) continue
      // Inside a note embedded in this one: that note's own rendering shows it.
      if (embed.parentElement?.closest('.internal-embed') && !el.closest('.internal-embed'))
        continue
      const file = embeddedSvg(app, embed, ctx.sourcePath)
      if (!file) continue
      const callout = embed.closest<HTMLElement>(CALLOUT)
      ctx.addChild(
        new DrawingEmbed(app, embed, file, {
          sourcePath: ctx.sourcePath,
          callout,
          place: () => {
            const inEditor = editorPlace(callout ?? embed)
            if (inEditor) return inEditor
            const info = ctx.getSectionInfo(callout ?? el) ?? ctx.getSectionInfo(el)
            if (!info) return null
            return callout ? { from: info.lineStart } : { from: info.lineStart, to: info.lineEnd }
          },
        })
      )
    }
  }
}

/** Where an element in live preview sits in its note: the line of the editor it is drawn at. */
function editorPlace(el: HTMLElement): EmbedPlace | null {
  const dom = el.closest<HTMLElement>('.cm-editor')
  const view = dom ? EditorView.findFromDOM(dom) : null
  if (!view) return null
  try {
    const line = view.state.doc.lineAt(view.posAtDOM(el)).number - 1
    return el.matches(CALLOUT) ? { from: line } : { from: line, to: line }
  } catch {
    return null
  }
}

/**
 * Drawings embedded the plain way in live preview. Obsidian draws those itself, outside any
 * rendering a post-processor sees, so the editor is watched for them.
 */
export function drawingEmbedsInEditor(app: App, sourcePath: (view: EditorView) => string) {
  return (view: EditorView) => {
    const shown = new Map<HTMLElement, DrawingEmbed>()
    let frame = 0
    const scan = () => {
      frame = 0
      for (const [el, embed] of shown)
        if (!view.contentDOM.contains(el)) {
          embed.unload()
          shown.delete(el)
        }
      const path = sourcePath(view)
      for (const el of Array.from(
        view.contentDOM.querySelectorAll<HTMLElement>('.internal-embed[src]')
      )) {
        if (shown.has(el) || claimed.has(el)) continue
        // Callouts, tables and notes embedded here are rendered, and the post-processor has them.
        if (el.parentElement?.closest('.internal-embed, .cm-embed-block, .callout')) continue
        const file = embeddedSvg(app, el, path)
        if (!file) continue
        const embed = new DrawingEmbed(app, el, file, {
          sourcePath: path,
          callout: null,
          place: () => editorPlace(el),
        })
        shown.set(el, embed)
        embed.load()
      }
    }
    const schedule = () => {
      if (!frame) frame = view.dom.win.requestAnimationFrame(scan)
    }
    const observer = new MutationObserver(schedule)
    observer.observe(view.contentDOM, { childList: true, subtree: true })
    schedule()
    return {
      update: schedule,
      destroy: () => {
        observer.disconnect()
        if (frame) view.dom.win.cancelAnimationFrame(frame)
        for (const embed of shown.values()) embed.unload()
        shown.clear()
      },
    }
  }
}

interface EmbedOptions {
  sourcePath: string
  /** The drawing's callout it is in, whose header names the part; null for an embed alone. */
  callout: HTMLElement | null
  place: () => EmbedPlace | null
}

export class DrawingEmbed extends MarkdownRenderChild {
  private readonly box: HTMLElement
  private readonly img: HTMLImageElement
  private readonly actions: HTMLElement
  private readonly handle: HTMLElement
  private readonly saved: Rect | null
  private paper: Rect | null = null
  /** The part shown now; while it is being changed, the part it is becoming. */
  private view: Rect | null
  /** The size the embed names, or the one it is being dragged to. */
  private size: EmbedSize | null
  private adjusting = false
  private drawing = false
  private unguard: (() => void) | null = null
  private readonly pointers = new Map<number, { x: number; y: number }>()
  private resizing: { id: number; x: number; w: number; h: number } | null = null
  private observer: ResizeObserver | null = null
  private children: MutationObserver | null = null
  /** A touch that shows the buttons, and so is nobody else's, until its click. */
  private revealing = false
  private hideTimer = 0
  private unloaded = false
  private refreshToken = 0

  constructor(
    private readonly app: App,
    private readonly embed: HTMLElement,
    private readonly file: TFile,
    private readonly opts: EmbedOptions
  ) {
    super(embed)
    claimed.add(embed)
    this.saved = opts.callout
      ? parseView(opts.callout.getAttribute('data-callout-metadata'))
      : partOfLink(embed.getAttribute('src'))
    this.view = this.saved
    this.size = this.namedSize()
    const doc = embed.ownerDocument
    this.box = doc.createElementNS(XHTML, 'div')
    this.box.className = 'abele-drawing-embed'
    this.box.setCssStyles({ backgroundColor: PAPER })
    this.img = doc.createElementNS(XHTML, 'img') as HTMLImageElement
    this.img.className = 'abele-drawing-embed__picture'
    this.img.alt = file.basename
    this.img.draggable = false
    this.actions = doc.createElementNS(XHTML, 'div')
    this.actions.className = 'abele-drawing-embed__actions'
    this.handle = doc.createElementNS(XHTML, 'div')
    this.handle.className = 'abele-drawing-embed__resize'
    this.handle.setAttribute('aria-label', 'Drag to make the drawing bigger or smaller')
    this.box.append(this.img, this.actions, this.handle)
  }

  /** The size written in the embed, as Obsidian read it. */
  private namedSize(): EmbedSize | null {
    const w = this.embed.getAttribute('width')
    if (w)
      return parseEmbedSize(
        `${w}${this.embed.getAttribute('height') ? `x${this.embed.getAttribute('height')}` : ''}`
      )
    return parseEmbedSize(this.embed.getAttribute('alt'))
  }

  onload(): void {
    this.unloaded = false
    this.observer = new ResizeObserver(() => this.layout())
    this.observer.observe(this.embed)
    // Obsidian fills its embed when the picture loads: the box goes back in if it was taken out.
    this.children = new MutationObserver(() => {
      if (this.drawing && this.box.parentElement !== this.embed) this.embed.append(this.box)
    })
    this.children.observe(this.embed, { childList: true })
    this.buttons()
    void this.refresh()
    this.registerEvent(
      this.app.vault.on('modify', (f) => {
        if (f.path === this.file.path) void this.refresh()
      })
    )
    // Pointer events for changing the part; everything else the note's as usual.
    this.registerDomEvent(this.box, 'pointerdown', (e) => this.down(e))
    this.registerDomEvent(this.box, 'pointermove', (e) => this.move(e))
    this.registerDomEvent(this.box, 'pointerup', (e) => this.up(e))
    this.registerDomEvent(this.box, 'pointercancel', (e) => this.up(e))
    this.registerDomEvent(this.box, 'wheel', (e) => this.wheel(e), { passive: false })
    this.registerDomEvent(this.handle, 'pointerdown', (e) => this.resizeStart(e))
    this.registerDomEvent(this.handle, 'pointermove', (e) => this.resizeMove(e))
    this.registerDomEvent(this.handle, 'pointerup', (e) => this.resizeEnd(e, true))
    this.registerDomEvent(this.handle, 'pointercancel', (e) => this.resizeEnd(e, false))
    for (const type of ['mousedown', 'touchstart', 'click'] as const)
      this.registerDomEvent(this.handle, type, (e) => e.stopPropagation())
    this.revealOnTap()
  }

  /**
   * On a touch screen the buttons wait for a tap on the drawing, which shows them and reaches
   * nothing else: the cursor is not moved into the embed, the keyboard does not come up. They go
   * again after a while or at a tap anywhere else. A mouse sees them while it is over the drawing.
   */
  private revealOnTap(): void {
    const start = (touch: boolean, e: Event) => {
      // The corner that resizes is always there and always the finger's.
      if (e.target instanceof Node && this.handle.contains(e.target)) return
      if (touch && !this.revealing && !this.adjusting && !this.box.classList.contains(SHOWN))
        this.revealing = true
      if (this.revealing) e.stopPropagation()
    }
    this.registerDomEvent(this.box, 'pointerdown', (e) => start(e.pointerType !== 'mouse', e), {
      capture: true,
    })
    this.registerDomEvent(this.box, 'touchstart', (e) => start(true, e), { capture: true })
    for (const type of ['touchend', 'mousedown', 'mouseup', 'pointerup'] as const)
      this.registerDomEvent(this.box, type, (e) => {
        if (!this.revealing) return
        e.stopPropagation()
        // Nor is the embed focused, which in the editor is what brings a phone's keyboard up.
        if (type === 'mousedown') e.preventDefault()
      })
    this.registerDomEvent(this.box, 'pointercancel', () => (this.revealing = false))
    // A mouse over it shows them as long as it stays; a finger's `:hover` is not that.
    this.registerDomEvent(this.box, 'pointerenter', (e) => {
      if (e.pointerType === 'mouse') this.box.classList.add(HOVER)
    })
    this.registerDomEvent(this.box, 'pointerleave', () => this.box.classList.remove(HOVER))
    this.registerDomEvent(this.box, 'click', (e) => {
      if (!this.revealing) {
        if (this.box.classList.contains(SHOWN)) this.showButtons()
        return
      }
      this.revealing = false
      e.preventDefault()
      e.stopPropagation()
      this.showButtons()
    })
    this.registerDomEvent(
      this.box.ownerDocument,
      'pointerdown',
      (e) => {
        if (!(e.target instanceof Node) || !this.box.contains(e.target)) this.hideButtons()
      },
      { capture: true }
    )
  }

  private showButtons(): void {
    this.box.addClass(SHOWN)
    const win = this.box.ownerDocument.defaultView ?? window
    win.clearTimeout(this.hideTimer)
    this.hideTimer = win.setTimeout(() => {
      if (!this.adjusting) this.hideButtons()
    }, SHOWN_MS)
  }

  private hideButtons(): void {
    ;(this.box.ownerDocument.defaultView ?? window).clearTimeout(this.hideTimer)
    if (!this.adjusting) this.box.removeClass(SHOWN)
  }

  onunload(): void {
    this.unloaded = true
    this.refreshToken++
    ;(this.box.ownerDocument.defaultView ?? window).clearTimeout(this.hideTimer)
    this.observer?.disconnect()
    this.children?.disconnect()
    this.unguard?.()
    this.box.remove()
    this.embed.removeClass(HOST)
    claimed.delete(this.embed)
  }

  private async refresh(): Promise<void> {
    if (this.unloaded) return
    const token = ++this.refreshToken
    const drawing = await isDrawingFile(this.app, this.file)
    if (this.unloaded || token !== this.refreshToken) return
    this.drawing = drawing
    if (!this.drawing) {
      // Any other SVG: shown as Obsidian shows it.
      this.embed.removeClass(HOST)
      this.box.remove()
      return
    }
    const text = await this.app.vault.cachedRead(this.file)
    if (this.unloaded || token !== this.refreshToken) return
    this.paper = paperOfSvg(text)
    this.img.src = vaultUrl(this.app, this.file)
    this.embed.addClass(HOST)
    if (this.box.parentElement !== this.embed) this.embed.append(this.box)
    this.layout()
  }

  /** The part shown, the whole paper when the callout names none. */
  private shown(): Rect | null {
    return this.view ?? this.paper
  }

  private scale(): number {
    const r = this.shown()
    if (!r) return 1
    return Math.min(this.box.clientWidth / r.w, this.box.clientHeight / r.h)
  }

  private layout(): void {
    const r = this.shown()
    const paper = this.paper
    const room = this.embed.clientWidth
    if (!r || !paper || !room) return
    if (!this.adjusting) {
      const { w, h } = embedBox(room, r, this.size)
      this.box.setCssStyles({ width: `${w}px`, height: `${h}px` })
    }
    const width = this.box.clientWidth
    const s = this.scale()
    const left = (paper.x - r.x) * s + (width - r.w * s) / 2
    const top = (paper.y - r.y) * s + (this.box.clientHeight - r.h * s) / 2
    // Wider than its box whenever a part is shown. Obsidian's own rule for pictures in a note
    // holds one to the width of what it is in and wins over a class, so it is lifted here.
    this.img.setCssStyles({
      maxWidth: 'none',
      width: `${paper.w * s}px`,
      height: `${paper.h * s}px`,
      transform: `translate(${left}px, ${top}px)`,
    })
  }

  // ————— The buttons —————

  private button(icon: string, tooltip: string, cls: string, act: () => void): void {
    const b = this.actions.createDiv({ cls: `clickable-icon abele-drawing-embed__${cls}` })
    setIcon(b, icon)
    setTooltip(b, tooltip)
    b.setAttribute('role', 'button')
    b.setAttribute('aria-label', tooltip)
    // Not the note's: a click here neither moves the cursor into the embed nor opens it. Nor the
    // box's, which while the part is changed cancels every touch it hears — and Safari makes no
    // click out of a finger's lift that was cancelled, so the buttons would not answer a finger.
    for (const type of ['mousedown', 'mouseup', 'pointerdown', 'touchstart', 'touchend'] as const)
      this.registerDomEvent(b, type, (e) => e.stopPropagation())
    this.registerDomEvent(b, 'click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      act()
    })
  }

  private buttons(): void {
    this.actions.empty()
    if (this.adjusting) {
      this.button('maximize', 'Show the whole drawing', 'whole', () => {
        this.view = null
        this.layout()
      })
      this.button('x', 'Leave the part as it was', 'cancel', () => this.endAdjust(false))
      this.button('check', 'Keep this part', 'keep', () => this.endAdjust(true))
      return
    }
    this.button('scan', 'Change the part of the drawing shown here', 'adjust', () =>
      this.startAdjust()
    )
    this.button('pen-line', 'Open the drawing here to draw on', 'open', () => {
      const area = this.shown()
      void openDrawing(this.app, this.file, area ? { area, draw: true } : { draw: true })
    })
    this.button('arrow-up-right', 'Open the drawing', 'go', () => {
      const area = this.view
      void openDrawing(this.app, this.file, area ? { area } : {})
    })
  }

  private startAdjust(): void {
    this.adjusting = true
    this.box.addClass('abele-drawing-embed_adjusting')
    // While the part is being changed, touches are the part's alone: not the note's scroll, not
    // Obsidian's swipes.
    this.unguard = guardSurface(this.box)
    this.buttons()
  }

  private endAdjust(keep: boolean): void {
    this.adjusting = false
    this.box.removeClass('abele-drawing-embed_adjusting')
    this.unguard?.()
    this.unguard = null
    this.box.removeAttribute('data-ignore-swipe')
    this.pointers.clear()
    if (keep) void this.writePart(this.visible())
    else this.view = this.saved
    if (this.box.classList.contains(SHOWN)) this.showButtons()
    this.buttons()
    this.layout()
  }

  /** What the box shows: the part, and what the box's shape adds round it; null for the whole. */
  private visible(): Rect | null {
    const r = this.view
    if (!r) return null
    const s = this.scale()
    const w = this.box.clientWidth / s
    const h = this.box.clientHeight / s
    return { x: r.x + (r.w - w) / 2, y: r.y + (r.h - h) / 2, w, h }
  }

  /** The note this is in, and where in it, for a change to be written. */
  private async edit(change: (text: string, place: EmbedPlace | null) => string | null) {
    const note = this.app.vault.getAbstractFileByPath(this.opts.sourcePath)
    if (!(note instanceof TFile)) return false
    const place = this.opts.place()
    let done = false
    await this.app.vault.process(note, (text) => {
      const next = change(text, place)
      done = next !== null
      return next ?? text
    })
    return done
  }

  /** The part written where it is named: the embed's link, or the header of its callout. */
  private async writePart(view: Rect | null): Promise<void> {
    const nth = this.opts.callout ? 0 : this.nth()
    const done = await this.edit((text, place) =>
      this.opts.callout
        ? withView(text, view, { line: place?.from, file: this.file.path, was: this.saved })
        : place
          ? withEmbedPart(text, { ...place, file: this.file.path, nth }, view)
          : null
    )
    if (!done) new Notice('The drawing’s place in the note could not be found to keep the part')
  }

  /** Which of the embeds of this file in its block this one is. */
  private nth(): number {
    const block =
      this.opts.callout ??
      this.embed.closest<HTMLElement>('.cm-line') ??
      this.embed.closest<HTMLElement>('.markdown-preview-section > div, .markdown-rendered > *') ??
      this.embed.parentElement
    if (!block) return 0
    const same = Array.from(block.querySelectorAll<HTMLElement>('.internal-embed[src]')).filter(
      (el) => embeddedSvg(this.app, el, this.opts.sourcePath)?.path === this.file.path
    )
    return Math.max(0, same.indexOf(this.embed))
  }

  /** The size written into the embed's link in the note. */
  private async writeSize(size: EmbedSize | null): Promise<void> {
    const nth = this.nth()
    const done = await this.edit((text, place) =>
      place ? withEmbedSize(text, { ...place, file: this.file.path, nth }, size) : null
    )
    if (!done) new Notice('The drawing’s place in the note could not be found to keep its size')
  }

  // ————— Resizing —————

  private resizeStart(e: PointerEvent): void {
    if (this.adjusting) return
    e.stopPropagation()
    e.preventDefault()
    this.resizing = {
      id: e.pointerId,
      x: e.clientX,
      w: this.box.clientWidth,
      h: this.box.clientHeight,
    }
    try {
      this.handle.setPointerCapture(e.pointerId)
    } catch {
      // Followed while it lasts.
    }
  }

  private resizeMove(e: PointerEvent): void {
    const r = this.resizing
    if (!r || r.id !== e.pointerId) return
    e.stopPropagation()
    e.preventDefault()
    const w = Math.max(MIN_DRAG_W, Math.min(this.embed.clientWidth, r.w + e.clientX - r.x))
    // A box of its own shape keeps it; one that follows the drawing goes on following it.
    this.size = this.namedSize()?.h !== undefined ? { w, h: (r.h * w) / r.w } : { w }
    this.layout()
  }

  private resizeEnd(e: PointerEvent, keep: boolean): void {
    const r = this.resizing
    if (!r || r.id !== e.pointerId) return
    e.stopPropagation()
    this.resizing = null
    const size = this.size
    if (!keep || !size || Math.abs(size.w - r.w) < 2) {
      this.size = this.namedSize()
      this.layout()
      return
    }
    void this.writeSize({ w: Math.round(size.w), h: size.h && Math.round(size.h) })
  }

  // ————— Changing the part —————

  private down(e: PointerEvent): void {
    if (!this.adjusting) return
    e.stopPropagation()
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    try {
      this.box.setPointerCapture(e.pointerId)
    } catch {
      // Followed while it lasts.
    }
  }

  private move(e: PointerEvent): void {
    const was = this.pointers.get(e.pointerId)
    const r = this.shown()
    if (!this.adjusting || !was || !r) return
    e.stopPropagation()
    const s = this.scale()
    const other = [...this.pointers.entries()].find(([id]) => id !== e.pointerId)?.[1]
    let next = { ...r }
    if (other) {
      const before = Math.hypot(was.x - other.x, was.y - other.y)
      const after = Math.hypot(e.clientX - other.x, e.clientY - other.y)
      if (before > 4 && after > 4)
        next = this.zoomed(next, before / after, (was.x + other.x) / 2, (was.y + other.y) / 2)
    }
    next.x -= (e.clientX - was.x) / s / (other ? 2 : 1)
    next.y -= (e.clientY - was.y) / s / (other ? 2 : 1)
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    this.view = next
    this.layout()
  }

  private up(e: PointerEvent): void {
    this.pointers.delete(e.pointerId)
  }

  private wheel(e: WheelEvent): void {
    const r = this.shown()
    if (!this.adjusting || !r) return
    e.preventDefault()
    e.stopPropagation()
    if (e.ctrlKey || e.metaKey) {
      const step = Math.max(-50, Math.min(50, e.deltaY))
      this.view = this.zoomed(r, Math.exp(step * 0.01), e.clientX, e.clientY)
    } else {
      const s = this.scale()
      this.view = { ...r, x: r.x + e.deltaX / s, y: r.y + e.deltaY / s }
    }
    this.layout()
  }

  /** The part grown by a factor about a point of the screen, which stays where it is. */
  private zoomed(r: Rect, k: number, cx: number, cy: number): Rect {
    const rect = this.box.getBoundingClientRect()
    const s = this.scale()
    const ox = r.x + (cx - rect.left - (rect.width - r.w * s) / 2) / s
    const oy = r.y + (cy - rect.top - (rect.height - r.h * s) / 2) / s
    const w = Math.max(10, r.w * k)
    const h = Math.max(10, r.h * k)
    return { x: ox - (ox - r.x) * (w / r.w), y: oy - (oy - r.y) * (h / r.h), w, h }
  }
}

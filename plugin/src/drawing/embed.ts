/**
 * A drawing in a note, showing the part of it its callout names (`embedFormat.ts`), with two
 * buttons over it: one opens the drawing there to draw on, the other lets the part be changed —
 * a drag moves it, the wheel, a trackpad's pinch or two fingers zoom it — and kept, written back
 * into the callout's header.
 *
 * The picture is the drawing's own file, shown by the browser as any SVG is, placed and scaled so
 * the part fills the width of the note; the embed Obsidian drew is hidden under it. It follows the
 * file when the drawing changes.
 */
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
import { DRAWING_CALLOUT, paperOfSvg, parseView, withView } from './embedFormat'
import { isDrawingFile, openDrawing } from './files'
import type { Rect } from './items'

/** The height a part is shown at is its own shape at the note's width, held within these. */
const MIN_HEIGHT = 80
const MAX_HEIGHT = 900

const XHTML = 'http://www.w3.org/1999/xhtml'

/** Finds the drawings' callouts in what was rendered and shows each as its part. */
export function drawingEmbedProcessor(app: App) {
  return (el: HTMLElement, ctx: MarkdownPostProcessorContext): void => {
    const selector = `.callout[data-callout="${DRAWING_CALLOUT}"]`
    const found = el.matches(selector) ? [el] : Array.from(el.querySelectorAll(selector))
    for (const callout of found) {
      const embed = callout.querySelector('.internal-embed[src]')
      if (!callout.instanceOf(HTMLElement) || !embed?.instanceOf(HTMLElement)) continue
      const src = embed?.getAttribute('src') ?? ''
      const linkpath = src.split('#')[0].split('|')[0]
      const file = app.metadataCache.getFirstLinkpathDest(linkpath, ctx.sourcePath)
      if (!file || file.extension !== 'svg') continue
      const view = parseView(callout.getAttribute('data-callout-metadata'))
      ctx.addChild(new DrawingEmbed(app, callout, embed, file, view, ctx))
    }
  }
}

export class DrawingEmbed extends MarkdownRenderChild {
  private readonly box: HTMLElement
  private readonly img: HTMLImageElement
  private readonly actions: HTMLElement
  private paper: Rect | null = null
  /** The part shown now; while it is being changed, the part it is becoming. */
  private view: Rect | null
  private adjusting = false
  private unguard: (() => void) | null = null
  private readonly pointers = new Map<number, { x: number; y: number }>()
  private observer: ResizeObserver | null = null

  constructor(
    private readonly app: App,
    callout: HTMLElement,
    private readonly source: HTMLElement,
    private readonly file: TFile,
    private readonly saved: Rect | null,
    private readonly ctx: MarkdownPostProcessorContext
  ) {
    super(callout)
    this.view = saved
    const doc = callout.ownerDocument
    this.box = doc.createElementNS(XHTML, 'div')
    this.box.className = 'abele-drawing-embed'
    this.box.setCssStyles({ backgroundColor: PAPER })
    this.img = doc.createElementNS(XHTML, 'img') as HTMLImageElement
    this.img.className = 'abele-drawing-embed__picture'
    this.img.alt = file.basename
    this.img.draggable = false
    this.actions = doc.createElementNS(XHTML, 'div')
    this.actions.className = 'abele-drawing-embed__actions'
    this.box.append(this.img, this.actions)
  }

  onload(): void {
    this.source.addClass('abele-drawing-embed__source')
    this.source.after(this.box)
    this.observer = new ResizeObserver(() => this.layout())
    this.observer.observe(this.box)
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
  }

  onunload(): void {
    this.observer?.disconnect()
    this.unguard?.()
    this.box.remove()
    this.source.removeClass('abele-drawing-embed__source')
  }

  private async refresh(): Promise<void> {
    if (!(await isDrawingFile(this.app, this.file))) {
      // Any other SVG in a drawing's callout: shown as Obsidian shows it.
      this.source.removeClass('abele-drawing-embed__source')
      this.box.hide()
      return
    }
    this.paper = paperOfSvg(await this.app.vault.cachedRead(this.file))
    this.img.src = this.app.vault.getResourcePath(this.file)
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
    const width = this.box.clientWidth
    if (!r || !paper || !width) return
    if (!this.adjusting) {
      const height = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, (width * r.h) / r.w))
      this.box.setCssStyles({ height: `${Math.round(height)}px` })
    }
    const s = this.scale()
    const left = (paper.x - r.x) * s + (width - r.w * s) / 2
    const top = (paper.y - r.y) * s + (this.box.clientHeight - r.h * s) / 2
    this.img.setCssStyles({
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
    // Not the note's: a click here neither moves the cursor into the callout nor opens it.
    for (const type of ['mousedown', 'pointerdown', 'touchstart'] as const)
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
    if (keep) void this.write(this.view)
    else this.view = this.saved
    this.buttons()
    this.layout()
  }

  /** The part written into the callout's header in the note. */
  private async write(view: Rect | null): Promise<void> {
    const note = this.app.vault.getAbstractFileByPath(this.ctx.sourcePath)
    if (!(note instanceof TFile)) return
    const line = this.ctx.getSectionInfo(this.containerEl)?.lineStart
    let done = false
    await this.app.vault.process(note, (text) => {
      const next = withView(text, view, { line, file: this.file.path, was: this.saved })
      done = next !== null
      return next ?? text
    })
    if (!done) new Notice('The drawing’s place in the note could not be found to keep the part')
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

import { type EditorView } from '@codemirror/view'
import { MarkdownRenderChild, TFile, type App, type MarkdownPostProcessorContext } from 'obsidian'
import { canvasEmbedOptions } from './embedFormat'
import { canvasPicture } from './pictureAdapter'
import { parseCanvas } from './core/model'
import { stepsOf } from './core/steps'
import { openCanvas } from './opening'
import { bindCanvasTap } from './tap'

const claimed = new WeakSet<HTMLElement>()
export function embeddedCanvas(app: App, embed: HTMLElement, sourcePath: string): TFile | null {
  const link = (embed.getAttribute('src') ?? '').split('#')[0].split('|')[0]
  const file = app.metadataCache.getFirstLinkpathDest(link, sourcePath)
  return file instanceof TFile && file.extension === 'canvas' ? file : null
}
/** Static snapshots never capture scroll/pan gestures from the surrounding note. */
export class CanvasEmbed extends MarkdownRenderChild {
  private box: HTMLElement
  private image: HTMLImageElement
  private narration: HTMLElement
  private status: HTMLElement
  private play: HTMLButtonElement
  private observer: MutationObserver | null = null
  private token = 0
  private stopped = true
  private abort: AbortController | null = null
  private timer = 0
  private source = ''
  constructor(
    private readonly app: App,
    private readonly embed: HTMLElement,
    private readonly sourcePath: () => string
  ) {
    super(embed)
    claimed.add(embed)
    const doc = embed.ownerDocument
    this.box = doc.win.createDiv()
    this.box.className = 'abele-canvas-embed'
    this.image = doc.win.createEl('img')
    this.image.className = 'abele-canvas-embed-picture'
    this.image.draggable = false
    const actions = doc.win.createDiv()
    actions.className = 'abele-canvas-embed-actions'
    const button = (label: string, action: () => void) => {
      const b = doc.win.createEl('button')
      b.type = 'button'
      b.textContent = label
      b.setAttribute('aria-label', `${label} diagram`)
      this.register(bindCanvasTap(b, action))
      actions.append(b)
      return b
    }
    button('Open', () => this.open(false))
    this.play = button('Play', () => this.open(true))
    this.narration = doc.win.createDiv()
    this.narration.className = 'abele-canvas-embed-narration'
    this.status = doc.win.createDiv()
    this.status.className = 'abele-canvas-embed-status'
    this.status.setAttribute('role', 'status')
    this.box.append(this.image, actions, this.narration, this.status)
  }
  onload(): void {
    this.stopped = false
    this.embed.addClass('abele-canvas-embed-source')
    this.embed.append(this.box)
    this.source = this.embed.getAttribute('src') ?? ''
    this.observer = new MutationObserver(() => {
      if (this.stopped) return
      // Native Canvas can fill its minimap late or replace children after a note rerender.
      if (this.box.parentElement !== this.embed) this.embed.append(this.box)
      const source = this.embed.getAttribute('src') ?? ''
      if (source !== this.source) {
        this.source = source
        void this.refresh()
      }
    })
    this.observer.observe(this.embed, {
      childList: true,
      attributes: true,
      attributeFilter: ['src'],
    })
    this.registerEvent(this.app.vault.on('modify', () => this.schedule()))
    this.registerEvent(this.app.vault.on('rename', () => this.schedule()))
    this.registerEvent(this.app.workspace.on('css-change', () => this.schedule()))
    void this.refresh()
  }
  private schedule(): void {
    window.clearTimeout(this.timer)
    this.timer = window.setTimeout((): void => void this.refresh(), 120)
  }
  onunload(): void {
    this.stopped = true
    this.token++
    this.abort?.abort()
    window.clearTimeout(this.timer)
    this.observer?.disconnect()
    this.box.remove()
    this.embed.removeClass('abele-canvas-embed-source')
    claimed.delete(this.embed)
  }
  private open(play: boolean): void {
    const file = embeddedCanvas(this.app, this.embed, this.sourcePath())
    if (!file) return
    try {
      void openCanvas(this.app, file, {
        ...canvasEmbedOptions(this.embed.getAttribute('src') ?? ''),
        play,
      })
    } catch (error) {
      this.status.setText(String(error))
    }
  }
  private async refresh(): Promise<void> {
    if (this.stopped) return
    const token = ++this.token
    this.abort?.abort()
    this.abort = new AbortController()
    const signal = this.abort.signal
    try {
      const file = embeddedCanvas(this.app, this.embed, this.sourcePath())
      if (!file) throw new Error('Embedded diagram is missing')
      const options = canvasEmbedOptions(this.embed.getAttribute('src') ?? '')
      const graph = parseCanvas(await this.app.vault.read(file))
      const picture = await canvasPicture(
        this.app,
        graph,
        file.path,
        { ...options, maxSide: 1600 },
        () => true,
        signal
      )
      if (this.stopped || token !== this.token) return
      this.image.src = picture.canvas.toDataURL('image/png')
      this.image.alt = `${file.basename}${options.step ? `, step ${options.step}` : ''}`
      const width = Number(this.embed.getAttribute('width'))
      this.box.setCssStyles({ width: Number.isFinite(width) && width > 0 ? `${width}px` : '100%' })
      this.narration.setText(picture.say ?? '')
      this.status.setText('')
      this.play.disabled = stepsOf(graph).length === 0
    } catch (error) {
      if (!this.stopped && token === this.token && !signal.aborted) {
        this.status.setText(`Diagram could not be shown: ${String(error)}`)
        this.image.removeAttribute('src')
        this.play.disabled = true
      }
    }
  }
}
export function canvasEmbedProcessor(app: App) {
  return (el: HTMLElement, ctx: MarkdownPostProcessorContext): void => {
    const embeds = el.matches('.internal-embed[src]')
      ? [el]
      : Array.from(el.querySelectorAll<HTMLElement>('.internal-embed[src]'))
    for (const embed of embeds) {
      if (claimed.has(embed) || !embeddedCanvas(app, embed, ctx.sourcePath)) continue
      if (embed.parentElement?.closest('.internal-embed') && !el.closest('.internal-embed'))
        continue
      ctx.addChild(new CanvasEmbed(app, embed, () => ctx.sourcePath))
    }
  }
}
/** Editor-side ownership is essential: native plain Canvas embeds bypass post-processors. */
export function canvasEmbedsInEditor(app: App, sourcePath: (view: EditorView) => string) {
  return (view: EditorView) => {
    const shown = new Map<HTMLElement, CanvasEmbed>()
    let frame = 0
    const scan = () => {
      frame = 0
      for (const [el, widget] of shown)
        if (!view.contentDOM.contains(el) || !embeddedCanvas(app, el, sourcePath(view))) {
          widget.unload()
          shown.delete(el)
        }
      for (const el of Array.from(
        view.contentDOM.querySelectorAll<HTMLElement>('.internal-embed[src]')
      )) {
        if (
          shown.has(el) ||
          claimed.has(el) ||
          el.parentElement?.closest('.internal-embed, .cm-embed-block, .callout') ||
          !embeddedCanvas(app, el, sourcePath(view))
        )
          continue
        const widget = new CanvasEmbed(app, el, () => sourcePath(view))
        shown.set(el, widget)
        widget.load()
      }
    }
    const schedule = () => {
      if (!frame) frame = view.dom.win.requestAnimationFrame(scan)
    }
    const observer = new MutationObserver(schedule)
    observer.observe(view.contentDOM, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src'],
    })
    schedule()
    return {
      update: schedule,
      destroy: () => {
        observer.disconnect()
        if (frame) view.dom.win.cancelAnimationFrame(frame)
        for (const widget of shown.values()) widget.unload()
        shown.clear()
      },
    }
  }
}

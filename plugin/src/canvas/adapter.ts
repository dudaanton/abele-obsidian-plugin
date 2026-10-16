/** Obsidian is one client of the portable graph/presentation model and DOM viewer. */
import {
  Component,
  Keymap,
  MarkdownRenderer,
  Notice,
  TFile,
  type App,
  type HoverParent,
} from 'obsidian'
import { prepareExternalFile } from '@/sync/external/fileAccess'
import { CanvasViewer, type ViewerCards } from './Viewer'
import { canvasRegionAssets, canvasTheme, notePart } from './pictureAdapter'
import { centredLabel, contentBox } from './core/scene'
import { bounds, type CanvasGraph } from './core/model'
import {
  paintCanvas,
  withoutLiveCardAssets,
  type CanvasAssets,
  type CanvasTheme,
} from './core/painter'
import { visibleRect, type Camera } from '../drawing/camera'
import { openCanvas } from './opening'
import { openExternal } from '../helpers/openExternal'
import { canvasVisibility } from './core/visibility'
import { WebCard, obsidianWebCardPorts, type WebCardPorts } from './webCard'
import { bindCanvasLinks } from './links'

interface CardLayer {
  el: HTMLElement
  canvas: HTMLCanvasElement
  body: HTMLElement | null
  signature: string
  component: Component | null
  web: WebCard | null
  paintKey: string
  assets: CanvasAssets | null
}
/** One compositing layer per card: its opaque shape and live contents share the same stacking. */
class LiveCards implements ViewerCards {
  private cards = new Map<string, CardLayer>()
  private layer: HTMLElement | null = null
  stage: HTMLElement | null = null
  private web: WebCardPorts | null = null
  constructor(
    private readonly app: App,
    private readonly source: () => string
  ) {}
  sync(
    graph: CanvasGraph,
    camera: Camera,
    width: number,
    height: number,
    highlight: ReadonlySet<string>,
    assets: CanvasAssets,
    theme: CanvasTheme,
    focused: string | null = null
  ): ReadonlySet<string> {
    if (!this.stage) return new Set()
    if (!this.layer) this.layer = this.stage.createDiv({ cls: 'abele-canvas-cards' })
    const r = visibleRect(camera, width, height),
      region = { x: r.x, y: r.y, width: r.w, height: r.h }
    const shown = new Set<string>(),
      live = new Set<string>()
    const ratio = this.stage.ownerDocument.defaultView.devicePixelRatio || 1
    let previous: HTMLElement | null = null
    for (const node of canvasVisibility(graph, region).visible) {
      if (node.type === 'group') continue
      shown.add(node.id)
      const file =
        node.type === 'file' && node.file ? this.app.vault.getAbstractFileByPath(node.file) : null
      const markdown = node.type === 'text' || (file instanceof TFile && file.extension === 'md')
      const page = node.type === 'link' && !!node.url
      const signature = JSON.stringify([
        this.source(),
        markdown,
        node.text,
        node.file,
        node.subpath,
        page ? node.url : null,
        file instanceof TFile ? file.stat.mtime : null,
      ])
      let card = this.cards.get(node.id)
      if (!card || card.signature !== signature) {
        card?.component?.unload()
        card?.web?.destroy()
        card?.el.remove()
        const el = this.layer.createDiv({ cls: 'abele-canvas-card-frame' })
        el.dataset.cardId = node.id
        const canvas = el.createEl('canvas', { cls: 'abele-canvas-card-background' })
        const body = markdown
          ? el.createDiv({ cls: 'abele-canvas-card markdown-rendered' })
          : page
            ? el.createDiv({ cls: 'abele-canvas-card abele-canvas-card_web' })
            : null
        const component = markdown ? new Component() : null
        component?.load()
        const web =
          page && body
            ? new WebCard(body, node.url, (this.web ??= obsidianWebCardPorts(this.app)))
            : null
        card = { el, canvas, body, signature, component, web, paintKey: '', assets: null }
        this.cards.set(node.id, card)
        if (body && component) {
          body.dataset.nodeId = node.id
          const hoverParent: HoverParent = { hoverPopover: null }
          const href = (link: HTMLAnchorElement) =>
            link.getAttribute('data-href') ?? link.getAttribute('href') ?? ''
          component.register(
            bindCanvasLinks(body, {
              open: (link, event) => {
                if (link.classList.contains('external-link')) openExternal(href(link))
                else
                  void this.app.workspace.openLinkText(
                    href(link),
                    this.source(),
                    event.button === 1 || Keymap.isModEvent(event)
                  )
              },
              hover: (link, event) => {
                if (!link.classList.contains('internal-link')) return
                this.app.workspace.trigger('hover-link', {
                  event,
                  source: 'preview',
                  hoverParent,
                  targetEl: link,
                  linktext: href(link),
                  sourcePath: this.source(),
                })
              },
            })
          )
          const current = card
          const render = async () => {
            const text =
              file instanceof TFile
                ? notePart(await this.app.vault.cachedRead(file), node.subpath)
                : (node.text ?? '')
            if (this.cards.get(node.id) !== current) return
            await MarkdownRenderer.render(
              this.app,
              text,
              body,
              file instanceof TFile ? file.path : this.source(),
              component
            )
          }
          void render().catch((error) => {
            if (this.cards.get(node.id) === current) body.setText(String(error))
          })
        }
      }
      if (markdown || page) live.add(node.id)
      card.web?.setLive(focused === node.id)
      // A small transparent margin preserves the complete shape border without covering lower cards.
      const frame = bounds([node], 2),
        box = contentBox(node)
      card.el.setCssStyles({
        width: `${frame.width}px`,
        height: `${frame.height}px`,
        transform: `translate(${(frame.x - camera.x) * camera.zoom}px, ${(frame.y - camera.y) * camera.zoom}px) scale(${camera.zoom})`,
      })
      card.body?.toggleClass('abele-canvas-card_centred', centredLabel(node))
      card.body?.setCssStyles({
        width: `${box.width}px`,
        height: `${box.height}px`,
        left: `${box.x - frame.x}px`,
        top: `${box.y - frame.y}px`,
      })
      const key = JSON.stringify([node, camera.zoom, ratio, theme, highlight.has(node.id)])
      if (key !== card.paintKey || card.assets !== assets) {
        card.paintKey = key
        card.assets = assets
        const scale = Math.min(camera.zoom * ratio, 4096 / frame.width, 4096 / frame.height)
        card.canvas.width = Math.max(1, Math.ceil(frame.width * scale))
        card.canvas.height = Math.max(1, Math.ceil(frame.height * scale))
        const ctx = card.canvas.getContext('2d')
        if (ctx) {
          ctx.setTransform(scale, 0, 0, scale, -frame.x * scale, -frame.y * scale)
          paintCanvas(ctx, { nodes: [node], edges: [] }, frame, theme, {
            ...withoutLiveCardAssets(assets, markdown || page ? new Set([node.id]) : new Set()),
            highlight,
            lint: false,
            transparent: true,
            skipInk: true,
          })
        }
      }
      // Only a card out of its place in the stack is moved: moving an element drops how far its
      // words were scrolled, so a note being read would jump back to its top at every repaint.
      const want: ChildNode | null = previous ? previous.nextSibling : this.layer.firstChild
      if (want !== card.el) {
        const top = card.body?.scrollTop ?? 0
        this.layer.insertBefore(card.el, want)
        if (card.body && top) card.body.scrollTop = top
      }
      previous = card.el
    }
    for (const [id, card] of this.cards)
      if (!shown.has(id)) {
        card.component?.unload()
        card.web?.destroy()
        card.el.remove()
        this.cards.delete(id)
      }
    return live
  }
  scroll(id: string, dx: number, dy: number): boolean {
    const body = this.cards.get(id)?.body
    if (!body) return false
    // The card is drawn scaled with the canvas; the wheel's pixels are the screen's.
    const scale = body.getBoundingClientRect().height / (body.offsetHeight || 1) || 1,
      top = body.scrollTop,
      left = body.scrollLeft
    body.scrollTop = top + dy / scale
    body.scrollLeft = left + dx / scale
    return body.scrollTop !== top || body.scrollLeft !== left
  }
  scroller(id: string): HTMLElement | null {
    return this.cards.get(id)?.body ?? null
  }
  destroy(): void {
    for (const card of this.cards.values()) {
      card.component?.unload()
      card.web?.destroy()
      card.el.remove()
    }
    this.cards.clear()
    this.layer?.remove()
    this.layer = null
  }
}
export function hostCanvasViewer(app: App, el: HTMLElement, source: () => string): CanvasViewer {
  const cards = new LiveCards(app, source)
  const viewer = new CanvasViewer(el, {
    theme: () => canvasTheme(el.ownerDocument),
    cards,
    assets: (graph, region, signal) =>
      canvasRegionAssets(app, graph, source(), () => true, el.ownerDocument, region, signal),
    openNode: (node) => {
      if (node.type === 'file' && node.file) {
        const path = node.file
        void prepareExternalFile(app, path)
          .then(async () => {
            const file = app.vault.getAbstractFileByPath(path)
            if (file instanceof TFile && file.extension === 'canvas') await openCanvas(app, file)
            else await app.workspace.openLinkText(path + (node.subpath ?? ''), source(), 'tab')
          })
          .catch((error) => {
            console.debug('[abele-sync] canvas file could not be opened', error)
            new Notice('Unavailable offline or through current connections: ' + path)
          })
      } else if (node.type === 'link' && node.url && /^https?:\/\//i.test(node.url))
        openExternal(node.url, '_blank')
    },
  })
  cards.stage = viewer.stage
  return viewer
}

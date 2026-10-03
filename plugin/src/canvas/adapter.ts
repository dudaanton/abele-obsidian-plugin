/** Obsidian is one client of the portable graph/presentation model and DOM viewer. */
import { Component, MarkdownRenderer, TFile, type App } from 'obsidian'
import { CanvasViewer, type ViewerCards } from './Viewer'
import { canvasRegionAssets, canvasTheme, notePart } from './pictureAdapter'
import { contentBox } from './core/scene'
import {
  bounds,
  canvasPaintOrder,
  descendants,
  overlaps,
  parentsOf,
  type CanvasGraph,
} from './core/model'
import {
  paintCanvas,
  withoutLiveCardAssets,
  type CanvasAssets,
  type CanvasTheme,
} from './core/painter'
import { visibleRect, type Camera } from '../drawing/camera'
import { openCanvas } from './opening'
import { openExternal } from '../helpers/openExternal'

interface CardLayer {
  el: HTMLElement
  canvas: HTMLCanvasElement
  body: HTMLElement | null
  signature: string
  component: Component | null
  paintKey: string
  assets: CanvasAssets | null
}
/** One compositing layer per card: its opaque shape and live contents share the same stacking. */
class LiveCards implements ViewerCards {
  private cards = new Map<string, CardLayer>()
  private layer: HTMLElement | null = null
  stage: HTMLElement | null = null
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
    theme: CanvasTheme
  ): ReadonlySet<string> {
    if (!this.stage) return new Set()
    if (!this.layer) this.layer = this.stage.createDiv({ cls: 'abele-canvas-cards' })
    const r = visibleRect(camera, width, height),
      region = { x: r.x, y: r.y, width: r.w, height: r.h }
    const parents = parentsOf(graph),
      hidden = new Set(
        graph.nodes.filter((n) => n.collapsed).flatMap((n) => descendants(n.id, parents))
      )
    const shown = new Set<string>(),
      live = new Set<string>()
    const ratio = this.stage.ownerDocument.defaultView.devicePixelRatio || 1
    for (const node of canvasPaintOrder(graph)) {
      if (node.type === 'group' || hidden.has(node.id) || !overlaps(node, region)) continue
      shown.add(node.id)
      const file =
        node.type === 'file' && node.file ? this.app.vault.getAbstractFileByPath(node.file) : null
      const markdown = node.type === 'text' || (file instanceof TFile && file.extension === 'md')
      const signature = JSON.stringify([
        markdown,
        node.text,
        node.file,
        node.subpath,
        file instanceof TFile ? file.stat.mtime : null,
      ])
      let card = this.cards.get(node.id)
      if (!card || card.signature !== signature) {
        card?.component?.unload()
        card?.el.remove()
        const el = this.layer.createDiv({ cls: 'abele-canvas-card-frame' })
        el.dataset.cardId = node.id
        const canvas = el.createEl('canvas', { cls: 'abele-canvas-card-background' })
        const body = markdown ? el.createDiv({ cls: 'abele-canvas-card markdown-rendered' }) : null
        const component = markdown ? new Component() : null
        component?.load()
        card = { el, canvas, body, signature, component, paintKey: '', assets: null }
        this.cards.set(node.id, card)
        if (body && component) {
          body.dataset.nodeId = node.id
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
      if (markdown) live.add(node.id)
      // A small transparent margin preserves the complete shape border without covering lower cards.
      const frame = bounds([node], 2),
        box = contentBox(node)
      card.el.setCssStyles({
        width: `${frame.width}px`,
        height: `${frame.height}px`,
        transform: `translate(${(frame.x - camera.x) * camera.zoom}px, ${(frame.y - camera.y) * camera.zoom}px) scale(${camera.zoom})`,
      })
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
            ...withoutLiveCardAssets(assets, markdown ? new Set([node.id]) : new Set()),
            highlight,
            lint: false,
            transparent: true,
          })
        }
      }
      this.layer.append(card.el)
    }
    for (const [id, card] of this.cards)
      if (!shown.has(id)) {
        card.component?.unload()
        card.el.remove()
        this.cards.delete(id)
      }
    return live
  }
  destroy(): void {
    for (const card of this.cards.values()) {
      card.component?.unload()
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
        const file = app.vault.getAbstractFileByPath(node.file)
        if (file instanceof TFile && file.extension === 'canvas') void openCanvas(app, file)
        else void app.workspace.openLinkText(`${node.file}${node.subpath ?? ''}`, source(), 'tab')
      } else if (node.type === 'link' && node.url && /^https?:\/\//i.test(node.url))
        openExternal(node.url, '_blank')
    },
  })
  cards.stage = viewer.stage
  return viewer
}

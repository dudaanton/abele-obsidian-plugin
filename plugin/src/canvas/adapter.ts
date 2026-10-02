/** Obsidian is one client of the portable graph/presentation model and DOM viewer. */
import { Component, MarkdownRenderer, TFile, type App } from 'obsidian'
import { CanvasViewer, type ViewerCards } from './Viewer'
import { canvasRegionAssets, canvasTheme, notePart } from './pictureAdapter'
import { contentBox } from './core/scene'
import { canvasPaintOrder, descendants, overlaps, parentsOf, type CanvasGraph } from './core/model'
import { visibleRect, type Camera } from '../drawing/camera'
import { openCanvas } from './opening'

class LiveCards implements ViewerCards {
  private cards = new Map<string, { el: HTMLElement; signature: string; component: Component }>()
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
    _highlight: ReadonlySet<string>
  ): ReadonlySet<string> {
    if (!this.stage) return new Set()
    if (!this.layer) {
      this.layer = this.stage.createDiv({ cls: 'abele-canvas-cards' })
    }
    const r = visibleRect(camera, width, height),
      region = { x: r.x, y: r.y, width: r.w, height: r.h }
    const parents = parentsOf(graph),
      hidden = new Set(
        graph.nodes.filter((n) => n.collapsed).flatMap((n) => descendants(n.id, parents))
      )
    const shown = new Set<string>()
    for (const node of canvasPaintOrder(graph)) {
      if (hidden.has(node.id) || !overlaps(node, region)) continue
      const file =
        node.type === 'file' && node.file ? this.app.vault.getAbstractFileByPath(node.file) : null
      if (node.type !== 'text' && (!(file instanceof TFile) || file.extension !== 'md')) continue
      shown.add(node.id)
      const signature = JSON.stringify([
        node.text,
        node.file,
        node.subpath,
        file instanceof TFile ? file.stat.mtime : null,
      ])
      let card = this.cards.get(node.id)
      if (!card || card.signature !== signature) {
        card?.component.unload()
        card?.el.remove()
        const el = this.layer.createDiv({ cls: 'abele-canvas-card markdown-rendered' })
        el.dataset.nodeId = node.id
        const component = new Component()
        component.load()
        card = { el, signature, component }
        this.cards.set(node.id, card)
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
            el,
            file instanceof TFile ? file.path : this.source(),
            component
          )
        }
        void render().catch((error) => {
          if (this.cards.get(node.id) === current) el.setText(String(error))
        })
      }
      const box = contentBox(node)
      card.el.setCssStyles({
        width: `${box.width}px`,
        height: `${box.height}px`,
        transform: `translate(${(box.x - camera.x) * camera.zoom}px, ${(box.y - camera.y) * camera.zoom}px) scale(${camera.zoom})`,
      })
      // Maintain the same stacking as the file/painter even after a native raise/lower.
      this.layer.append(card.el)
    }
    for (const [id, card] of this.cards)
      if (!shown.has(id)) {
        card.component.unload()
        card.el.remove()
        this.cards.delete(id)
      }
    return shown
  }
  destroy(): void {
    for (const card of this.cards.values()) {
      card.component.unload()
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
        window.open(node.url, '_blank', 'noopener,noreferrer')
    },
  })
  cards.stage = viewer.stage
  return viewer
}

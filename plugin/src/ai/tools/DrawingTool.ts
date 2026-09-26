/**
 * `look_at_drawing`: the agent sees a drawing — all of it, a part of it named in its own units,
 * or what the person picked with the lasso in the open drawing — as a picture, with a line saying
 * where on the drawing that part is and the text typed on it. Reading handwriting is the model's:
 * the picture is painted large enough for it.
 */
import { TFile } from 'obsidian'
import type { AgentTool, UserContentPart } from '../client'
import { GlobalStore } from '@/stores/GlobalStore'
import { paperOf, parseDrawingSvg } from '@/drawing/drawingFile'
import { parseView, formatView } from '@/drawing/embedFormat'
import { drawingCanvas, withMargin } from '@/drawing/rasterize'
import { DRAWING_VIEW_TYPE } from '@/drawing/viewType'
import type { DrawingView } from '@/drawing/DrawingView'
import { intersects, boundsOf, type Rect } from '@/drawing/items'

export const LOOK_AT_DRAWING = 'look_at_drawing'

/** What the person picked in the open tab of a drawing, with room round it; null for nothing. */
function pickedIn(path: string): Rect | null {
  const { app } = GlobalStore.getInstance()
  for (const leaf of app.workspace.getLeavesOfType(DRAWING_VIEW_TYPE)) {
    const view = leaf.view as DrawingView
    if (view.file?.path !== path) continue
    const box = view.session?.pick.box()
    if (box) return withMargin(box)
  }
  return null
}

export function createLookAtDrawingTool(): AgentTool {
  return {
    name: LOOK_AT_DRAWING,
    label: 'Look at drawing',
    description:
      "See a drawing made in the plugin (an .svg whose file says it is one) as a picture — the whole of it, a part, or what the person picked with the lasso in its open tab. Use it to read handwriting, describe or answer about a sketch. `area` is \"x y width height\" in the drawing's own units, as a note's `[!drawing|…]` callout names a part; the reply says the whole drawing's bounds so you can ask for a closer part.",
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The drawing, relative to the vault root' },
        area: {
          type: 'string',
          description: 'Optional: "x y width height" of the part to see, in the drawing’s units',
        },
        picked: {
          type: 'boolean',
          description: 'Optional: see what the person picked with the lasso in the open drawing',
        },
      },
      required: ['path'],
    },
    execute: async (_id, params) => {
      const path = typeof params.path === 'string' ? params.path : ''
      const { app } = GlobalStore.getInstance()
      const file = app.vault.getAbstractFileByPath(path)
      if (!(file instanceof TFile)) throw new Error(`File not found: ${path}`)
      const data = parseDrawingSvg(await app.vault.read(file))
      if (!data) throw new Error(`Not a drawing: ${path}. For another picture use read_image.`)
      const whole = paperOf(data.items)
      let area: Rect | null = null
      if (params.picked === true) {
        area = pickedIn(path)
        if (!area) throw new Error('Nothing is picked in an open tab of that drawing.')
      } else if (typeof params.area === 'string' && params.area.trim()) {
        area = parseView(params.area)
        if (!area) throw new Error('`area` must be four numbers: x y width height.')
      }
      const shown = area ?? whole
      const canvas = drawingCanvas(activeDocument, data.items, shown)
      const texts = data.items
        .filter((i) => i.type === 'text' && intersects(boundsOf(i), shown))
        .map((i) => (i.type === 'text' ? i.text.replace(/\n/g, ' / ') : ''))
      const notes = data.items
        .filter((i) => i.type === 'note' && intersects(boundsOf(i), shown))
        .map((i) => (i.type === 'note' ? i.path : ''))
      const count = data.items.filter((i) => intersects(boundsOf(i), shown)).length
      const about =
        `Drawing ${path}: the whole of it is ${formatView(whole)}; ` +
        `shown: ${area ? formatView(area) : 'all of it'}, ${count} item(s), ${canvas.width}×${canvas.height} px.` +
        (texts.length ? ` Typed text in it: ${texts.map((t) => `“${t}”`).join('; ')}.` : '') +
        (notes.length
          ? ` Notes shown on it (read them with \`read\`): ${notes.map((p) => `[[${p}]]`).join(', ')}.`
          : '')
      const image: UserContentPart[] = [
        { type: 'text', text: `[Drawing: ${path}]` },
        { type: 'image_url', image_url: { url: canvas.toDataURL('image/png') } },
      ]
      return {
        content: [{ type: 'text', text: about }],
        injectMessages: [{ role: 'user', content: image, timestamp: Date.now() }],
      }
    },
  }
}

/**
 * The canvas's controls over its tab: the kit's tool bar across the top, zoom and history in
 * Obsidian Canvas's column, the bar over what is picked, and the frames' names on the canvas.
 */
import { createApp } from 'vue'
import CanvasChrome from '@/components/canvas/CanvasChrome.vue'
import type { CanvasEditor } from './Editor'
import type { CanvasViewer } from './Viewer'
import type { CanvasHostActions } from './pickedActions'

/** Mounts the controls; the returned function takes them away again. */
export function mountCanvasChrome(
  viewer: CanvasViewer,
  editor: CanvasEditor,
  host: CanvasHostActions
): () => void {
  const el = viewer.el.ownerDocument.createElementNS('http://www.w3.org/1999/xhtml', 'div')
  el.className = 'abele-canvas-chrome-host'
  viewer.el.append(el)
  const app = createApp(CanvasChrome, { editor, viewer, host })
  app.mount(el)
  return () => {
    app.unmount()
    el.remove()
  }
}

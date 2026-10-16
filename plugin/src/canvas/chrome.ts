/**
 * The canvas's controls over its tab: the kit's tool bar across the top, zoom and history in
 * Obsidian Canvas's column, the bar over what is picked, and the frames' names on the canvas.
 */
import { mountKit } from '@/components/obsidian/mount'
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
  return mountKit(el, CanvasChrome, { editor, viewer, host }, { remove: true }).unmount
}

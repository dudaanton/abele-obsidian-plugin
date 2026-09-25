/**
 * Drawing on a PDF's pages, as the bar under the page shows it: whether drawing is on, with what,
 * in which colour, and what can be undone.
 */
import type { InkColor } from './stroke'

export type InkToolName = 'pen' | 'marker' | 'eraser'

export interface InkModel {
  /** Drawing is on: the page answers the pen and nothing else. */
  on: boolean
  tool: InkToolName
  /** The pen's colour and the marker's, each kept while the other is used. */
  penColor: InkColor
  markerColor: InkColor
  /** A finger draws rather than moving the page. */
  finger: boolean
  /** The screen is touched rather than clicked, so drawing with a finger is offered at all. */
  touch: boolean
  canUndo: boolean
  canRedo: boolean
}

export const emptyInk = (): InkModel => ({
  on: false,
  tool: 'pen',
  penColor: 'black',
  markerColor: 'yellow',
  finger: false,
  touch: false,
  canUndo: false,
  canRedo: false,
})

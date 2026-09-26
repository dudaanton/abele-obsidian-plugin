/**
 * Drawing on a PDF's pages, as the bar under the page shows it: whether drawing is on, with what,
 * in which colour and thickness, and what can be undone.
 */
import type { Thickness } from '@/drawing/model'
import type { InkColor, InkStroke } from './stroke'

export type InkToolName = 'pen' | 'marker' | 'eraser'

export interface InkModel {
  /** Drawing is on: the page answers the pen and nothing else. */
  on: boolean
  tool: InkToolName
  /** The pen's colour and the marker's, each kept while the other is used. */
  penColor: InkColor
  markerColor: InkColor
  /** How thick the pen and the marker draw; kept in the reader's settings. */
  thickness: Thickness
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
  thickness: 'medium',
  finger: false,
  touch: false,
  canUndo: false,
  canRedo: false,
})

/** The pen's width and the marker's at each thickness, in page units: a nib, a highlighter's tip. */
export const INK_WIDTHS: Record<'pen' | 'marker', Record<Thickness, number>> = {
  pen: { fine: 1.2, medium: 2.2, bold: 4 },
  marker: { fine: 7, medium: 12, bold: 20 },
}

/** The stroke the tool in hand draws, its points left empty; null for the eraser. */
export function inkBrush(ink: InkModel): Omit<InkStroke, 'points'> | null {
  if (ink.tool === 'eraser') return null
  return ink.tool === 'marker'
    ? { tool: 'marker', color: ink.markerColor, size: INK_WIDTHS.marker[ink.thickness] }
    : { tool: 'pen', color: ink.penColor, size: INK_WIDTHS.pen[ink.thickness] }
}

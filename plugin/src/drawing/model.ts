/**
 * A drawing's tab as its bar shows it: whether drawing is on, with what, in which colour and
 * width, and what can be undone.
 */
import type { InkColor } from '@/reader/ink/stroke'

export type DrawingTool = 'pen' | 'marker' | 'eraser'

export type Thickness = 'fine' | 'medium' | 'bold'
export const THICKNESSES: readonly Thickness[] = ['fine', 'medium', 'bold']

/** The pen's and the marker's width at each thickness, in the drawing's units at 100%. */
export const WIDTHS: Record<'pen' | 'marker', Record<Thickness, number>> = {
  pen: { fine: 1.4, medium: 2.4, bold: 5 },
  marker: { fine: 8, medium: 14, bold: 24 },
}

export interface DrawingModel {
  /** Drawing is on: the surface answers the tools, and nothing of it reaches Obsidian. */
  on: boolean
  tool: DrawingTool
  penColor: InkColor
  markerColor: InkColor
  thickness: Thickness
  /** A finger draws rather than moving the drawing. */
  finger: boolean
  /** The screen is touched rather than clicked, so drawing with a finger is offered at all. */
  touch: boolean
  canUndo: boolean
  canRedo: boolean
  /** How large the drawing is shown, 1 for 100%. */
  zoom: number
}

export const emptyDrawingModel = (): DrawingModel => ({
  on: false,
  tool: 'pen',
  penColor: 'black',
  markerColor: 'yellow',
  thickness: 'medium',
  finger: false,
  touch: false,
  canUndo: false,
  canRedo: false,
  zoom: 1,
})

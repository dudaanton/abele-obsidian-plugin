/**
 * Who draws while drawing is on. The pen always draws, and the eraser end of a pen that has one
 * erases; the mouse draws with its main button. A finger moves the page — so a hand resting on the
 * screen, or a finger turning the page, never draws — unless drawing with a finger is on, for a
 * phone with no pen. While the pen is down no finger does anything: that is the palm.
 */

export type InkRoute = 'ink' | 'erase' | 'pan' | 'ignore'

export interface RouteState {
  /** A finger draws, rather than moving the page. */
  finger: boolean
  /** A pen is on the screen now. */
  penDown: boolean
}

/** The eraser end of a pen, as pointer events report it. */
const ERASER = 32

export function routePointer(
  state: RouteState,
  e: { pointerType: string; buttons: number }
): InkRoute {
  if (e.pointerType === 'pen') return e.buttons & ERASER ? 'erase' : 'ink'
  if (e.pointerType === 'mouse') return e.buttons & 1 ? 'ink' : 'ignore'
  if (state.penDown) return 'ignore'
  return state.finger ? 'ink' : 'pan'
}

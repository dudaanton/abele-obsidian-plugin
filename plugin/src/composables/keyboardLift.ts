/**
 * The arithmetic of a dialog on a tablet with the on-screen keyboard up — see `useKeyboardRoom`.
 *
 * On a tablet Obsidian stands a dialog in the middle of the screen, not as a sheet over its
 * whole height, and the keyboard covers a smaller share of it: often none of the dialog, or
 * only its lower edge. Moving the dialog into the room above the keyboard as a phone does then
 * jumped it about for nothing, and scrolling the field to the middle of a box whose lower part
 * the keyboard still covered could leave the field under it. So on a tablet the dialog is moved
 * up by exactly as much as the keyboard covers of it, no higher than the top of the screen,
 * and whatever still does not fit scrolls. Nothing moves while nothing is covered.
 *
 * All values are in the page's client coordinates.
 */

/** Space kept between the dialog, or the field, and the keyboard or the top of the screen. */
export const KEYBOARD_GAP = 12

export interface Lift {
  /** How far the dialog is moved up. */
  lift: number
  /** How much of the moved dialog the keyboard still covers. */
  cover: number
}

/**
 * How far a dialog is moved up so that the keyboard no longer covers it.
 *
 * @param panel - The dialog's edges where Obsidian put it, before any move of ours.
 * @param ceiling - The highest its top may go.
 * @param floor - The lowest its bottom may reach: the keyboard's top edge, less the gap.
 * @returns Null when the keyboard covers none of it.
 */
export function liftFor(
  panel: { top: number; bottom: number },
  ceiling: number,
  floor: number
): Lift | null {
  const overlap = panel.bottom - floor
  if (overlap <= 0.5) return null
  const lift = Math.max(0, Math.min(overlap, panel.top - ceiling))
  const cover = Math.max(0, panel.bottom - lift - floor)
  return { lift: Math.round(lift), cover: Math.ceil(cover) }
}

/**
 * How far to scroll so that a field stands between `ceiling` and `floor`: positive scrolls the
 * content up. Zero while it is already in sight, which is what keeps a field from jumping each
 * time the keyboard is measured again.
 */
export function revealDelta(
  field: { top: number; bottom: number },
  ceiling: number,
  floor: number
): number {
  if (field.bottom > floor + 0.5)
    return Math.max(0, Math.min(field.bottom - floor, field.top - ceiling))
  if (field.top < ceiling - 0.5) return field.top - ceiling
  return 0
}

/** The top safe-area inset — the status bar — as the page resolves it. */
export function safeAreaTop(doc: Document): number {
  const view = doc.defaultView
  if (!view || !doc.body) return 0
  // Resolved through an element: the variable itself reads back as the unresolved `env()`.
  const probe = doc.body.createDiv({ cls: 'abele-safe-area-probe' })
  const value = parseFloat(view.getComputedStyle(probe).paddingTop)
  probe.remove()
  return Number.isFinite(value) && value > 0 ? value : 0
}

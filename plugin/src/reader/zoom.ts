import { Scope } from 'obsidian'

/**
 * Zooming a PDF in its tab: Mod and plus or minus, Mod+0 back to the setting, Ctrl with the
 * mouse wheel or a trackpad pinch. A zoom chosen this way belongs to the tab and is not saved; the
 * setting is what a PDF opens at.
 */

export const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4]

/** The next step up or down from a scale; a scale between steps goes to the nearer one past it. */
export function zoomStep(scale: number, up: boolean): number {
  if (up) return ZOOM_STEPS.find((s) => s > scale + 0.01) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1]
  return [...ZOOM_STEPS].reverse().find((s) => s < scale - 0.01) ?? ZOOM_STEPS[0]
}

/**
 * The keys a book tab takes before Obsidian does: Mod+F searches the book, as it searches a note;
 * in a PDF, Mod with plus, minus and 0 zoom the pages rather than the whole app.
 */
export function bookScope(
  parent: Scope,
  host: { search(): void; pdf(): boolean; zoom(way: 'in' | 'out' | 'reset'): void }
): Scope {
  const scope = new Scope(parent)
  scope.register(['Mod'], 'f', () => {
    host.search()
    return false
  })
  const zoomKey = (way: 'in' | 'out' | 'reset') => () => {
    if (!host.pdf()) return true
    host.zoom(way)
    return false
  }
  scope.register(['Mod'], '=', zoomKey('in'))
  scope.register(['Mod'], '+', zoomKey('in'))
  scope.register(['Mod'], '-', zoomKey('out'))
  scope.register(['Mod'], '0', zoomKey('reset'))
  return scope
}

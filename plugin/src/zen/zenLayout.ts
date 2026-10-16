/**
 * Zen mode: the window keeps only the open tab. What reads as a page stands in a centred column;
 * a surface you move around in takes the whole width. The column has one width for every view,
 * the user's to change, kept between sessions.
 */

/** Obsidian's own readable line length, where the column starts. */
export const ZEN_WIDTH = 700
export const ZEN_MIN_WIDTH = 480

/** Views that are a surface, not a page: edge to edge, no column. */
export const ZEN_WIDE_VIEWS: readonly string[] = [
  'canvas',
  'graph',
  'localgraph',
  'excalidraw',
  'bases',
  'abele-canvas',
  'abele-drawing',
  'abele-image-ink',
  'abele-workbook',
  'abele-deck',
]

export const zenWide = (viewType: string | undefined): boolean =>
  !!viewType && ZEN_WIDE_VIEWS.includes(viewType)

/** The column's width kept inside what the window can hold. */
export const zenWidth = (asked: number, room: number): number =>
  Math.round(Math.max(ZEN_MIN_WIDTH, Math.min(asked, Math.max(ZEN_MIN_WIDTH, room))))

/** What zen mode remembers across a restart. */
export interface ZenState {
  on: boolean
  width: number
}

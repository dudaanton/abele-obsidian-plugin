/**
 * Abele's header and footer inside a note card on the canvas: whether a card shows them, and how
 * much of them, from the card's size on the screen. One rule covers a small card, a canvas seen
 * from far away and a phone, because each of them is the same thing to the eye: a small card.
 */

/** All of the header and the footer, as a tab shows them; a quiet row of codes; or nothing. */
export type CardPanels = 'full' | 'codes' | 'none'

/** Room on the screen, in CSS pixels, a card needs to show the header and the footer whole. */
export const PANELS_FULL = { width: 280, height: 320 } as const
/** Smaller than this a row of codes would only cover the card's own words. */
export const PANELS_CODES = { width: 120, height: 96 } as const

/** How much of the header and footer a card shows at its size on the screen. */
export function cardPanels(onScreen: { width: number; height: number }): CardPanels {
  if (onScreen.width >= PANELS_FULL.width && onScreen.height >= PANELS_FULL.height) return 'full'
  return onScreen.width >= PANELS_CODES.width && onScreen.height >= PANELS_CODES.height
    ? 'codes'
    : 'none'
}

type CardNode = { type: string; file?: string; abele?: Record<string, unknown> }

/**
 * Whether a card shows them at all: only a markdown note has a header and a footer. Its own choice,
 * kept in the canvas beside the card, wins over the canvas's default.
 */
export function panelsShown(node: CardNode, canvasDefault: boolean): boolean {
  if (node.type !== 'file' || !/\.md$/i.test(node.file ?? '')) return false
  const own = node.abele?.panels
  return typeof own === 'boolean' ? own : canvasDefault
}

/**
 * The footer's lists that start folded in a card, all but the first one the note has, so the
 * note's own words are not pushed far down. What is unfolded after that is the note's, as in a tab.
 */
export function cardFolds(lists: readonly string[]): string[] {
  return lists.slice(1)
}

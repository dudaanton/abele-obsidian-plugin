/**
 * The colours a piece of the kit may be tinted with.
 *
 * Named after Obsidian's own theme variables (`--color-red` and the rest) rather than stored as
 * hex, so a tint follows the user's theme and its light and dark variants. `grey` is the
 * absence of a tint: the kit's default muted look.
 */
export const KIT_COLORS = [
  'grey',
  'red',
  'orange',
  'yellow',
  'green',
  'cyan',
  'blue',
  'purple',
  'pink',
] as const

export type KitColor = (typeof KIT_COLORS)[number]

export const KIT_COLOR_NAMES: Record<KitColor, string> = {
  grey: 'Grey',
  red: 'Red',
  orange: 'Orange',
  yellow: 'Yellow',
  green: 'Green',
  cyan: 'Cyan',
  blue: 'Blue',
  purple: 'Purple',
  pink: 'Pink',
}

export const isKitColor = (value: unknown): value is KitColor =>
  typeof value === 'string' && (KIT_COLORS as readonly string[]).includes(value)

/** Ordinary-note colours, shared by the editor, rendered notes and comment model. */
export const HIGHLIGHT_COLORS = [
  'red',
  'orange',
  'yellow',
  'green',
  'cyan',
  'blue',
  'purple',
  'pink',
  'gray',
] as const
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number]

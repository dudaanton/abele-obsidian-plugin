/** The canvas's tools along the top, in families sharing a slot, and the values they pick from. */
import type { KitColor } from '@/constants/colors'
import { SHAPES } from '@/canvas/core/model'

export type Slot = {
  id: string
  /** The family's members: a tool of the editor, or an action that adds something. */
  members: { id: string; label: string; icon: string; tooltip: string; key?: string }[]
}
export const SHAPE_ICONS: Record<string, string> = {
  rectangle: 'square',
  pill: 'rectangle-horizontal',
  diamond: 'diamond',
  parallelogram: 'square-dashed',
  circle: 'circle',
  'predefined-process': 'columns-3',
  document: 'file',
  database: 'database',
}
export const ROUTE_ICONS: Record<string, string> = {
  direct: 'minus',
  square: 'corner-down-right',
  bezier: 'spline',
}
export const COLOURS = ['', '1', '2', '3', '4', '5', '6']
export const COLOUR_NAMES: Record<string, string> = {
  '': 'the text colour',
  1: 'red',
  2: 'orange',
  3: 'yellow',
  4: 'green',
  5: 'cyan',
  6: 'purple',
}
/** Each canvas colour as the kit's colour a glyph wears; the text colour wears none. */
export const SWATCH_COLOURS: Record<string, KitColor | undefined> = {
  '': undefined,
  1: 'red',
  2: 'orange',
  3: 'yellow',
  4: 'green',
  5: 'cyan',
  6: 'purple',
}
export const THICKNESSES = ['fine', 'medium', 'bold']
export const SLOTS: Slot[][] = [
  [
    {
      id: 'select',
      members: [
        {
          id: 'select',
          label: 'Select canvas objects',
          icon: 'mouse-pointer-2',
          tooltip: 'Select (V)',
        },
      ],
    },
    {
      id: 'pan',
      members: [
        {
          id: 'pan',
          label: 'Navigate canvas',
          icon: 'hand',
          tooltip: 'Hand: move the canvas (H, or hold Space)',
        },
      ],
    },
  ],
  [
    {
      id: 'card',
      members: [{ id: 'card', label: 'Add text card', icon: 'sticky-note', tooltip: 'Card (T)' }],
    },
    {
      id: 'note',
      members: [
        {
          id: 'note',
          label: 'Add note or attachment',
          icon: 'file-text',
          tooltip: 'Note or file from the vault (N)',
        },
      ],
    },
    {
      id: 'link',
      members: [{ id: 'link', label: 'Add link', icon: 'globe', tooltip: 'Web page (W)' }],
    },
    {
      id: 'shape',
      members: SHAPES.map((s) => ({
        id: s,
        label: 'Add canvas shape',
        icon: SHAPE_ICONS[s] ?? 'square',
        tooltip: `Shape: ${s.replace(/-/g, ' ')} (R)`,
      })),
    },
    {
      id: 'connect',
      members: [
        {
          id: 'connect',
          label: 'Draw connection',
          icon: 'spline',
          tooltip: 'Connect two cards (A)',
        },
        { id: 'line', label: 'Draw free line', icon: 'minus', tooltip: 'Line' },
        { id: 'arrow', label: 'Draw free arrow', icon: 'move-up-right', tooltip: 'Arrow' },
      ],
    },
    {
      id: 'frame',
      members: [
        {
          id: 'frame',
          label: 'Draw frame',
          icon: 'frame',
          tooltip: 'Frame: draw around cards (F)',
        },
      ],
    },
  ],
  [
    {
      id: 'pen',
      members: [
        { id: 'pen', label: 'Draw with pen', icon: 'pen-line', tooltip: 'Pen (P)' },
        {
          id: 'marker',
          label: 'Draw with marker',
          icon: 'highlighter',
          tooltip: 'Marker (P again)',
        },
      ],
    },
    {
      id: 'eraser',
      members: [
        {
          id: 'eraser',
          label: 'Erase whole strokes',
          icon: 'eraser',
          tooltip: 'Eraser: whole strokes (E)',
        },
        {
          id: 'partial-eraser',
          label: 'Erase part of strokes',
          icon: 'eraser',
          tooltip: 'Eraser: part of a stroke (E again)',
        },
      ],
    },
    {
      id: 'lasso',
      members: [
        {
          id: 'lasso',
          label: 'Lasso canvas objects',
          icon: 'lasso',
          tooltip: 'Lasso: circle cards and ink (L)',
        },
      ],
    },
  ],
]
/** On a phone seven slots fit; the rest wait in More, in this order of need. */
export const PHONE_ORDER = ['select', 'pen', 'eraser', 'shape', 'card', 'note']

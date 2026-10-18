import { streamCLabel } from '@/i18n/streamCLabels'

import { t } from '@/i18n'
/** The canvas's tools along the top, in families sharing a slot, and the values they pick from. */
import type { KitColor } from '@/constants/colors'
import { SHAPES } from '@/canvas/core/model'

export type Slot = {
  id: string
  /** The family's members: a tool of the editor, or an action that adds something. */
  members: {
    id: string
    /** Stable editor command identity, separate from localized presentation. */
    action: string
    label: string
    icon: string
    tooltip: string
    key?: string
  }[]
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
  get ''() {
    return t('streamC.ba26863be046a8b6')
  },
  get 1() {
    return streamCLabel('red')
  },
  get 2() {
    return streamCLabel('orange')
  },
  get 3() {
    return streamCLabel('yellow')
  },
  get 4() {
    return streamCLabel('green')
  },
  get 5() {
    return streamCLabel('cyan')
  },
  get 6() {
    return streamCLabel('purple')
  },
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
          action: 'Select canvas objects',
          get label() {
            return t('streamC.485dd67e6f54091a')
          },
          icon: 'mouse-pointer-2',
          get tooltip() {
            return t('streamC.5759f4a81e7d4ac0')
          },
        },
      ],
    },
    {
      id: 'pan',
      members: [
        {
          id: 'pan',
          action: 'Navigate canvas',
          get label() {
            return t('streamC.a756bb9cb6027fc1')
          },
          icon: 'hand',
          get tooltip() {
            return t('streamC.6a32fc31bcdc623b')
          },
        },
      ],
    },
  ],
  [
    {
      id: 'card',
      members: [
        {
          id: 'card',
          action: 'Add text card',
          get label() {
            return t('streamC.75f9f118e80b7b3c')
          },
          icon: 'sticky-note',
          get tooltip() {
            return t('streamC.bb1e80094f1fb0e3')
          },
        },
      ],
    },
    {
      id: 'note',
      members: [
        {
          id: 'note',
          action: 'Add note or attachment',
          get label() {
            return t('streamC.24151c1601482134')
          },
          icon: 'file-text',
          get tooltip() {
            return t('streamC.8462637f554e23f7')
          },
        },
      ],
    },
    {
      id: 'picture',
      members: [
        {
          id: 'picture',
          action: 'Add a picture',
          get label() {
            return t('streamC.4058365da297d206')
          },
          icon: 'image-plus',
          get tooltip() {
            return t('streamC.d7a4eefaf4946ede')
          },
        },
      ],
    },
    {
      id: 'link',
      members: [
        {
          id: 'link',
          action: 'Add link',
          get label() {
            return t('settings.LinksSettings.add_link.dfe9ca4d')
          },
          icon: 'globe',
          get tooltip() {
            return t('streamC.34274af32ea6ba41')
          },
        },
      ],
    },
    {
      id: 'shape',
      members: SHAPES.map((s) => ({
        id: s,
        action: 'Add canvas shape',
        get label() {
          return t('streamC.0cd6a30f30f2ecfd')
        },
        icon: SHAPE_ICONS[s] ?? 'square',
        get tooltip() {
          return t('streamC.029225b7e9f235b2', { v1: streamCLabel(s) })
        },
      })),
    },
    {
      id: 'connect',
      members: [
        {
          id: 'connect',
          action: 'Draw connection',
          get label() {
            return t('streamC.0c6699097160ecd1')
          },
          icon: 'spline',
          get tooltip() {
            return t('streamC.a87a3bd33862738f')
          },
        },
        {
          id: 'line',
          action: 'Draw free line',
          get label() {
            return t('streamC.779e24c30ef34f30')
          },
          icon: 'minus',
          get tooltip() {
            return t('streamC.d7852cd0d2453e8c')
          },
        },
        {
          id: 'arrow',
          action: 'Draw free arrow',
          get label() {
            return t('streamC.bf8fca739da70530')
          },
          icon: 'move-up-right',
          get tooltip() {
            return t('streamC.05800e70aa10c86f')
          },
        },
      ],
    },
    {
      id: 'frame',
      members: [
        {
          id: 'frame',
          action: 'Draw frame',
          get label() {
            return t('streamC.73906132cd9bf5cb')
          },
          icon: 'frame',
          get tooltip() {
            return t('streamC.56f8c3cd1dd9cd11')
          },
        },
      ],
    },
  ],
  [
    {
      id: 'pen',
      members: [
        {
          id: 'pen',
          action: 'Draw with pen',
          get label() {
            return t('streamC.48d5e8a27747d1d9')
          },
          icon: 'pen-line',
          get tooltip() {
            return t('streamC.92edb7d2df65d483')
          },
        },
        {
          id: 'marker',
          action: 'Draw with marker',
          get label() {
            return t('streamC.2cfd06bcc4b46226')
          },
          icon: 'highlighter',
          get tooltip() {
            return t('streamC.e03a7877051d7749')
          },
        },
      ],
    },
    {
      id: 'eraser',
      members: [
        {
          id: 'eraser',
          action: 'Erase whole strokes',
          get label() {
            return t('streamC.66b85e3faf8a611f')
          },
          icon: 'eraser',
          get tooltip() {
            return t('streamC.f3590cb1bb3df38a')
          },
        },
        {
          id: 'partial-eraser',
          action: 'Erase part of strokes',
          get label() {
            return t('streamC.6844a0a8b292be60')
          },
          icon: 'eraser',
          get tooltip() {
            return t('streamC.83e7da687f29680a')
          },
        },
      ],
    },
    {
      id: 'lasso',
      members: [
        {
          id: 'lasso',
          action: 'Lasso canvas objects',
          get label() {
            return t('streamC.c5cbaa882763769e')
          },
          icon: 'lasso',
          get tooltip() {
            return t('streamC.4e39cdb740dc7795')
          },
        },
      ],
    },
  ],
]
/** On a phone seven slots fit; the rest wait in More, in this order of need. */
export const PHONE_ORDER = ['select', 'pen', 'eraser', 'shape', 'card', 'note']

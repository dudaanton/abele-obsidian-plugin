/**
 * The quick button's settings, kept under `quickButton` in the plugin's settings.
 *
 * Off by default: the button is a concept, and a floating thing over every screen is something
 * a person chooses to have. Everything here is pure, so what a settings file may hold is tested
 * without an app.
 */

/** Something the user put in the button's menu: an Obsidian command or one of their scripts. */
export interface QuickAction {
  id: string
  type: 'command' | 'script'
  /** The command's id, `plugin:command`; empty for a script. */
  commandId: string
  /** The script's name; empty for a command. */
  scriptName: string
  /** What the menu calls it; empty means the command's or the script's own name. */
  name: string
  /** A lucide icon name; empty means the command's own, or a play glyph for a script. */
  icon: string
}

export type QuickSide = 'left' | 'right'

export interface QuickButtonSettings {
  enabled: boolean
  /** On a tablet as well as a phone. */
  tablet: boolean
  /** The edge it stands at; dragging it across changes this. */
  side: QuickSide
  /** How far above its resting place it was dragged, in CSS pixels. */
  lift: number
  actions: QuickAction[]
}

export const DEFAULT_QUICK_BUTTON: QuickButtonSettings = {
  enabled: false,
  tablet: false,
  side: 'right',
  lift: 0,
  actions: [],
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '')

function actionFrom(raw: unknown): QuickAction | null {
  if (!raw || typeof raw !== 'object') return null
  const a = raw as Partial<QuickAction>
  if (typeof a.id !== 'string' || !a.id) return null
  if (a.type !== 'command' && a.type !== 'script') return null
  return {
    id: a.id,
    type: a.type,
    commandId: text(a.commandId),
    scriptName: text(a.scriptName),
    name: text(a.name),
    icon: text(a.icon),
  }
}

export function quickButtonSettingsFrom(
  stored?: Partial<QuickButtonSettings> | null
): QuickButtonSettings {
  const s = stored ?? {}
  const d = DEFAULT_QUICK_BUTTON
  const lift = typeof s.lift === 'number' && Number.isFinite(s.lift) ? Math.max(0, s.lift) : d.lift
  return {
    enabled: typeof s.enabled === 'boolean' ? s.enabled : d.enabled,
    tablet: typeof s.tablet === 'boolean' ? s.tablet : d.tablet,
    side: s.side === 'left' || s.side === 'right' ? s.side : d.side,
    lift: Math.round(lift),
    actions: (Array.isArray(s.actions) ? s.actions : [])
      .map(actionFrom)
      .filter((a): a is QuickAction => a !== null),
  }
}

import { nanoid } from 'nanoid'

/**
 * Automations: a script run by itself when something happens to a note.
 *
 * The words here are shared by the three parts that make one work — the bus that notices what
 * happened, the rules that say what to do about it, and the script that is handed the answer —
 * so they live apart from all three.
 */

/** Everything an automation can wait for. */
export const EVENT_KINDS = [
  'task.completed',
  'task.reopened',
  'task.created',
  'task.changed',
  'task.date-changed',
  'note.created',
  'note.changed',
  'note.renamed',
  'note.deleted',
] as const

export type EventKind = (typeof EVENT_KINDS)[number]

/** How each event reads in settings, and in the list of runs. */
export const EVENT_LABELS: Record<EventKind, string> = {
  'task.completed': 'Task completed',
  'task.reopened': 'Task reopened',
  'task.created': 'Task created',
  'task.changed': 'Task changed',
  'task.date-changed': 'Task date changed',
  'note.created': 'Note created',
  'note.changed': 'Note changed',
  'note.renamed': 'Note renamed',
  'note.deleted': 'Note deleted',
}

/** Task events are about notes of type `task` by definition, so they take no type filter. */
export const isTaskKind = (kind: EventKind): boolean => kind.startsWith('task.')

export type Frontmatter = Record<string, unknown>

/**
 * Where a change came from, as far as this device can tell.
 *
 * `local` is a write made here — the editor, the properties panel, the plugin, a script.
 * `external` is a file that changed under Obsidian: sync from another device, another app, a
 * file edited while Obsidian was closed.
 */
export type ChangeOrigin = 'local' | 'external'

/**
 * One thing that happened to one note, as the bus hands it on.
 *
 * A single edit can be several events at once — ticking a task completes it, changes it and
 * changes a note — so the bus names all of them in `kinds`, and each rule picks out the one it
 * waits for.
 */
export interface NoteChange {
  kinds: EventKind[]
  /** Where the note is now; for a deleted note, where it was. */
  path: string
  /** Where it was before a rename. */
  oldPath?: string
  /** Its `type` frontmatter: after the change, or before it for a deleted note. */
  type: string
  /** Frontmatter before the change. `null` for a note that did not exist. */
  before: Frontmatter | null
  /** Frontmatter after the change. `null` for a note that no longer exists. */
  after: Frontmatter | null
  /** Frontmatter properties whose value is different, added or gone. */
  changed: string[]
  /** Whether the text below the frontmatter changed. */
  bodyChanged: boolean
  origin: ChangeOrigin
  /**
   * The automations whose own scripts wrote this change, oldest first — how a rule recognises
   * its own echo, and how a chain of rules setting each other off is cut short.
   */
  chain: string[]
  at: number
}

/** What a script started by an automation finds in `event`. */
export interface AutomationEvent extends Omit<NoteChange, 'chain'> {
  /** The event the rule waits for — one of `kinds`. */
  kind: EventKind
  rule: { id: string; name: string }
}

/**
 * One rule: when this happens to a note like that, run this script.
 *
 * `params` follow the header buttons' model — a value per parameter the script declares, each
 * a template filled in from the note, so one rule means something different on every note.
 */
export interface AutomationRule {
  id: string
  name: string
  enabled: boolean
  event: EventKind
  /** Note types, matched against `type` frontmatter. Empty is any note. Unused for tasks. */
  noteTypes: string[]
  /** Folders a note must be under, at any depth. Empty is anywhere. */
  folders: string[]
  /** A frontmatter property the note must have… */
  property: string
  /** …equal to this. Empty means only that the property is filled in. */
  value: string
  scriptName: string
  params: Record<string, string>
  /** At most one run per this many seconds for one note. 0 runs on every event. */
  throttleSeconds: number
  /** Also run for changes that arrived from elsewhere — sync, another app. Off by default. */
  includeExternal: boolean
}

export const DEFAULT_THROTTLE_SECONDS = 5

/** A rule as settings, an agent or a transfer may have left it, made whole. */
export function normalizeRule(raw: Partial<AutomationRule> & { id?: string }): AutomationRule {
  const list = (value: unknown): string[] =>
    Array.isArray(value)
      ? value.filter((v): v is string => typeof v === 'string' && v.trim() !== '')
      : []
  const event: EventKind =
    raw.event && (EVENT_KINDS as readonly string[]).includes(raw.event)
      ? raw.event
      : 'task.completed'
  const throttle = raw.throttleSeconds == null ? NaN : Number(raw.throttleSeconds)

  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : nanoid(8),
    name: typeof raw.name === 'string' ? raw.name : '',
    enabled: raw.enabled !== false,
    event,
    noteTypes: list(raw.noteTypes),
    folders: list(raw.folders),
    property: typeof raw.property === 'string' ? raw.property : '',
    value: typeof raw.value === 'string' ? raw.value : '',
    scriptName: typeof raw.scriptName === 'string' ? raw.scriptName : '',
    params:
      raw.params && typeof raw.params === 'object' && !Array.isArray(raw.params)
        ? { ...raw.params }
        : {},
    throttleSeconds:
      Number.isFinite(throttle) && throttle >= 0 ? throttle : DEFAULT_THROTTLE_SECONDS,
    includeExternal: raw.includeExternal === true,
  }
}

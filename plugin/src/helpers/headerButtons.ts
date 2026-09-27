import type { HeaderButtonCondition, HeaderButtonDefinition } from '@/services/AbeleConfig'
import { getFrontmatterFromCache, renderTemplate } from '@/helpers/notesUtils'
import { DATE_FORMAT } from '@/constants/dates'
import dayjs from 'dayjs'
import { getAllTags, TFile } from 'obsidian'
import { GlobalStore } from '@/stores/GlobalStore'

/**
 * Buttons a note's header offers, and what they pass to the script behind them.
 *
 * A button is configured once, for a type of note, and then appears on every note of that
 * type — so its parameters cannot be fixed values. They are templates, filled in from the
 * note the button is sitting on: `{{title}}`, `{{path}}`, and any field of its frontmatter.
 */

/** The buttons configured for a note of this type. */
export function buttonsForType(
  buttons: HeaderButtonDefinition[],
  type: string | null
): HeaderButtonDefinition[] {
  return buttonsForNote(buttons, { type, path: '' })
}

/** What a note, or another file open in a tab, offers a button to judge it by. */
export interface ButtonTarget {
  type: string | null
  path: string
  frontmatter?: Record<string, unknown> | null
  /** Its tags, as Obsidian gives them: `#work/meetings`. */
  tags?: string[]
  /** False for a file that is not a note — a PDF, a canvas, a book. Absent means a note. */
  markdown?: boolean
}

export interface ButtonLookup {
  /** Whether a command is there now; one that is not — its plugin off — hides its button. */
  hasCommand?: (id: string) => boolean
}

/** A file's tags, frontmatter and body both, as Obsidian has them indexed. */
export function noteTags(path: string): string[] {
  const app = GlobalStore.getInstance().app
  const file = app?.vault?.getAbstractFileByPath?.(path)
  if (!(file instanceof TFile)) return []
  const cache = app.metadataCache?.getFileCache?.(file)
  return cache ? (getAllTags(cache) ?? []) : []
}

/** What pressing a button does: an old button, from before commands, runs its script. */
export function buttonRuns(button: HeaderButtonDefinition): 'script' | 'command' {
  return button.runs === 'command' ? 'command' : 'script'
}

/**
 * The buttons a note shows, in the order they were configured, script and command ones alike.
 *
 * Two questions, both of which have to be yes. Where: every note, a note of one of its types,
 * with one of its tags, or anywhere under one of its folders — and a button that names none of
 * those but has property conditions means any note. Then what: its property conditions, all of
 * them or any one, against the note's frontmatter. One that is switched off, or names nothing to
 * run — no script, no command, or a command that is not there now — shows nowhere. A file that
 * is not a note shows only the command buttons that ask for other files too.
 */
export function buttonsForNote(
  buttons: HeaderButtonDefinition[],
  note: ButtonTarget,
  lookup: ButtonLookup = {}
): HeaderButtonDefinition[] {
  const noteType = note.type?.trim().toLowerCase() ?? ''
  const markdown = note.markdown !== false

  return buttons.filter((button) => {
    if (button.enabled === false || !runnable(button, lookup)) return false
    if (!markdown && !(buttonRuns(button) === 'command' && button.otherFiles)) return false
    const conditions = (button.conditions ?? []).filter((c) => c.property.trim() !== '')
    return (
      placeFits(button, noteType, note, conditions.length > 0) &&
      propertiesFit(conditions, button.conditionMode, note.frontmatter ?? null)
    )
  })
}

/** The buttons of the plugin's own header inside a note, which run scripts. */
export function scriptButtonsFor(
  buttons: HeaderButtonDefinition[],
  note: ButtonTarget
): HeaderButtonDefinition[] {
  return buttonsForNote(buttons, note).filter((b) => buttonRuns(b) === 'script')
}

/** The buttons among the icons at the top right of a note, which run commands. */
export function commandButtonsFor(
  buttons: HeaderButtonDefinition[],
  note: ButtonTarget,
  lookup: ButtonLookup = {}
): HeaderButtonDefinition[] {
  return buttonsForNote(buttons, note, lookup).filter((b) => buttonRuns(b) === 'command')
}

function runnable(button: HeaderButtonDefinition, lookup: ButtonLookup): boolean {
  if (buttonRuns(button) === 'script') return !!button.scriptName
  const id = button.commandId?.trim()
  if (!id) return false
  return lookup.hasCommand ? lookup.hasCommand(id) : true
}

/**
 * The buttons a header has room for, and the rest, which go to the view's more-options menu —
 * on a phone the header holds only a couple of icons beside the note's title.
 */
export function splitForHeader<T>(buttons: T[], limit: number): { shown: T[]; overflow: T[] } {
  const room = Math.max(0, limit)
  return { shown: buttons.slice(0, room), overflow: buttons.slice(room) }
}

function placeFits(
  button: HeaderButtonDefinition,
  noteType: string,
  note: ButtonTarget,
  hasConditions: boolean
): boolean {
  if (button.allNotes) return true
  const types = button.noteTypes ?? []
  const folders = (button.folders ?? []).filter((f) => f.trim())
  const tags = (button.tags ?? []).map(bareTag).filter(Boolean)
  if (hasConditions && !types.length && !folders.length && !tags.length) return true
  if (noteType && types.some((t) => t.trim().toLowerCase() === noteType)) return true
  if (tags.length && (note.tags ?? []).some((t) => tags.some((wanted) => tagFits(t, wanted))))
    return true
  return folders.some((folder) => pathFitsFolder(note.path, folder))
}

/** A tag as compared: no `#`, no stray spaces, case folded. */
function bareTag(tag: string): string {
  return tag.trim().replace(/^#/, '').toLowerCase()
}

/** `#work/meetings` has the tag `work`; `#workshop` does not. */
function tagFits(tag: string, wanted: string): boolean {
  const bare = bareTag(tag)
  return bare === wanted || bare.startsWith(wanted + '/')
}

function propertiesFit(
  conditions: HeaderButtonCondition[],
  mode: 'all' | 'any' | undefined,
  frontmatter: Record<string, unknown> | null
): boolean {
  if (!conditions.length) return true
  const holds = (c: HeaderButtonCondition) => conditionHolds(c, frontmatter)
  return mode === 'any' ? conditions.some(holds) : conditions.every(holds)
}

/** Filled in, the way a person reads a property: an empty string or list is not. */
function filled(value: unknown): boolean {
  if (value === undefined || value === null) return false
  if (typeof value === 'string') return value.trim() !== ''
  if (Array.isArray(value)) return value.some(filled)
  return true
}

/**
 * A value as compared: trimmed, case folded, and a link read as the note it names — so
 * `Garden` matches `[[Garden]]` and `[[Garden|the garden]]`.
 */
function comparable(value: unknown): string {
  const text = asText(value).trim().toLowerCase()
  const link = /^\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]$/.exec(text)
  return (link ? link[1] : text).trim()
}

function conditionHolds(
  condition: HeaderButtonCondition,
  frontmatter: Record<string, unknown> | null
): boolean {
  const actual = frontmatter?.[condition.property.trim()]
  switch (condition.test) {
    case 'filled':
      return filled(actual)
    case 'empty':
      return !filled(actual)
    case 'not-equals':
    case 'equals': {
      const wanted = comparable(condition.value)
      const values = Array.isArray(actual) ? actual : [actual]
      const equal = values.some((v) => filled(v) && comparable(v) === wanted)
      return condition.test === 'equals' ? equal : !equal
    }
  }
}

/**
 * Whether a vault path sits under a folder, at any depth. `Films` does not contain `Filmsy/`.
 * The folder may be a pattern: `*` stands for one folder's name, `**` for any number of them —
 * so a star in the middle, between two project folders and `Notes`, means every project's notes.
 */
export function pathFitsFolder(path: string, folder: string): boolean {
  const prefix = folder.trim().replace(/^\/+|\/+$/g, '')
  if (prefix === '') return false
  if (!prefix.includes('*')) return path.startsWith(prefix + '/')
  const pattern = prefix
    .split('/')
    .map((part) =>
      part === '**'
        ? '(?:[^/]+/)*'
        : part.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*') + '/'
    )
    .join('')
  return new RegExp('^' + pattern).test(path)
}

/** The part of a folder pattern before its first `*`, which has to exist for it to match. */
function fixedPart(folder: string): string {
  const parts = folder.split('/')
  const star = parts.findIndex((p) => p.includes('*'))
  return (star < 0 ? parts : parts.slice(0, star)).join('/')
}

/**
 * What a note offers a template.
 *
 * Frontmatter first, so a note can supply anything a script asks for by writing it down; the
 * names below are then laid over it, so `{{path}}` means the path whatever the note says.
 * `date` is today rather than the note's own, which is what makes `{{date:YYYY-MM-DD}}`
 * behave as it does everywhere else in the plugin.
 */
export function noteVariables(filePath: string): Record<string, string> {
  const variables: Record<string, string> = {}

  const frontmatter = getFrontmatterFromCache(filePath)
  for (const [key, value] of Object.entries(frontmatter ?? {})) {
    variables[key] = asText(value)
  }

  const name = filePath.split('/').pop() ?? filePath
  variables.path = filePath
  variables.title = name.replace(/\.md$/, '')
  variables.folder = filePath.slice(0, Math.max(0, filePath.length - name.length - 1))
  variables.type = asText(frontmatter?.type ?? '')
  variables.date = dayjs().format(DATE_FORMAT)

  return variables
}

/** A frontmatter value as a template can use it. */
export function asText(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map(asText).join(', ')
  // A date or a nested map: JSON is at least readable, where the default would be
  // `[object Object]`. Anything else — null, undefined — has nothing to say.
  if (value !== null && typeof value === 'object') return JSON.stringify(value)
  return ''
}

/** The button's configured parameters, with the note's own data substituted into them. */
export function buttonParams(
  button: HeaderButtonDefinition,
  variables: Record<string, string>
): Record<string, string> {
  const params: Record<string, string> = {}

  for (const [name, template] of Object.entries(button.params ?? {})) {
    params[name] = renderTemplate(template, variables)
  }

  return params
}

/** What the settings know of the vault to judge a button's placement by. */
export interface VaultShape {
  /** Every `type` a note in the vault has, lower-cased. */
  types: Set<string>
  folderExists: (folder: string) => boolean
  /** Whether a command is there now. Absent, every command is taken to be. */
  hasCommand?: (id: string) => boolean
}

export interface PlacementProblems {
  /** Why the button can show on no note at all, or null when it can show somewhere. */
  nowhere: string | null
  /** Its types that no note in the vault has, as they were typed. */
  unknownTypes: string[]
  /** Its folders that are not in the vault, as they were typed. */
  missingFolders: string[]
}

/**
 * Why a button would show nowhere, said in the settings where it is set up.
 *
 * A button set up for a type no note has — `tasks` for notes whose type is `task` — or for a
 * folder that is not there used to simply never appear, with nothing anywhere to say why.
 */
export function placementProblems(
  button: HeaderButtonDefinition,
  vault: VaultShape
): PlacementProblems {
  const types = (button.noteTypes ?? []).map((t) => t.trim()).filter(Boolean)
  const folders = (button.folders ?? []).map((f) => f.trim()).filter(Boolean)
  const unknownTypes = types.filter((t) => !vault.types.has(t.toLowerCase()))
  // A pattern is judged by the folder its stars hang from: `Projects/*/Notes` needs `Projects`.
  const missingFolders = folders.filter(
    (f) => !vault.folderExists(fixedPart(f.replace(/^\/+|\/+$/g, '')) || '/')
  )
  const tags = (button.tags ?? []).map((t) => t.trim()).filter(Boolean)
  const hasConditions = (button.conditions ?? []).some((c) => c.property.trim() !== '')
  const command = buttonRuns(button) === 'command'
  const commandId = button.commandId?.trim() ?? ''

  let nowhere: string | null = null
  if (command && !commandId) {
    nowhere = 'Shows nowhere until a command is chosen.'
  } else if (command && vault.hasCommand && !vault.hasCommand(commandId)) {
    nowhere =
      'Shows nowhere now: its command is not available — the plugin that gives it may be off.'
  } else if (!command && !button.scriptName) {
    nowhere = 'Shows nowhere until a script is chosen.'
  } else if (
    !button.allNotes &&
    !types.length &&
    !folders.length &&
    !tags.length &&
    !hasConditions
  ) {
    nowhere = 'Shows nowhere yet: give it note types, folders, tags, a property, or every note.'
  } else if (
    !button.allNotes &&
    !tags.length &&
    (types.length || folders.length) &&
    unknownTypes.length === types.length &&
    missingFolders.length === folders.length
  ) {
    nowhere = 'Shows nowhere: no note in this vault has any of its types or sits in its folders.'
  }

  return { nowhere, unknownTypes, missingFolders }
}

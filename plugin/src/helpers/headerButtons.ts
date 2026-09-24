import type { HeaderButtonCondition, HeaderButtonDefinition } from '@/services/AbeleConfig'
import { getFrontmatterFromCache, renderTemplate } from '@/helpers/notesUtils'
import { DATE_FORMAT } from '@/constants/dates'
import dayjs from 'dayjs'

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

/**
 * The buttons a note shows, in the order they were configured.
 *
 * Two questions, both of which have to be yes. Where: every note, a note of one of its types,
 * or a note anywhere under one of its folders — and a button that names none of those but has
 * property conditions means any note. Then what: its property conditions, all of them or any
 * one, against the note's frontmatter. One that is switched off, or names no script and so
 * would do nothing if pressed, shows nowhere.
 */
export function buttonsForNote(
  buttons: HeaderButtonDefinition[],
  note: { type: string | null; path: string; frontmatter?: Record<string, unknown> | null }
): HeaderButtonDefinition[] {
  const noteType = note.type?.trim().toLowerCase() ?? ''

  return buttons.filter((button) => {
    if (!button.scriptName || button.enabled === false) return false
    const conditions = (button.conditions ?? []).filter((c) => c.property.trim() !== '')
    return (
      placeFits(button, noteType, note.path, conditions.length > 0) &&
      propertiesFit(conditions, button.conditionMode, note.frontmatter ?? null)
    )
  })
}

function placeFits(
  button: HeaderButtonDefinition,
  noteType: string,
  path: string,
  hasConditions: boolean
): boolean {
  if (button.allNotes) return true
  const types = button.noteTypes ?? []
  const folders = button.folders ?? []
  if (hasConditions && !types.length && !folders.length) return true
  if (noteType && types.some((t) => t.trim().toLowerCase() === noteType)) return true
  return folders.some((folder) => isInside(path, folder))
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

/** Whether a vault path sits under a folder, at any depth. `Films` does not contain `Filmsy/`. */
function isInside(path: string, folder: string): boolean {
  const prefix = folder.trim().replace(/^\/+|\/+$/g, '')
  return prefix !== '' && path.startsWith(prefix + '/')
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
  const missingFolders = folders.filter((f) => !vault.folderExists(f.replace(/^\/+|\/+$/g, '')))
  const hasConditions = (button.conditions ?? []).some((c) => c.property.trim() !== '')

  let nowhere: string | null = null
  if (!button.scriptName) {
    nowhere = 'Shows nowhere until a script is chosen.'
  } else if (!button.allNotes && !types.length && !folders.length && !hasConditions) {
    nowhere = 'Shows nowhere yet: give it note types, folders, a property, or every note.'
  } else if (
    !button.allNotes &&
    (types.length || folders.length) &&
    unknownTypes.length === types.length &&
    missingFolders.length === folders.length
  ) {
    nowhere = 'Shows nowhere: no note in this vault has any of its types or sits in its folders.'
  }

  return { nowhere, unknownTypes, missingFolders }
}

import type { HeaderButtonDefinition } from '@/services/AbeleConfig'
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
  if (!type) return []
  const noteType = type.trim().toLowerCase()

  return buttons.filter(
    (button) =>
      button.scriptName &&
      button.noteTypes.some((configured) => configured.trim().toLowerCase() === noteType)
  )
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
function asText(value: unknown): string {
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

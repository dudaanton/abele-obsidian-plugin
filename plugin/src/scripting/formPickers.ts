import type { App, TFile } from 'obsidian'
import {
  createPickedNote,
  formatPick,
  matchesFilter,
  pickItems,
  resolveNote,
} from '@/helpers/noteFilter'
import type { FormAnswers, FormField } from './types'

const isPicker = (field: FormField) => field.type === 'note-picker'

/**
 * Why the answers to a form's note pickers cannot be taken, or `null` when they can.
 *
 * Asked before an agent's answer reaches the script: a note outside the filter, or two notes in
 * a field taking one, goes back to the agent to correct while the run keeps waiting, rather than
 * into a script that trusted its own filter.
 */
export function checkPickerAnswers(
  app: App,
  fields: FormField[],
  values: Record<string, string>
): string | null {
  for (const field of fields.filter(isPicker)) {
    const what = field.label || field.name
    const items = pickItems(values[field.name])
    if (!field.multiple && items.length > 1) {
      return `"${what}" takes one note, and ${items.length} were given.`
    }
    for (const item of items) {
      const file = resolveNote(app, item)
      // A name for a note to be made is fine where the field offers to make one.
      if (!file && field.create) continue
      if (!file) return `"${what}": no note "${item}" in the vault.`
      if (!matchesFilter(app, file, field.filter)) {
        return `"${what}": "${file.path}" is not one of the notes this field offers.`
      }
    }
  }
  return null
}

/**
 * The form's answers as a script receives them: each note picker's value turned into the note,
 * or list of notes, in the shape the field asked for. A name the field was allowed to make a
 * note of is made into one here.
 */
export async function answerPickers(
  app: App,
  fields: FormField[],
  values: Record<string, string>
): Promise<FormAnswers> {
  const answers: FormAnswers = { ...values }
  for (const field of fields.filter(isPicker)) {
    const files: TFile[] = []
    for (const item of pickItems(values[field.name])) {
      const file = resolveNote(app, item)
      if (file) {
        if (!files.includes(file)) files.push(file)
      } else if (field.create) {
        files.push(await createPickedNote(app, item.replace(/^\[\[|\]\]$/g, ''), field.filter))
      }
    }
    const picked = files.map((f) => formatPick(app, f, field.returns))
    answers[field.name] = field.multiple ? picked : (picked[0] ?? '')
  }
  return answers
}

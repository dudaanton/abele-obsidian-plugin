export interface ScriptParam {
  name: string
  type: 'string' | 'number' | 'boolean' | 'text'
  required: boolean
  description: string
  default?: string
  selection?: boolean
}

export interface ScriptMeta {
  name: string
  description: string
  icon?: string
  params: ScriptParam[]
  enabled?: boolean
}

export interface ParsedScript {
  path: string
  meta: ScriptMeta
  code: string
  commandId: string
}

import type { NoteFilter, PickReturns } from '@/helpers/noteFilter'

export interface FormField {
  name: string
  label: string
  /**
   * `markdown` asks for nothing: it is a block of text for the person to read, rendered as
   * markdown and selectable. A form made only of these is a document rather than a question,
   * and the modal shows it as one.
   *
   * `note` is Obsidian's own note editor as a field — links, formatting, the phone's toolbar —
   * and its value is the markdown written in it.
   *
   * `note-picker` searches the vault's notes as the quick switcher does, offering only those
   * `filter` lets through. Its value is the note — or, with `multiple`, a list of them — as a
   * path or, with `returns: 'link'`, a wikilink.
   */
  type?: 'text' | 'textarea' | 'select' | 'boolean' | 'markdown' | 'note' | 'note-picker'
  options?: string[]
  /** A `note-picker` with `multiple` takes a list. */
  default?: string | string[]
  required?: boolean
  /** The markdown to render. `markdown` fields only. */
  text?: string
  /** `note-picker` only: which notes it offers, in the words of `find()`. */
  filter?: NoteFilter
  /** `note-picker` only: several notes rather than one. */
  multiple?: boolean
  /** `note-picker` only: `path` (the default) or `link`. */
  returns?: PickReturns
  /** `note-picker` only: offer to make a note of a name nothing matches. Off unless asked. */
  create?: boolean
  /** `note-picker` only: what the empty search field says. */
  placeholder?: string
}

/** What a form answers: text for every field, a list for a picker that takes several notes. */
export type FormAnswers = Record<string, string | string[]>

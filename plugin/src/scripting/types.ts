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

export interface FormField {
  name: string
  label: string
  /**
   * `markdown` asks for nothing: it is a block of text for the person to read, rendered as
   * markdown and selectable. A form made only of these is a document rather than a question,
   * and the modal shows it as one.
   */
  type?: 'text' | 'textarea' | 'select' | 'boolean' | 'markdown'
  options?: string[]
  default?: string
  required?: boolean
  /** The markdown to render. `markdown` fields only. */
  text?: string
}

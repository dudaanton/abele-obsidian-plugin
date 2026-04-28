export interface ScriptParam {
  name: string
  type: 'string' | 'number' | 'boolean' | 'text'
  required: boolean
  description: string
}

export interface ScriptMeta {
  name: string
  description: string
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
  type?: 'text' | 'textarea' | 'select' | 'boolean'
  options?: string[]
  default?: string
  required?: boolean
}

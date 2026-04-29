import type { ScriptMeta, ScriptParam } from './types'

/**
 * Parse script header comments:
 *   // @name My Script
 *   // @description Does something
 *   // @param path string "Vault path"
 *   // @param style string? "Optional style"
 *
 * Returns null if @name is missing.
 */
export function parseScriptHeader(source: string): ScriptMeta | null {
  const lines = source.split('\n')
  let name = ''
  let description = ''
  let enabled = true
  const params: ScriptParam[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('//')) break // stop at first non-comment line

    const content = trimmed.slice(2).trim()

    if (content.startsWith('@name ')) {
      name = content.slice(6).trim()
    } else if (content.startsWith('@description ')) {
      description = content.slice(13).trim()
    } else if (content.startsWith('@enabled ')) {
      enabled = content.slice(9).trim() !== 'false'
    } else if (content.startsWith('@param ')) {
      const param = parseParam(content.slice(7).trim())
      if (param) params.push(param)
    }
  }

  if (!name) return null

  return { name, description, params, enabled }
}

/**
 * Parse a @param line body: `paramName type[?] "description" [= default]`
 *
 * Default value formats:
 *   // @param style string "CSS style" = "bold"
 *   // @param count number? "How many" = 5
 *   // @param enabled boolean "Feature flag" = true
 */
function parseParam(raw: string): ScriptParam | null {
  const match = raw.match(
    /^(\w+)\s+(string|number|boolean|text)(\?)?\s+"([^"]*)"(?:\s*=\s*(?:"([^"]*)"|(\S+)))?/
  )
  if (!match) return null

  const param: ScriptParam = {
    name: match[1],
    type: match[2] as ScriptParam['type'],
    required: !match[3],
    description: match[4],
  }

  const defaultValue = match[5] ?? match[6]
  if (defaultValue !== undefined) {
    param.default = defaultValue
  }

  return param
}

/**
 * Extract script body (everything after the header comment block).
 */
export function extractScriptBody(source: string): string {
  const lines = source.split('\n')
  let bodyStart = 0

  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim().startsWith('//')) {
      bodyStart = i
      break
    }
  }

  return lines.slice(bodyStart).join('\n').trim()
}

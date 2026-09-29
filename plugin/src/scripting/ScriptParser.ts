import type { ScriptMeta, ScriptParam, StartupDevices } from './types'

/**
 * Parse script header comments:
 *   // @name My Script
 *   // @description Does something
 *   // @param path string "Vault path"
 *   // @param style string? "Optional style"
 *   // @book
 *   // @toolbar
 *   // @startup mobile
 *   // @lint warning
 *   // @interceptor 60
 *
 * Returns null if @name is missing.
 */
export function parseScriptHeader(source: string): ScriptMeta | null {
  const lines = source.split('\n')
  let name = ''
  let description = ''
  let enabled = true
  const params: ScriptParam[] = []

  let icon: string | undefined
  let book = false
  let toolbar = false
  let startup: StartupDevices | undefined
  let lint: 'error' | 'warning' | undefined
  let interceptor: number | undefined

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('//')) break // stop at first non-comment line

    const content = trimmed.slice(2).trim()

    if (content.startsWith('@name ')) {
      name = content.slice(6).trim()
    } else if (content.startsWith('@description ')) {
      description = content.slice(13).trim()
    } else if (content.startsWith('@icon ')) {
      icon = content.slice(6).trim()
    } else if (content.startsWith('@enabled ')) {
      enabled = content.slice(9).trim() !== 'false'
    } else if (content === '@book' || content.startsWith('@book ')) {
      book = true
    } else if (content === '@toolbar' || content.startsWith('@toolbar ')) {
      toolbar = true
    } else if (content === '@startup' || content.startsWith('@startup ')) {
      const word = content.slice(8).trim()
      startup = word === 'desktop' || word === 'mobile' ? word : 'both'
    } else if (content === '@lint' || content.startsWith('@lint ')) {
      lint = content.slice(5).trim() === 'warning' ? 'warning' : 'error'
    } else if (content === '@interceptor' || content.startsWith('@interceptor ')) {
      interceptor = interceptorSeconds(content.slice(12).trim())
    } else if (content.startsWith('@param ')) {
      const param = parseParam(content.slice(7).trim())
      if (param) params.push(param)
    }
  }

  if (!name) return null

  return {
    name,
    description,
    icon,
    params,
    enabled,
    ...(book ? { book } : {}),
    ...(toolbar ? { toolbar } : {}),
    ...(startup ? { startup } : {}),
    ...(lint ? { lint } : {}),
    ...(interceptor ? { interceptor } : {}),
  }
}

/** How long an interceptor script may take, when it does not say. */
export const INTERCEPTOR_DEFAULT_SECONDS = 30
/** The most it may ask for: the person is waiting on the message all that time. */
export const INTERCEPTOR_MAX_SECONDS = 600

/** The seconds after `@interceptor`: a whole number from 1 to the maximum, or the default. */
function interceptorSeconds(word: string): number {
  const n = Number(word)
  if (!word || !Number.isFinite(n) || n <= 0) return INTERCEPTOR_DEFAULT_SECONDS
  return Math.min(INTERCEPTOR_MAX_SECONDS, Math.max(1, Math.round(n)))
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
    /^(\w+)\s+(string|number|boolean|text)(\?)?\s+"([^"]*)"(?:\s*=\s*(?:"([^"]*)"|(\S+)))?(\s+selection)?/
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

  if (match[7]) {
    param.selection = true
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

import dayjs from 'dayjs'
import { DATE_FORMAT } from '@/constants/dates'
import { GlobalStore } from '@/stores/GlobalStore'

/**
 * Represents a parsed variable from template content
 */
export interface TemplateVariable {
  /** Full match including {{ }} */
  raw: string
  /** Variable type */
  type: 'date' | 'user' | 'plugin' | 'list' | 'wiki_list' | 'wikilink' | 'select' | 'image'
  /** Variable name/label */
  name: string
  /** For date: format string */
  format?: string
  /** For date: offset in days */
  offset?: number
  /** For plugin: plugin ID */
  pluginId?: string
  /** For plugin: method name */
  methodName?: string
  /** For select: available options */
  options?: string[]
  /** Default value (for list/wiki_list stored as JSON array string) */
  defaultValue?: string
}

/**
 * Result of parsing template content
 */
export interface ParseResult {
  /** All unique variables found */
  variables: TemplateVariable[]
  /** User input variables (excluding auto-resolved like date) */
  userVariables: TemplateVariable[]
}

// Regex patterns
const VARIABLE_PATTERN = /\{\{\s*([^}]+?)\s*\}\}/g
const DATE_SIMPLE_REGEX = /^date$/
const DATE_FORMAT_REGEX = /^date\.format\(['"]([^'"]+)['"]\)$/
const DATE_OFFSET_REGEX = /^date\.offset\(([-\d]+)\)$/
const DATE_OFFSET_FORMAT_REGEX = /^date\.offset\(([-\d]+)\)\.format\(['"]([^'"]+)['"]\)$/
const PLUGIN_REGEX = /^([^;]+);([^;]+);(.+)$/
const LIST_SUFFIX_REGEX = /^(.+)::(\w+)$/
const SELECT_REGEX = /^(.+)::select\(([^)]+)\)$/

/**
 * Extract ::default(...) suffix from expression.
 * Handles escaped parens \( \) inside the default value.
 */
function extractDefault(expr: string): { expr: string; defaultValue?: string } {
  const marker = '::default('
  const idx = expr.lastIndexOf(marker)
  if (idx === -1 || !expr.endsWith(')')) return { expr }

  const rawDefault = expr.slice(idx + marker.length, -1)
  return { expr: expr.slice(0, idx), defaultValue: rawDefault }
}

/**
 * Split raw default string by unescaped commas, unescape each item.
 * Supports \( \) \, escapes.
 */
function splitDefaultItems(raw: string): string[] {
  const items: string[] = []
  let current = ''
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '\\' && i + 1 < raw.length) {
      current += raw[i + 1]
      i++
    } else if (raw[i] === ',') {
      items.push(current)
      current = ''
    } else {
      current += raw[i]
    }
  }
  if (current) items.push(current)
  return items
}

function unescapeDefault(value: string): string {
  return value.replace(/\\([(),])/g, '$1')
}

/**
 * Parse a single variable expression
 */
function parseVariableExpression(raw: string, expr: string): TemplateVariable {
  const trimmed = expr.trim()

  // Extract ::default(...) suffix before parsing type
  const { expr: mainExpr, defaultValue: rawDefault } = extractDefault(trimmed)
  const variable = parseTypeExpression(raw, mainExpr)

  if (rawDefault !== undefined) {
    variable.defaultValue =
      variable.type === 'list' || variable.type === 'wiki_list'
        ? JSON.stringify(splitDefaultItems(rawDefault))
        : unescapeDefault(rawDefault)
  }

  return variable
}

/**
 * Parse variable type from expression (without ::default suffix)
 */
function parseTypeExpression(raw: string, expr: string): TemplateVariable {
  // Check date patterns
  if (DATE_SIMPLE_REGEX.test(expr)) {
    return { raw, type: 'date', name: 'date', format: DATE_FORMAT }
  }

  const formatMatch = expr.match(DATE_FORMAT_REGEX)
  if (formatMatch) {
    return { raw, type: 'date', name: 'date', format: formatMatch[1] }
  }

  const offsetMatch = expr.match(DATE_OFFSET_REGEX)
  if (offsetMatch) {
    return {
      raw,
      type: 'date',
      name: 'date',
      format: DATE_FORMAT,
      offset: parseInt(offsetMatch[1], 10),
    }
  }

  const offsetFormatMatch = expr.match(DATE_OFFSET_FORMAT_REGEX)
  if (offsetFormatMatch) {
    return {
      raw,
      type: 'date',
      name: 'date',
      format: offsetFormatMatch[2],
      offset: parseInt(offsetFormatMatch[1], 10),
    }
  }

  // Check plugin pattern
  const pluginMatch = expr.match(PLUGIN_REGEX)
  if (pluginMatch) {
    return {
      raw,
      type: 'plugin',
      name: pluginMatch[3], // label
      pluginId: pluginMatch[1],
      methodName: pluginMatch[2],
    }
  }

  // Check select pattern (name::select(opt1,opt2,...))
  const selectMatch = expr.match(SELECT_REGEX)
  if (selectMatch) {
    const name = selectMatch[1].trim()
    const options = selectMatch[2].split(',').map((o) => o.trim())
    return { raw, type: 'select', name, options }
  }

  // Check list suffix (name::list, name::wiki_list, name::wikilink)
  const listMatch = expr.match(LIST_SUFFIX_REGEX)
  if (listMatch) {
    const name = listMatch[1].trim()
    const suffix = listMatch[2]
    if (suffix === 'list') {
      return { raw, type: 'list', name }
    }
    if (suffix === 'wiki_list') {
      return { raw, type: 'wiki_list', name }
    }
    if (suffix === 'wikilink') {
      return { raw, type: 'wikilink', name }
    }
    if (suffix === 'image') {
      return { raw, type: 'image', name }
    }
  }

  // Default: user variable
  return { raw, type: 'user', name: expr }
}

/**
 * Parse template content and extract all variables
 */
export function parseTemplateVariables(content: string): ParseResult {
  const variables: TemplateVariable[] = []
  const seen = new Set<string>()

  const regex = new RegExp(VARIABLE_PATTERN.source, VARIABLE_PATTERN.flags)
  let match: RegExpExecArray | null
  while ((match = regex.exec(content)) !== null) {
    const raw = match[0]
    const expr = match[1]

    // Skip duplicates by raw match
    if (seen.has(raw)) continue
    seen.add(raw)

    variables.push(parseVariableExpression(raw, expr))
  }

  // User variables = those that need user input
  const userVariables = variables.filter(
    (v) =>
      v.type === 'user' ||
      v.type === 'plugin' ||
      v.type === 'list' ||
      v.type === 'wiki_list' ||
      v.type === 'wikilink' ||
      v.type === 'select' ||
      v.type === 'image'
  )

  return { variables, userVariables }
}

/**
 * Resolve a date variable to its string value
 */
function resolveDateVariable(variable: TemplateVariable): string {
  let date = dayjs()

  if (variable.offset) {
    date = date.add(variable.offset, 'day')
  }

  return date.format(variable.format || DATE_FORMAT)
}

/**
 * Resolve a plugin variable by calling the plugin method
 */
async function resolvePluginVariable(
  variable: TemplateVariable,
  userInput: string
): Promise<string> {
  const { app } = GlobalStore.getInstance()

  if (!variable.pluginId || !variable.methodName) {
    console.warn('Invalid plugin variable:', variable)
    return userInput
  }

  const plugins = (app as any).plugins?.plugins
  if (!plugins) {
    console.warn('Plugins not available')
    return userInput
  }

  const plugin = plugins[variable.pluginId]
  if (!plugin) {
    console.warn(`Plugin not found: ${variable.pluginId}`)
    return userInput
  }

  const method = plugin[variable.methodName]
  if (typeof method !== 'function') {
    console.warn(`Method not found: ${variable.pluginId}.${variable.methodName}`)
    return userInput
  }

  try {
    const result = await method.call(plugin, userInput)
    return typeof result === 'string' ? result : String(result)
  } catch (error) {
    console.error(`Error calling plugin method:`, error)
    return userInput
  }
}

/**
 * Format a path as a quoted wikilink: "[[path/to/file|file]]"
 * Strips .md extension, uses filename as alias.
 */
function formatWikilink(path: string): string {
  const clean = path.replace(/\.md$/, '')
  const name = clean.split('/').pop() || clean
  return `"[[${clean}|${name}]]"`
}

/**
 * Format a list value for YAML output.
 * Value is stored as JSON array string in the Map.
 */
function formatListValue(jsonValue: string, isWikiList: boolean): string {
  try {
    const items: string[] = JSON.parse(jsonValue)
    if (!Array.isArray(items) || items.length === 0) return ''
    const formatted = isWikiList
      ? items.map((item) => `\n  - ${formatWikilink(item)}`)
      : items.map((item) => `\n  - ${item}`)
    return formatted.join('')
  } catch {
    return jsonValue
  }
}

/**
 * Apply variable values to template content
 * @param content Template content with {{ variables }}
 * @param variables Parsed variables from parseTemplateVariables
 * @param userValues Map of variable name to user-provided value
 */
export async function applyTemplateVariables(
  content: string,
  variables: TemplateVariable[],
  userValues: Map<string, string>
): Promise<string> {
  let result = content

  for (const variable of variables) {
    let value: string

    switch (variable.type) {
      case 'date':
        value = resolveDateVariable(variable)
        break

      case 'plugin':
        const input = userValues.get(variable.name) || ''
        value = await resolvePluginVariable(variable, input)
        break

      case 'list':
        value = formatListValue(userValues.get(variable.name) || '[]', false)
        break

      case 'wiki_list':
        value = formatListValue(userValues.get(variable.name) || '[]', true)
        break

      case 'wikilink': {
        const link = userValues.get(variable.name) || ''
        value = link ? formatWikilink(link) : ''
        break
      }

      case 'select':
      case 'image':
        value = userValues.get(variable.name) || ''
        break

      case 'user':
      default:
        value = userValues.get(variable.name) || ''
        break
    }

    // For list/wiki_list: strip surrounding quotes so YAML array isn't wrapped in a string
    if ((variable.type === 'list' || variable.type === 'wiki_list') && value.includes('\n')) {
      result = result.split(`"${variable.raw}"`).join(value)
      result = result.split(`'${variable.raw}'`).join(value)
    }
    result = result.split(variable.raw).join(value)
  }

  return result
}

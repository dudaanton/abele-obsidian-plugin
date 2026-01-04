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
  type: 'date' | 'user' | 'plugin'
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
const VARIABLE_REGEX = /\{\{\s*([^}]+?)\s*\}\}/g
const DATE_SIMPLE_REGEX = /^date$/
const DATE_FORMAT_REGEX = /^date\.format\(['"]([^'"]+)['"]\)$/
const DATE_OFFSET_REGEX = /^date\.offset\(([-\d]+)\)$/
const DATE_OFFSET_FORMAT_REGEX = /^date\.offset\(([-\d]+)\)\.format\(['"]([^'"]+)['"]\)$/
const PLUGIN_REGEX = /^([^;]+);([^;]+);(.+)$/

/**
 * Parse a single variable expression
 */
function parseVariableExpression(raw: string, expr: string): TemplateVariable {
  const trimmed = expr.trim()

  // Check date patterns
  if (DATE_SIMPLE_REGEX.test(trimmed)) {
    return { raw, type: 'date', name: 'date', format: DATE_FORMAT }
  }

  const formatMatch = trimmed.match(DATE_FORMAT_REGEX)
  if (formatMatch) {
    return { raw, type: 'date', name: 'date', format: formatMatch[1] }
  }

  const offsetMatch = trimmed.match(DATE_OFFSET_REGEX)
  if (offsetMatch) {
    return {
      raw,
      type: 'date',
      name: 'date',
      format: DATE_FORMAT,
      offset: parseInt(offsetMatch[1], 10),
    }
  }

  const offsetFormatMatch = trimmed.match(DATE_OFFSET_FORMAT_REGEX)
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
  const pluginMatch = trimmed.match(PLUGIN_REGEX)
  if (pluginMatch) {
    return {
      raw,
      type: 'plugin',
      name: pluginMatch[3], // label
      pluginId: pluginMatch[1],
      methodName: pluginMatch[2],
    }
  }

  // Default: user variable
  return { raw, type: 'user', name: trimmed }
}

/**
 * Parse template content and extract all variables
 */
export function parseTemplateVariables(content: string): ParseResult {
  const variables: TemplateVariable[] = []
  const seen = new Set<string>()

  let match: RegExpExecArray | null
  while ((match = VARIABLE_REGEX.exec(content)) !== null) {
    const raw = match[0]
    const expr = match[1]

    // Skip duplicates by raw match
    if (seen.has(raw)) continue
    seen.add(raw)

    variables.push(parseVariableExpression(raw, expr))
  }

  // User variables = those that need user input (user + plugin types)
  const userVariables = variables.filter((v) => v.type === 'user' || v.type === 'plugin')

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

      case 'user':
      default:
        value = userValues.get(variable.name) || ''
        break
    }

    // Replace all occurrences of this exact variable
    result = result.split(variable.raw).join(value)
  }

  return result
}

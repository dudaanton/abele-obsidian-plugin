/**
 * The rules the MCP settings screen works by, kept apart from it so they can be tested alone.
 */
import type { AiSettings, ToolMode } from '@/ai/types'
import { MCP_PREFIX, mcpServerSlug } from './names'
import type { McpServer } from './types'
import { keychainId } from '@/secrets/keychainId'

/** The keychain slot a server's token is kept in. */
export const mcpKeyId = (serverId: string): string => keychainId('abele-mcp', serverId)

/** `Name: value` lines into headers. A line without a name is not a header and is dropped. */
export function parseHeaders(text: string): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const colon = line.indexOf(':')
    if (colon <= 0) continue
    const name = line.slice(0, colon).trim()
    if (!name) continue
    headers[name] = line.slice(colon + 1).trim()
  }
  return headers
}

export const formatHeaders = (headers: Record<string, string> | undefined): string =>
  Object.entries(headers ?? {})
    .map(([name, value]) => `${name}: ${value}`)
    .join('\n')

/** Whether another server would give its tools the same names as one called `name`. */
export function nameClash(servers: McpServer[], name: string, exceptId: string): boolean {
  const slug = mcpServerSlug(name)
  return servers.some((s) => s.id !== exceptId && mcpServerSlug(s.name || s.id) === slug)
}

function moveModes(
  modes: Record<string, ToolMode> | undefined,
  from: string,
  to: string
): Record<string, ToolMode> | undefined {
  if (!modes) return modes
  let changed = false
  const next: Record<string, ToolMode> = {}
  for (const [name, mode] of Object.entries(modes)) {
    if (name.startsWith(from)) {
      next[to + name.slice(from.length)] = mode
      changed = true
    } else next[name] = mode
  }
  return changed ? next : modes
}

/**
 * A server's name is part of its tools' names, so renaming it would leave every agent's
 * choices about those tools behind under the old names. They are moved along instead.
 */
export function renameServerTools(ai: AiSettings, oldName: string, newName: string): AiSettings {
  const from = `${MCP_PREFIX}${mcpServerSlug(oldName)}_`
  const to = `${MCP_PREFIX}${mcpServerSlug(newName)}_`
  if (from === to) return ai
  return {
    ...ai,
    toolModes: moveModes(ai.toolModes, from, to) ?? ai.toolModes,
    agents: ai.agents.map((agent) => {
      const toolModes = moveModes(agent.toolModes, from, to)
      return toolModes === agent.toolModes ? agent : { ...agent, toolModes: toolModes ?? {} }
    }),
  }
}

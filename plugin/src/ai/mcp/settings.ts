/**
 * The rules the MCP settings screen works by, kept apart from it so they can be tested alone.
 */
import { Notice } from 'obsidian'
import { mcpServerSlug } from './names'
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

/** The adapter reports all reset choices together, rather than one notice per agent. */
export function notifyMcpPermissionReset(reset: string[]): void {
  if (!reset.length) return
  new Notice(
    'Some saved MCP permissions could not be matched safely. Matched tools now ask before running. ' +
      'Set these permissions again in agent Access settings:\n' +
      reset.join('\n'),
    0
  )
}

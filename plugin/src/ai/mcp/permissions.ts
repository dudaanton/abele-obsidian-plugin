/** Permissions use the full server identity and real tool name, never a provider alias. */
import type { ToolMode, AiSettings } from '../types'
import type { McpServer } from './types'
import { mcpToolName, isMcpToolName } from './names'

export const mcpPermissionKey = (serverId: string, toolName: string): string =>
  `mcp:${JSON.stringify([serverId, toolName])}`

/** Allocate unique provider aliases, reserving ordinary names before adding collision suffixes. */
export function mcpToolBindings(servers: McpServer[] = []) {
  const pairs = new Map<
    string,
    { server: McpServer; snapshot: McpServer['tools'][number]; base: string }
  >()
  for (const server of servers) {
    for (const snapshot of server.tools ?? []) {
      const key = mcpPermissionKey(server.id, snapshot.name)
      if (!pairs.has(key))
        pairs.set(key, {
          server,
          snapshot,
          base: mcpToolName(server.name || server.id, snapshot.name),
        })
    }
  }
  const reserved = new Set([...pairs.values()].map((p) => p.base))
  const taken = new Set<string>()
  return [...pairs.entries()].map(([permissionKey, pair]) => {
    let name = pair.base
    let n = 2
    if (taken.has(name)) {
      do {
        const suffix = `_${n++}`
        name = pair.base.slice(0, 64 - suffix.length) + suffix
      } while (reserved.has(name) || taken.has(name))
    }
    taken.add(name)
    return { ...pair, name, permissionKey }
  })
}

/** Unknown MCP aliases never fall back to a legacy permission, even if one remains in a chat. */
export function toolPermissionKey(name: string, servers: McpServer[] = []): string {
  if (!isMcpToolName(name)) return name
  return (
    mcpToolBindings(servers).find((p) => p.name === name)?.permissionKey ??
    mcpPermissionKey('', name)
  )
}

export function migrateMcpModes(modes: Record<string, ToolMode>, servers: McpServer[] = []) {
  const bindings = mcpToolBindings(servers)
  const next = { ...modes }
  const reset = new Set<string>()
  let changed = false
  for (const [name, mode] of Object.entries(modes)) {
    if (!isMcpToolName(name)) continue
    changed = true
    delete next[name]
    const matches = bindings.filter((p) => p.base === name)
    for (const match of matches) {
      if (!(match.permissionKey in next))
        next[match.permissionKey] = matches.length === 1 ? mode : 'ask'
      if (matches.length !== 1)
        reset.add(`${match.server.name || match.server.id} / ${match.snapshot.name}`)
    }
    if (!matches.length) reset.add(name)
  }
  return { modes: changed ? next : modes, changed, reset: [...reset] }
}

/** Fold defaults and every agent together so the adapter can show one migration notice. */
export function migrateMcpPermissions(ai: AiSettings) {
  const reset = new Set<string>()
  let changed = false
  const migrate = (modes: Record<string, ToolMode>) => {
    const result = migrateMcpModes(modes, ai.mcpServers)
    changed ||= result.changed
    for (const item of result.reset) reset.add(item)
    return result.modes
  }
  const toolModes = migrate(ai.toolModes)
  const agents = ai.agents.map((agent) => {
    const toolModes = migrate(agent.toolModes)
    return toolModes === agent.toolModes ? agent : { ...agent, toolModes }
  })
  return { ai: changed ? { ...ai, toolModes, agents } : ai, changed, reset: [...reset] }
}

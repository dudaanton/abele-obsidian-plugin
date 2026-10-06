/** Permissions use the full server identity and real tool name, never a provider alias. */
import type { ToolMode, AiSettings } from '../types'
import type { McpServer, McpLegacyToolMap } from './types'
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

/** Capture once, before labels or tool lists can change, even if no mode needs migration yet. */
export function mcpLegacyToolMap(servers: McpServer[] = []): McpLegacyToolMap {
  const map: McpLegacyToolMap = {}
  for (const { base, server, snapshot } of mcpToolBindings(servers)) {
    ;(map[base] ??= []).push({
      serverId: server.id,
      serverName: server.name || server.id,
      toolName: snapshot.name,
    })
  }
  return map
}

export const unresolvedMcpPermissionKey = (alias: string): string =>
  `mcp:unresolved:${JSON.stringify(alias)}`

export function migrateMcpModes(
  modes: Record<string, ToolMode>,
  servers: McpServer[] = [],
  legacyMap: McpLegacyToolMap = mcpLegacyToolMap(servers)
) {
  const current = new Set(mcpToolBindings(servers).map((binding) => binding.permissionKey))
  const next = { ...modes }
  const reset = new Set<string>()
  let changed = false
  for (const [name, mode] of Object.entries(modes)) {
    if (!isMcpToolName(name)) continue
    changed = true
    delete next[name]
    const matches = legacyMap[name] ?? []
    for (const match of matches) {
      const key = mcpPermissionKey(match.serverId, match.toolName)
      const resolved = matches.length === 1 && current.has(key)
      if (!(key in next)) next[key] = resolved ? mode : 'ask'
      if (!resolved) reset.add(`${match.serverName} / ${match.toolName}`)
    }
    if (!matches.length) {
      next[unresolvedMcpPermissionKey(name)] = 'ask'
      reset.add(name)
    }
  }
  return { modes: changed ? next : modes, changed, reset: [...reset] }
}

/** A pending alias may not select a different tool, even if the replacement is enabled. */
export function pendingMcpToolRefusal(
  call: { name: string; permissionKey?: string },
  servers: McpServer[] = []
): string | null {
  if (!isMcpToolName(call.name)) return null
  const binding = mcpToolBindings(servers).find((item) => item.name === call.name)
  return call.permissionKey &&
    binding?.permissionKey === call.permissionKey &&
    binding.server.enabled &&
    binding.server.url
    ? null
    : 'The MCP tool changed or no longer exists. Ask for a new tool call.'
}

/** Fold defaults and every agent together so the adapter can show one migration notice. */
export function migrateMcpPermissions(ai: AiSettings) {
  const reset = new Set<string>()
  const legacyMap = ai.mcpLegacyToolMap ?? mcpLegacyToolMap(ai.mcpServers)
  let changed = ai.mcpLegacyToolMap === undefined
  const migrate = (modes: Record<string, ToolMode>) => {
    const result = migrateMcpModes(modes, ai.mcpServers, legacyMap)
    changed ||= result.changed
    for (const item of result.reset) reset.add(item)
    return result.modes
  }
  const toolModes = migrate(ai.toolModes)
  const agents = ai.agents.map((agent) => {
    const toolModes = migrate(agent.toolModes)
    return toolModes === agent.toolModes ? agent : { ...agent, toolModes }
  })
  return {
    ai: changed ? { ...ai, toolModes, agents, mcpLegacyToolMap: legacyMap } : ai,
    changed,
    reset: [...reset],
  }
}

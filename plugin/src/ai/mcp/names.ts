/**
 * What an MCP tool is called when an agent is handed it: `mcp_<server>_<tool>`.
 *
 * Providers accept `[a-zA-Z0-9_-]` and at most 64 characters in a tool name, and a server may
 * call its tools anything. The server part is lower-cased so a name typed as "GitHub" or
 * "github" gives the same tools — the name is also what an agent's tool modes are kept under.
 */
const LIMIT = 64
export const MCP_PREFIX = 'mcp_'

const clean = (text: string): string =>
  text.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'x'

/** Short and stable: the same long name always cuts to the same thing. */
function hash(text: string): string {
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0
  return h.toString(36).padStart(6, '0').slice(-6)
}

export function mcpServerSlug(server: string): string {
  return clean(server).toLowerCase()
}

export function mcpToolName(server: string, tool: string): string {
  const full = `${MCP_PREFIX}${mcpServerSlug(server)}_${clean(tool)}`
  if (full.length <= LIMIT) return full
  const suffix = `_${hash(`${server}\u0000${tool}`)}`
  return full.slice(0, LIMIT - suffix.length) + suffix
}

export const isMcpToolName = (name: string): boolean => name.startsWith(MCP_PREFIX)

/**
 * An MCP server the person connected, as the settings keep it.
 *
 * Only servers reached over HTTP: nothing here is ever started on the machine, so there is no
 * command to keep, to protect or to leave behind when the settings travel.
 */
export interface McpServer {
  id: string
  /** What the person calls it, and the middle of every tool name: `mcp_<name>_<tool>`. */
  name: string
  /** The server's MCP endpoint, e.g. `https://example.com/mcp`. */
  url: string
  /** Off keeps it configured but hands none of its tools to any agent. */
  enabled: boolean
  /** Keychain id of a token sent as `Authorization: Bearer`. Empty for none. */
  keyId: string
  /**
   * Further headers, sent as written. A value may name a stored key as `${abele_key:name}`,
   * which is how a secret other than a bearer token stays out of the settings file.
   */
  headers: Record<string, string>
  /**
   * The tools as they were when the person last fetched them. This is what agents are told —
   * a server that changes its descriptions afterwards changes nothing until it is fetched again.
   */
  tools: McpToolSnapshot[]
  /** ISO time of that fetch; absent until the first one. */
  fetchedAt?: string
}

export interface McpToolSnapshot {
  name: string
  title?: string
  description: string
  inputSchema: Record<string, unknown>
}

/** One piece of what a tool call returned. Unknown kinds are kept whole and described. */
export type McpContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }
  | { type: 'audio'; data: string; mimeType: string }
  | { type: 'resource_link'; uri: string; name?: string; description?: string }
  | { type: 'resource'; resource: { uri: string; text?: string; blob?: string; mimeType?: string } }
  | { type: string; [key: string]: unknown }

export interface McpCallResult {
  content: McpContent[]
  structuredContent?: unknown
  isError?: boolean
}

export function createMcpServer(overrides: Partial<McpServer> = {}): McpServer {
  return {
    id: '',
    name: '',
    url: '',
    enabled: true,
    keyId: '',
    headers: {},
    tools: [],
    ...overrides,
  }
}

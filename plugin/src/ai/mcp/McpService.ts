/**
 * The plugin's connections to MCP servers: one client per server, kept while its address and
 * credentials stay the same, so a legacy server's session is reused from call to call.
 */
import { secrets } from '@/secrets/SecretStore'
import { substituteSecrets } from '@/ai/tools/secretUtils'
import { McpClient, type McpRequest } from './McpClient'
import type { McpCallResult, McpServer, McpToolSnapshot } from './types'

export class McpService {
  private static instance: McpService | null = null

  static getInstance(): McpService {
    if (!McpService.instance) McpService.instance = new McpService()
    return McpService.instance
  }

  private clients = new Map<string, { key: string; client: McpClient }>()
  /** Left unset in the plugin, where `requestUrl` is the one to use. */
  request: McpRequest | undefined

  /** Forgets every connection. */
  reset(): void {
    this.clients.clear()
  }

  /** The headers sent to this server, secrets filled in. Never logged, never stored. */
  headersFor(server: McpServer, token?: string): Record<string, string> {
    const headers: Record<string, string> = {}
    for (const [name, value] of Object.entries(server.headers ?? {})) {
      if (name.trim()) headers[name.trim()] = substituteSecrets(value)
    }
    const bearer = token ?? (server.keyId ? secrets().get(server.keyId) : '')
    if (bearer) headers.Authorization = `Bearer ${bearer}`
    return headers
  }

  private client(server: McpServer): McpClient {
    const headers = this.headersFor(server)
    const key = JSON.stringify([server.url, headers])
    const known = this.clients.get(server.id)
    if (known && known.key === key) return known.client
    const client = new McpClient({
      url: server.url,
      headers,
      request: this.request,
      tools: server.tools,
    })
    this.clients.set(server.id, { key, client })
    return client
  }

  /**
   * The server's tools as it describes them now. A fresh connection, so a server that changed
   * shape since — upgraded, or moved to another version of the protocol — is asked from scratch.
   */
  async fetchTools(
    server: McpServer,
    options: { signal?: AbortSignal; token?: string } = {}
  ): Promise<McpToolSnapshot[]> {
    this.clients.delete(server.id)
    // A token typed into the dialog and not saved yet is tried on a client of its own.
    if (options.token !== undefined) {
      return new McpClient({
        url: server.url,
        headers: this.headersFor(server, options.token),
        request: this.request,
      }).listTools(options.signal)
    }
    return this.client(server).listTools(options.signal)
  }

  callTool(
    server: McpServer,
    tool: string,
    args: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<McpCallResult> {
    return this.client(server).callTool(tool, args, signal)
  }
}

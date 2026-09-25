/**
 * The MCP test server as a process of its own, for the e2e tier: the test worker blocks its
 * event loop on every `obsidian eval`, so a server inside it could never answer the app.
 *
 * `node mcpServerMain.mjs <modern|legacy> [sse]` prints `listening <url>`, then one line per
 * request: `REQ <json>` with the JSON-RPC method and the headers that matter.
 */
import { startMcpTestServer, type McpServerMode } from '../../helpers/mcpTestServer'

const mode = (process.argv[2] ?? 'modern') as McpServerMode
const sse = process.argv[3] === 'sse'

void startMcpTestServer({ mode, sse }).then((server) => {
  let seen = 0
  setInterval(() => {
    for (const request of server.requests.slice(seen)) {
      const line = {
        method: request.body?.method ?? null,
        origin: request.headers.origin ?? null,
        userAgent: request.headers['user-agent'] ?? null,
        session: request.headers['mcp-session-id'] ?? null,
      }
      process.stdout.write(`REQ ${JSON.stringify(line)}\n`)
    }
    seen = server.requests.length
  }, 50)
  process.stdout.write(`listening ${server.url}\n`)
})

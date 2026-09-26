import { createApp } from 'vue'
import McpServerModal from '@/components/settings/ai/McpServerModal.vue'
import { createMcpServer } from '@/ai/mcp/types'

/**
 * Opens the MCP server dialog on its own, for the layout probes, as Add MCP server shows it
 * with the URL typed in. In the plugin it opens from Settings → AI Agent → MCP, which on a
 * desktop is a window of its own; the dialog is the same either way. Nothing it saves is kept:
 * closing it, Save included, only takes it down again.
 */
export function openMcpServer(url = 'https://mcp.example.com/mcp'): void {
  const host = document.body.createDiv()
  let open = true
  const close = () => {
    if (!open) return
    open = false
    app.unmount()
    host.remove()
  }
  const server = createMcpServer({ id: 'probe', name: 'probe', url })
  const app = createApp(McpServerModal, { server, servers: [], isNew: true, onClose: close })
  app.mount(host)
}

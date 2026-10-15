import McpServerModal from '@/components/settings/ai/McpServerModal.vue'
import { mountKit } from '@/components/obsidian/mount'
import { createMcpServer } from '@/ai/mcp/types'

/**
 * Opens the MCP server dialog on its own, for the layout probes, as Add MCP server shows it
 * with the URL typed in. In the plugin it opens from Settings → AI Agent → MCP, which on a
 * desktop is a window of its own; the dialog is the same either way. Nothing it saves is kept:
 * closing it, Save included, only takes it down again.
 */
export function openMcpServer(url = 'https://mcp.example.com/mcp'): void {
  const close = () => app.unmount()
  const server = createMcpServer({ id: 'probe', name: 'probe', url })
  const app = mountKit(
    document.body.createDiv(),
    McpServerModal,
    { server, servers: [], isNew: true, onClose: close },
    { remove: true }
  )
}

import { GlobalStore } from '@/stores/GlobalStore'
import { ref } from 'vue'
import { NODE_ACTION_PARENTS, NODE_ACTION_TOOLS, type ToolMode } from './types'
export { NODE_ACTION_TOOLS } from './types'
import type { ChatSession } from './ChatSession'

const revision = ref(0)
const key = (chat: string, agent: string) =>
  `abele.node-action-modes:${JSON.stringify([chat, agent])}`
/** Chat files and folder permissions cannot grant execution on another installation. */
export function localNodeActionModes(chat: string, agent: string): Record<string, ToolMode> {
  void revision.value
  try {
    const saved = GlobalStore.getInstance().app.loadLocalStorage(key(chat, agent)) ?? {}
    return Object.fromEntries(
      NODE_ACTION_TOOLS.filter((name) => ['off', 'ask', 'auto'].includes(saved[name])).map(
        (name) => [name, saved[name]]
      )
    )
  } catch {
    return {}
  }
}
export function saveLocalNodeActionModes(
  chat: string,
  agent: string,
  modes: Record<string, ToolMode>
): void {
  GlobalStore.getInstance().app.saveLocalStorage(
    key(chat, agent),
    Object.fromEntries(
      NODE_ACTION_TOOLS.filter((name) => modes[name] !== undefined).map((name) => [
        name,
        modes[name],
      ])
    )
  )
  revision.value++
}
export function nodeActionModes(
  base: Record<string, ToolMode>,
  local: Record<string, ToolMode>,
  agent: Record<string, ToolMode>
): Record<string, ToolMode> {
  const modes = { ...base }
  for (const name of NODE_ACTION_TOOLS) {
    delete modes[name]
    const mode = local[name] ?? agent[name]
    if (local[name] !== undefined || mode === 'ask' || mode === 'auto') modes[name] = mode
    else if (base[name] === 'off') modes[name] = 'off'
  }
  // Listing, status and cancel need no prompt while the parent is enabled.
  // Sending new instructions must retain the parent's approval requirement.
  for (const [name, parent] of Object.entries(NODE_ACTION_PARENTS)) {
    delete modes[name]
    if (name === 'node_delegation_send' && modes[parent] !== undefined) modes[name] = modes[parent]
    else if (modes[parent] === 'ask' || modes[parent] === 'auto') modes[name] = 'auto'
  }
  return modes
}
export function requireNodeActionPermission(
  chat: ChatSession,
  name: string,
  approved = false
): void {
  const mode = chat.getToolMode(name)
  if (mode !== 'ask' && mode !== 'auto')
    throw new Error('Node tool is off in this device’s tool permissions')
  if (
    mode === 'ask' &&
    ![
      'node_delegations',
      'node_delegation_status',
      'node_command_status',
      'node_command_run',
    ].includes(name) &&
    !approved
  )
    throw new Error('Node tool requires approval')
}

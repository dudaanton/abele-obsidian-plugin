import type { GithubConnection } from './connections'
import { GITHUB_TOOLS } from '@/ai/types'

export type ConnectionMode = 'off' | 'ask' | 'auto'
export interface ConnectionAgent {
  id?: string
  githubConnections?: Record<string, ConnectionMode>
}
/** Same fallback as AgentRegistry.filterTools for a newly encountered feature tool. */
export const DEFAULT_CONNECTION_MODE: ConnectionMode = 'off'
export function connectionMode(
  agent: ConnectionAgent | null | undefined,
  id: string
): ConnectionMode {
  if (!agent) return 'off'
  const mode = agent.githubConnections?.[id]
  return mode === 'auto' || mode === 'ask' ? mode : DEFAULT_CONNECTION_MODE
}
/** Preserve the pre-connection credential only for saved agents with no permission map.
 * An explicit map (including an empty one) is already a permission decision. New agents
 * start with an empty map, so this also repairs upgrades that already migrated the token
 * without silently granting later agents or newly added connections access.
 */
export function migrateLegacyConnectionAccess(
  agents: (ConnectionAgent & { toolModes: Record<string, ConnectionMode> })[],
  connections: GithubConnection[]
): boolean {
  const legacy = connections.find((c) => c.id === 'github-legacy')
  let changed = false
  for (const agent of agents) {
    if (agent.githubConnections !== undefined) continue
    const modes = GITHUB_TOOLS.map((name) => agent.toolModes[name])
    const mode = modes.includes('auto') ? 'auto' : modes.includes('ask') ? 'ask' : 'off'
    agent.githubConnections = legacy && mode !== 'off' ? { [legacy.id]: mode } : {}
    changed = true
  }
  return changed
}

export type ConnectionApproval = (
  connection: Pick<GithubConnection, 'id' | 'name' | 'server' | 'account'>,
  signal?: AbortSignal
) => Promise<boolean>

export async function authorizeConnection(
  agent: () => ConnectionAgent | null | undefined,
  connection: GithubConnection,
  approve?: ConnectionApproval,
  signal?: AbortSignal
): Promise<void> {
  const original = agent()
  const mode = connectionMode(original, connection.id)
  if (mode === 'off')
    throw new Error(`Access to GitHub connection "${connection.name}" is disabled for this agent.`)
  if (mode === 'ask') {
    if (!approve)
      throw new Error(
        `GitHub connection "${connection.name}" requires approval; this run cannot ask.`
      )
    if (
      !(await approve(
        {
          id: connection.id,
          name: connection.name,
          server: connection.server,
          account: connection.account,
        },
        signal
      ))
    ) {
      throw new Error(`Access to GitHub connection "${connection.name}" was not approved.`)
    }
  }
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
  if (agent()?.id !== original?.id || connectionMode(agent(), connection.id) === 'off') {
    throw new Error('GitHub connection access changed while awaiting approval.')
  }
}

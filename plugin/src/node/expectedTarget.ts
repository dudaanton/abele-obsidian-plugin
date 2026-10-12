import { ChannelError } from '@abele/channel-protocol'
import type { NodeClient } from '@abele/node-client'
import type { ExpectedExecutionTarget } from '@abele/node-protocol'

export const chatMovedNotice =
  'The chat moved. Nothing was sent. Review the current target before sending again.'

/** Move to an explicit capability flag once the node advertises one. */
export function supportsExpectedTarget(description: unknown): boolean {
  const version =
    description && typeof description === 'object'
      ? (description as { version?: unknown }).version
      : undefined
  if (typeof version !== 'string') return false
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\+[\w.-]+)?$/.exec(version)
  if (!match) return false
  const [major, minor, patch] = match.slice(1, 4).map(Number)
  if (![major, minor, patch].every(Number.isSafeInteger)) return false
  return major > 0 || minor > 4 || (minor === 4 && patch >= 2)
}

export type ChatBinding = Awaited<ReturnType<NodeClient['nodePath']['sessionWorktreeGet']>>
export function expectedBinding(
  binding: ChatBinding | null | undefined
): ExpectedExecutionTarget | undefined {
  return binding?.incarnation
    ? { target: { ...binding.target }, incarnation: binding.incarnation }
    : undefined
}

export async function readChatBinding(
  client: NodeClient,
  sessionId: string
): Promise<ChatBinding | null> {
  try {
    return await client.nodePath.sessionWorktreeGet({
      session_id: sessionId,
      include_incarnation: true,
    })
  } catch (error) {
    if (error instanceof ChannelError && error.code === 'workspace_required') return null
    throw error
  }
}

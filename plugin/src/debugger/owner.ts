import type { NodeChatPresenter } from '@/node/NodeChatPresenter'
import type { NodeConnection } from '@/node/NodeService'
import type { PathTarget } from '@/node/NodePathModel'
import { wirePathTarget } from '@/node/nodePathChat'
import { readChatBinding } from '@/node/expectedTarget'
import { sha256 } from '@noble/hashes/sha2'
import { bytesToHex } from '@noble/hashes/utils'

export interface FolderDebugOwner {
  kind: 'folder-debug'
  target: PathTarget
  connection: NodeConnection
}
export type DebugOwner = NodeChatPresenter | FolderDebugOwner
export const isFolderOwner = (owner: DebugOwner): owner is FolderDebugOwner =>
  'kind' in owner && owner.kind === 'folder-debug'

/** UI lookup identity only; folder keys are never sent as conversation IDs. */
export function debugIdentity(owner: DebugOwner, sessionId?: string) {
  return isFolderOwner(owner)
    ? {
        registrationId: owner.target.registrationId,
        key: `folder:${bytesToHex(sha256(new TextEncoder().encode(JSON.stringify([owner.target.kind, owner.target.id, ...(sessionId ? [sessionId] : [])]))))}`,
      }
    : {
        registrationId: owner.reference.registrationId,
        key: sessionId
          ? `chat-debug:${bytesToHex(sha256(new TextEncoder().encode(JSON.stringify([owner.reference.sessionId, sessionId]))))}`
          : owner.reference.sessionId,
      }
}
export function debugOwnerParams(owner: DebugOwner) {
  return isFolderOwner(owner)
    ? { folder: wirePathTarget(owner.target) }
    : { conversation_id: owner.reference.sessionId }
}
export async function debugTarget(owner: DebugOwner): Promise<PathTarget | undefined> {
  if (isFolderOwner(owner)) return { ...owner.target }
  const binding = await readChatBinding(owner.connection.client, owner.reference.sessionId)
  if (!binding) return undefined
  const target = binding.target
  return {
    nodeId: owner.reference.nodeId,
    registrationId: owner.reference.registrationId,
    projectId: binding.project_id,
    kind: target.kind,
    id: target.kind === 'worktree' ? target.worktree_id : target.workspace_id,
    ...(binding.incarnation ? { incarnation: binding.incarnation } : {}),
  }
}

import { z } from 'zod'
import type { SessionOverrides } from './agents/types'

const id = z.string().min(1).max(128)
// Chat configuration, not an RPC or a daemon authorization grant.
export const NodeChatTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('workspace'), workspace_id: id }).strict(),
  z.object({ kind: z.literal('worktree'), worktree_id: id }).strict(),
])
const common = { node_id: id, access: z.enum(['read', 'edit']) }
export const NodeScopeEntrySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('node'), ...common }).strict(),
  z.object({ kind: z.literal('project'), ...common, project_id: id }).strict(),
  z
    .object({ kind: z.literal('target'), ...common, project_id: id, target: NodeChatTargetSchema })
    .strict(),
])
export type NodeScopeEntry = z.infer<typeof NodeScopeEntrySchema>
export type NodeChatTarget = z.infer<typeof NodeChatTargetSchema>
export interface NodeScopeTarget {
  node_id: string
  project_id: string
  target: NodeChatTarget
}
export interface NodeScopeChat {
  readonly nodeScopeIdentity: string | undefined
  readonly overrides: { value: SessionOverrides }
  readonly conversationVersion: { value: number }
  readonly branchSelectionVersion?: number
}
export function nodeScopeEntries(chat: NodeScopeChat): NodeScopeEntry[] {
  return z.array(NodeScopeEntrySchema).parse(chat.overrides.value.nodeScope ?? [])
}
export function nodeTargetId(target: NodeChatTarget): string {
  return target.kind === 'worktree' ? target.worktree_id : target.workspace_id
}
export function nodeScopeKey(entry: NodeScopeEntry): string {
  return JSON.stringify([
    entry.kind,
    entry.node_id,
    'project_id' in entry ? entry.project_id : null,
    entry.kind === 'target' ? [entry.target.kind, nodeTargetId(entry.target)] : null,
    entry.access,
  ])
}
function normalized(chat: NodeScopeChat): string {
  return JSON.stringify([...new Set(nodeScopeEntries(chat).map(nodeScopeKey))].sort())
}
export function coversNodeScope(
  entry: NodeScopeEntry,
  target: NodeScopeTarget,
  access: 'read' | 'edit'
): boolean {
  return (
    entry.node_id === target.node_id &&
    (access === 'read' || entry.access === 'edit') &&
    (entry.kind === 'node' || entry.project_id === target.project_id) &&
    (entry.kind !== 'target' ||
      (entry.target.kind === target.target.kind &&
        nodeTargetId(entry.target) === nodeTargetId(target.target)))
  )
}
const ApprovalSchema = z
  .object({ scope: z.string(), principals: z.record(z.string()), nonce: z.string() })
  .strict()
type Approval = z.infer<typeof ApprovalSchema>
export interface NodeScopeStorage {
  read(): unknown
  write(value: unknown): void
}

/** Owner UI ledger. Synced configuration and generic tool approval cannot populate it. */
export class NodeScopeLedger {
  private approvals: Record<string, Approval>
  constructor(private readonly storage?: NodeScopeStorage) {
    const loaded = z.record(ApprovalSchema).safeParse(storage?.read() ?? {})
    this.approvals = loaded.success ? loaded.data : {}
  }
  approve(chat: NodeScopeChat, principals: Record<string, string>): void {
    const identity = chat.nodeScopeIdentity
    if (!identity) throw new Error('Save this chat before approving node scope')
    const next = {
      ...this.approvals,
      [identity]: {
        scope: normalized(chat),
        principals: { ...principals },
        nonce: crypto.randomUUID(),
      },
    }
    this.storage?.write(next)
    this.approvals = next
  }
  revoke(chat: NodeScopeChat): void {
    const next = { ...this.approvals }
    if (chat.nodeScopeIdentity) delete next[chat.nodeScopeIdentity]
    this.storage?.write(next)
    this.approvals = next
  }
  approvedNode(chat: NodeScopeChat, node: string, principal: string): boolean {
    const grant = chat.nodeScopeIdentity ? this.approvals[chat.nodeScopeIdentity] : undefined
    return !!grant && grant.scope === normalized(chat) && grant.principals[node] === principal
  }
  guard(
    chat: NodeScopeChat,
    target: NodeScopeTarget,
    principal: string,
    access: 'read' | 'edit'
  ): () => void {
    const identity = chat.nodeScopeIdentity
    const approval = identity ? this.approvals[identity] : undefined
    const scope = normalized(chat),
      conversation = chat.conversationVersion.value,
      branch = chat.branchSelectionVersion
    const check = () => {
      if (
        !identity ||
        chat.nodeScopeIdentity !== identity ||
        !approval ||
        this.approvals[identity] !== approval ||
        normalized(chat) !== scope ||
        !this.approvedNode(chat, target.node_id, principal) ||
        chat.conversationVersion.value !== conversation ||
        chat.branchSelectionVersion !== branch ||
        !nodeScopeEntries(chat).some((entry) => coversNodeScope(entry, target, access))
      )
        throw new Error(
          'Local owner node scope approval is missing, changed or revoked for this chat'
        )
    }
    check()
    return check
  }
}

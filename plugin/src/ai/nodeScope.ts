import { UiError, uiMessage } from '@/i18n/streamBErrors'
import { z } from 'zod'
import type { SessionOverrides } from './agents/types'
import { NodeAccessRefusalError } from './tools/node/accessRefusal'

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
export const NodeScopeEntriesSchema = z.array(NodeScopeEntrySchema)
export const NodeScopeTargetSchema = z
  .object({ node_id: id, project_id: id, target: NodeChatTargetSchema })
  .strict()
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
export function hasNodeScope(chat: NodeScopeChat): boolean {
  return !!chat.overrides?.value && Object.hasOwn(chat.overrides.value, 'nodeScope')
}
export function nodeScopeEntries(chat: NodeScopeChat): NodeScopeEntry[] {
  return NodeScopeEntriesSchema.parse(chat.overrides?.value.nodeScope ?? [])
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
export function nodeScopeResourceKey(entry: NodeScopeEntry): string {
  return nodeScopeKey({ ...entry, access: 'read' })
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
const EntryApprovalSchema = z
  .object({ entry: NodeScopeEntrySchema, principal: z.string() })
  .strict()
const ApprovalSchema = z
  .object({ entries: z.record(z.string(), EntryApprovalSchema), nonce: z.string() })
  .strict()
type Approval = z.infer<typeof ApprovalSchema>
export interface NodeScopeStorage {
  read(): unknown
  write(value: unknown): void
}

/** Exact entry approvals stay bound to a local installation. Legacy blanket records fail closed. */
export class NodeScopeLedger {
  private approvals: Record<string, Approval>
  constructor(private readonly storage?: NodeScopeStorage) {
    const loaded = z.record(z.string(), ApprovalSchema).safeParse(storage?.read() ?? {})
    this.approvals = loaded.success ? loaded.data : {}
  }
  private commit(next: Record<string, Approval>): void {
    this.storage?.write(next)
    this.approvals = next
  }
  /** A nested chat receives the same exact, locally approved installation bindings. */
  inherit(chat: NodeScopeChat, parentIdentity: string): void {
    const identity = chat.nodeScopeIdentity
    const parent = this.approvals[parentIdentity]
    if (!identity || !parent || identity === parentIdentity) return
    const keys = new Set(nodeScopeEntries(chat).map(nodeScopeKey))
    const entries = Object.fromEntries(
      Object.entries(parent.entries).filter(([key]) => keys.has(key))
    )
    this.commit({ ...this.approvals, [identity]: { entries, nonce: crypto.randomUUID() } })
  }
  /** Explicit confirmation of the supplied entries; default is the displayed complete configuration. */
  approve(
    chat: NodeScopeChat,
    principals: Record<string, string>,
    chosen = nodeScopeEntries(chat)
  ): void {
    const identity = chat.nodeScopeIdentity
    if (!identity) throw new UiError(uiMessage('streamBError.fa179ed984'))
    const current = new Set(nodeScopeEntries(chat).map(nodeScopeKey))
    const entries = { ...this.approvals[identity]?.entries }
    for (const [key] of Object.entries(entries)) if (!current.has(key)) delete entries[key]
    for (const entry of chosen) {
      const key = nodeScopeKey(entry),
        principal = principals[entry.node_id]
      if (!current.has(key) || !principal) throw new UiError(uiMessage('streamBError.427b10788e'))
      entries[key] = { entry: NodeScopeEntrySchema.parse(entry), principal }
    }
    this.commit({ ...this.approvals, [identity]: { entries, nonce: crypto.randomUUID() } })
  }
  /** Configuration changes fence continuations and prune lost grants, never create new grants. */
  reconcile(chat: NodeScopeChat): void {
    const identity = chat.nodeScopeIdentity
    if (!identity || !this.approvals[identity]) return
    const parsed = NodeScopeEntriesSchema.safeParse(chat.overrides?.value.nodeScope)
    const current = new Set(parsed.success ? parsed.data.map(nodeScopeKey) : [])
    const entries = Object.fromEntries(
      Object.entries(this.approvals[identity].entries).filter(([key]) => current.has(key))
    )
    this.commit({ ...this.approvals, [identity]: { entries, nonce: crypto.randomUUID() } })
  }
  revoke(chat: NodeScopeChat): void {
    const next = { ...this.approvals }
    if (chat.nodeScopeIdentity) delete next[chat.nodeScopeIdentity]
    this.commit(next)
  }
  revokeNode(node: string): void {
    const next = { ...this.approvals }
    for (const [chat, approval] of Object.entries(next)) {
      const entries = Object.fromEntries(
        Object.entries(approval.entries).filter(([, grant]) => grant.entry.node_id !== node)
      )
      if (Object.keys(entries).length !== Object.keys(approval.entries).length)
        next[chat] = { entries, nonce: crypto.randomUUID() }
    }
    this.commit(next)
  }
  approvedEntries(chat: NodeScopeChat, node: string, principal: string): NodeScopeEntry[] {
    const grant = chat.nodeScopeIdentity ? this.approvals[chat.nodeScopeIdentity] : undefined
    return nodeScopeEntries(chat).filter(
      (entry) =>
        entry.node_id === node && grant?.entries[nodeScopeKey(entry)]?.principal === principal
    )
  }
  approvedNode(chat: NodeScopeChat, node: string, principal: string): boolean {
    return this.approvedEntries(chat, node, principal).length > 0
  }
  guardNode(chat: NodeScopeChat, node: string, principal: string): () => void {
    const identity = chat.nodeScopeIdentity,
      approval = identity ? this.approvals[identity] : undefined
    const scope = normalized(chat),
      conversation = chat.conversationVersion.value,
      branch = chat.branchSelectionVersion
    const check = () => {
      // No approval here at all is what the person can fix with one press on this device.
      if (!identity || !approval || !this.approvedNode(chat, node, principal))
        throw new NodeAccessRefusalError(
          'Local owner node scope approval is missing, changed or revoked for this chat',
          { kind: 'not-approved', node_id: node }
        )
      if (
        chat.nodeScopeIdentity !== identity ||
        this.approvals[identity] !== approval ||
        normalized(chat) !== scope ||
        chat.conversationVersion.value !== conversation ||
        chat.branchSelectionVersion !== branch
      )
        throw new UiError(uiMessage('streamBError.80385f9f65'))
    }
    check()
    return check
  }
  guard(
    chat: NodeScopeChat,
    target: NodeScopeTarget,
    principal: string,
    access: 'read' | 'edit'
  ): () => void {
    const nodeGuard = this.guardNode(chat, target.node_id, principal)
    const check = () => {
      nodeGuard()
      if (
        !this.approvedEntries(chat, target.node_id, principal).some((entry) =>
          coversNodeScope(entry, target, access)
        )
      )
        throw new NodeAccessRefusalError(
          access === 'edit'
            ? 'This chat may only read here, not change files. The person gives it read and edit access with Give this chat access under this call, or in Node access.'
            : 'Local owner node scope approval is missing or revoked for this target',
          {
            kind: 'no-access',
            node_id: target.node_id,
            project_id: target.project_id,
            target: target.target,
            ...(access === 'edit' ? { access } : {}),
          }
        )
    }
    check()
    return check
  }
}

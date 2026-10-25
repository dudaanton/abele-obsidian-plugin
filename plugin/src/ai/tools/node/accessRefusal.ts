import type { NodeChatTarget } from '@/ai/nodeScope'

/**
 * Why a node tool was refused, in a form the chat can act on: what was missing and where the
 * agent wanted to go. The tool's line in the chat offers the one thing that would let it through —
 * giving this chat access there, approving on this device, or opening the Node panel — instead of
 * only saying no.
 */
export interface NodeAccessRefusal {
  /**
   * `no-access`: the chat may not reach that place; `not-approved`: it may, but this device has
   * not confirmed it; `no-worktree`: the place it named does not exist; `offline`: the node is not
   * connected.
   */
  kind: 'no-access' | 'not-approved' | 'no-worktree' | 'offline'
  /** Empty when the chat has no node access at all and the call named no node. */
  node_id: string
  project_id?: string
  target?: NodeChatTarget
  /** For `no-worktree`: the name the agent asked for, and the ones there are. */
  wanted?: string
  known?: string[]
  /** `edit` when the call would have changed files where the chat may only read. */
  access?: 'edit' | 'run'
}

/**
 * A node tool's refusal for want of access: the message is what the agent reads, the refusal is
 * what the chat shows under the call. The agent loop carries it onto the call's result.
 */
export class NodeAccessRefusalError extends Error {
  readonly toolDetails: { nodeAccessRefusal: NodeAccessRefusal }
  constructor(
    message: string,
    readonly refusal: NodeAccessRefusal
  ) {
    super(message)
    this.name = 'NodeAccessRefusalError'
    this.toolDetails = { nodeAccessRefusal: refusal }
  }
}

/** The refusal a failed tool's result carries, when it carries one. */
export function nodeAccessRefusalOf(details: unknown): NodeAccessRefusal | undefined {
  const refusal = (details as { nodeAccessRefusal?: NodeAccessRefusal } | undefined)
    ?.nodeAccessRefusal
  return refusal && typeof refusal.kind === 'string' ? refusal : undefined
}

/** Where the agent wanted to go, handed to the Node access section as it opens. */
export type NodeAccessWant = Pick<NodeAccessRefusal, 'node_id' | 'project_id' | 'target' | 'access'>

type Covering = {
  kind: 'node' | 'project' | 'target'
  access?: 'read' | 'edit' | 'run'
  node_id: string
  project_id?: string
  target?: NodeChatTarget
}

/**
 * Whether a chat's access now reaches where a refused call wanted to go. A call that named no
 * node (a chat with no node access at all) is let through by any access.
 */
export function accessCovers(entries: readonly Covering[], want: NodeAccessWant): boolean {
  if (!want.node_id) return entries.length > 0
  return entries.some((e) => {
    if (e.node_id !== want.node_id) return false
    if (want.access === 'edit' && e.access !== 'edit' && e.access !== 'run') return false
    if (want.access === 'run' && e.access !== 'run') return false
    if (e.kind === 'node') return true
    if (e.project_id !== want.project_id) return false
    if (e.kind === 'project') return true
    return (
      !!want.target &&
      !!e.target &&
      e.target.kind === want.target.kind &&
      JSON.stringify(e.target) === JSON.stringify(want.target)
    )
  })
}

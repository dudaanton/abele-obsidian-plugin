import type { ChatSession } from '../../ChatSession'
import {
  NodeScopeLedger,
  NodeScopeEntrySchema,
  nodeScopeEntries,
  nodeScopeKey,
  nodeScopeResourceKey,
  type NodeScopeEntry,
  type NodeScopeChat,
} from '../../nodeScope'
import type { NodeAgentHost, NodeAgentConnection } from './agent'
import type { NodeRegistry } from '@/node/NodeRegistry'

export function nodeRegistrationPrincipal(
  registry: Pick<NodeRegistry, 'list' | 'authorizationId'>,
  id: string
): string {
  const registration = registry.list().find((node) => node.id === id)
  if (!registration) throw new Error('Node registration was removed')
  return JSON.stringify([
    registration.expectedNodeId,
    registry.authorizationId(id),
    'installationId' in registration ? registration.installationId : registration.id,
    'nodeFingerprint' in registration ? registration.nodeFingerprint : registration.url,
  ])
}

let ownerHost: NodeAgentHost | undefined
let ownerApp: object | undefined
let ownerService: object | undefined
export function revokeNodeScopeApproval(session: ChatSession): void {
  ownerHost?.ledger.revoke(session)
}
export function reconcileNodeScopeApproval(session: ChatSession): void {
  ownerHost?.ledger.reconcile(session)
}
export async function revokeObsidianChatNodeApproval(session: ChatSession): Promise<void> {
  revokeNodeScopeApproval(session)
  const { GlobalStore } = await import('@/stores/GlobalStore')
  const { app } = GlobalStore.getInstance()
  new NodeScopeLedger({
    read: () => app.loadLocalStorage('abele-chat-node-scope-approvals'),
    write: (value) => app.saveLocalStorage('abele-chat-node-scope-approvals', value),
  }).revoke(session)
}
/** Connection owner calls this before removing/replacing a registration or reauthorizing it. */
export async function revokeObsidianNodeScopeApprovals(nodeId: string): Promise<void> {
  const host = await nodeAgentHost()
  host.ledger.revokeNode(host.nodeId?.(nodeId) ?? nodeId)
}

/** Lazy Obsidian adapter. Persist stable node identities, never device-local registry aliases. */
export async function nodeAgentHost(): Promise<NodeAgentHost> {
  const [{ NodeService }, { GlobalStore }] = await Promise.all([
    import('@/node/NodeService'),
    import('@/stores/GlobalStore'),
  ])
  const { app } = GlobalStore.getInstance(),
    service = NodeService.getInstance()
  if (ownerHost && ownerApp === app && ownerService === service) return ownerHost
  ownerApp = app
  ownerService = service
  const ledger = new NodeScopeLedger({
    read: () => app.loadLocalStorage('abele-chat-node-scope-approvals'),
    write: (value) => app.saveLocalStorage('abele-chat-node-scope-approvals', value),
  })
  const connectionFor = (id: string): NodeAgentConnection => {
    const connection = service.connection(id)
    return {
      client: connection.client,
      childTitle: (parent, workspace) =>
        connection.delegationCards.value[parent]?.find((card) => card.workspaceId === workspace)
          ?.title,
      principal: () => nodeRegistrationPrincipal(service.registry, id),
      get authorizationGeneration() {
        return connection.authorizationGeneration
      },
    }
  }
  ownerHost = {
    ledger,
    childReadGuard: async (chat, target) => {
      if (!chat.delegationParentId) return
      const registrations = service.registry
        .list()
        .filter(
          (node) =>
            node.expectedNodeId === target.node_id &&
            ledger.approvedNode(
              chat,
              target.node_id,
              nodeRegistrationPrincipal(service.registry, node.id)
            )
        )
      if (registrations.length !== 1) return
      const registration = registrations[0]
      return service
        .connection(registration.id)
        .delegation.childReadGuard(
          chat.delegationParentId,
          target.project_id,
          target.target.kind === 'workspace'
            ? target.target.workspace_id
            : target.target.worktree_id
        )
    },
    nodeId: (id) => service.registry.list().find((node) => node.id === id)?.expectedNodeId ?? id,
    nodes: () =>
      service.nodes.value.map((node) => ({
        id: node.id,
        node_id: node.expectedNodeId,
        label: node.label,
      })),
    connection: (id: string, chat?: NodeScopeChat) => {
      const entries = service.registry.list(),
        exact = entries.find((node) => node.id === id)
      if (exact) return connectionFor(exact.id)
      const candidates = entries
        .filter((node) => node.expectedNodeId === id)
        .map((node) => connectionFor(node.id))
      const approved = chat
        ? candidates.filter((connection) => ledger.approvedNode(chat, id, connection.principal()))
        : []
      if (approved.length === 1) return approved[0]
      if (candidates.length === 1) return candidates[0]
      throw new Error(
        candidates.length
          ? 'Choose the node installation explicitly to approve access'
          : 'Reconnect this node before approving chat access'
      )
    },
  }
  return ownerHost
}

/** Owner UI only. Whole-node scope intentionally includes future registered folders.
 * Credentials and installation IDs stay in the local ledger, never in chat metadata.
 */
export function setObsidianChatNodeScope(
  session: ChatSession,
  entries: NodeScopeEntry[]
): Promise<void> {
  return saveNodeScope(session, entries, entries)
}
/**
 * Owner UI only: confirms on this device the chosen entries the chat already has, leaving its
 * access as it is. A refused call's Approve names exactly these before it is pressed.
 */
export function approveObsidianChatNodeAccess(
  session: ChatSession,
  chosen: NodeScopeEntry[]
): Promise<void> {
  return saveNodeScope(session, nodeScopeEntries(session), chosen)
}
async function saveNodeScope(
  session: ChatSession,
  entries: NodeScopeEntry[],
  toApprove: NodeScopeEntry[]
): Promise<void> {
  const raw = entries.map((entry) => NodeScopeEntrySchema.parse(entry)),
    version = session.conversationVersion.value
  const host = await nodeAgentHost()
  const canonical = raw.map((entry) => ({
    ...entry,
    node_id: host.nodeId?.(entry.node_id) ?? entry.node_id,
  }))
  const normalized = [
    ...new Map(canonical.map((entry) => [nodeScopeResourceKey(entry), entry])).values(),
  ]
  const check = () => {
    if (session.conversationVersion.value !== version)
      throw new Error('Chat changed while approving node scope')
  }
  check()
  const chosen = toApprove.map((entry) => NodeScopeEntrySchema.parse(entry))
  const canonicalChosen = chosen.map((entry) => ({
    ...entry,
    node_id: host.nodeId?.(entry.node_id) ?? entry.node_id,
  }))
  const connections = new Map<string, NodeAgentConnection>()
  // Only explicitly chosen entries may bind an installation or create a grant.
  for (let index = 0; index < chosen.length; index++)
    if (chosen[index].node_id !== canonicalChosen[index].node_id)
      connections.set(
        canonicalChosen[index].node_id,
        host.connection(chosen[index].node_id, session)
      )
  for (const entry of canonicalChosen)
    if (!connections.has(entry.node_id))
      connections.set(entry.node_id, host.connection(entry.node_id, session))
  const principals = Object.fromEntries(
    [...connections].map(([id, connection]) => [id, connection.principal()])
  )
  const generations = new Map(
    [...connections].map(([id, connection]) => [id, connection.authorizationGeneration])
  )
  session.overrides.value = { ...session.overrides.value, nodeScope: normalized }
  host.ledger.reconcile(session)
  await session.saveForRelease()
  check()
  if (!canonicalChosen.length) return
  await session.ensureDelegationParentId()
  check()
  if (JSON.stringify(nodeScopeEntries(session)) !== JSON.stringify(normalized))
    throw new Error('Node scope changed while saving owner approval')
  for (const [id, connection] of connections)
    if (
      principals[id] !== connection.principal() ||
      generations.get(id) !== connection.authorizationGeneration
    )
      throw new Error('Node identity changed during scope approval')
  host.ledger.approve(session, principals, canonicalChosen)
}

/** Public Node-panel row-menu action. C supplies the explicitly chosen chat and immutable row identity.
 * node_id may be a local registry alias or the stable daemon ID; only the stable ID is persisted.
 */
export function giveObsidianChatAccess(session: ChatSession, raw: NodeScopeEntry): Promise<void> {
  const entry = NodeScopeEntrySchema.parse(raw),
    current = nodeScopeEntries(session)
  return saveNodeScope(
    session,
    [...current.filter((value) => nodeScopeKey(value) !== nodeScopeKey(entry)), entry],
    [entry]
  )
}

/** Header removal fences pending work synchronously, before persistence or any network await. */
export async function removeObsidianChatNodeAccess(
  session: ChatSession,
  entry: NodeScopeEntry
): Promise<void> {
  const remaining = nodeScopeEntries(session).filter(
    (value) => nodeScopeKey(value) !== nodeScopeKey(entry)
  )
  session.overrides.value = { ...session.overrides.value, nodeScope: remaining }
  reconcileNodeScopeApproval(session)
  return saveNodeScope(session, remaining, [])
}

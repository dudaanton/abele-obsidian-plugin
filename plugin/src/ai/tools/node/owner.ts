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

let ownerHost: NodeAgentHost | undefined
let ownerApp: object | undefined
let ownerService: object | undefined
export function revokeNodeScopeApproval(session: ChatSession): void {
  ownerHost?.ledger.revoke(session)
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
  const generations = new Map<string, number>()
  const connectionFor = (id: string): NodeAgentConnection => {
    const connection = service.connection(id)
    return {
      client: connection.client,
      principal: () => {
        const registration = service.registry.list().find((node) => node.id === id)
        if (!registration) throw new Error('Node registration was removed')
        const generation = connection.authorizationGeneration
        const before = generations.get(id)
        if (before !== undefined && before !== generation)
          ledger.revokeNode(registration.expectedNodeId)
        generations.set(id, generation)
        return JSON.stringify([
          registration.expectedNodeId,
          'installationId' in registration ? registration.installationId : registration.id,
          'nodeFingerprint' in registration ? registration.nodeFingerprint : registration.url,
          connection.authorizationGeneration,
        ])
      },
    }
  }
  ownerHost = {
    ledger,
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
export async function setObsidianChatNodeScope(
  session: ChatSession,
  entries: NodeScopeEntry[]
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
  const connections = new Map<string, NodeAgentConnection>()
  // An explicit local picker/row choice wins over a synced stable-ID entry. A model cannot call this action.
  for (let index = 0; index < raw.length; index++)
    if (raw[index].node_id !== canonical[index].node_id)
      connections.set(canonical[index].node_id, host.connection(raw[index].node_id, session))
  for (const entry of normalized)
    if (!connections.has(entry.node_id))
      connections.set(entry.node_id, host.connection(entry.node_id, session))
  const principals = Object.fromEntries(
    [...connections].map(([id, connection]) => [id, connection.principal()])
  )
  host.ledger.revoke(session)
  session.overrides.value = { ...session.overrides.value, nodeScope: normalized }
  await session.saveForRelease()
  check()
  if (!normalized.length) return
  await session.ensureDelegationParentId()
  check()
  if (JSON.stringify(nodeScopeEntries(session)) !== JSON.stringify(normalized))
    throw new Error('Node scope changed while saving owner approval')
  for (const [id, connection] of connections)
    if (principals[id] !== connection.principal())
      throw new Error('Node identity changed during scope approval')
  host.ledger.approve(session, principals)
}

/** Public Node-panel row-menu action. C supplies the explicitly chosen chat and immutable row identity.
 * node_id may be a local registry alias or the stable daemon ID; only the stable ID is persisted.
 */
export function giveObsidianChatAccess(session: ChatSession, raw: NodeScopeEntry): Promise<void> {
  const entry = NodeScopeEntrySchema.parse(raw),
    current = nodeScopeEntries(session)
  return setObsidianChatNodeScope(session, [
    ...current.filter((value) => nodeScopeKey(value) !== nodeScopeKey(entry)),
    entry,
  ])
}

/** Header removal fences pending work synchronously, before persistence or any network await. */
export async function removeObsidianChatNodeAccess(
  session: ChatSession,
  entry: NodeScopeEntry
): Promise<void> {
  revokeNodeScopeApproval(session)
  const host = await nodeAgentHost()
  host.ledger.revoke(session)
  return setObsidianChatNodeScope(
    session,
    nodeScopeEntries(session).filter((value) => nodeScopeKey(value) !== nodeScopeKey(entry))
  )
}

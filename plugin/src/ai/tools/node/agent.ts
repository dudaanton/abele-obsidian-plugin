import type { NodeClient, RepositoryRevision } from '@abele/node-client'
import { t } from '@/i18n'
import * as protocol from '@abele/node-protocol'
import { z } from 'zod'
import { sha256 } from '@noble/hashes/sha2'
import { bytesToHex } from '@noble/hashes/utils'
const contentHash = (value: string) => bytesToHex(sha256(new TextEncoder().encode(value)))
import type { AgentTool, AgentToolResult } from '../../client'
import type { ChatSession } from '../../ChatSession'
import { readNodeText } from '@/node/NodeFilesModel'
import { readStore } from '@/node/NodeClientStore'
import { NodeMutationStore, nodeMutationKey, type NodeMutationRecord } from './mutations'
import { NodeAccessRefusalError, type NodeAccessWant } from './accessRefusal'
import {
  type NodeScopeLedger,
  type NodeScopeTarget,
  type NodeScopeChat,
  nodeScopeEntries,
  nodeTargetId,
  coversNodeScope,
  NodeScopeTargetSchema,
} from '../../nodeScope'

import {
  NODE_EDIT_TOOLS,
  NODE_FILE_OPERATIONS,
  NODE_MUTATION_TOOLS,
  GIVE_ACCESS,
  CHOOSE_TARGET,
  NO_NODE_ACCESS,
  NODE_ACCESS_NOT_APPROVED,
  nodeToolDescription,
  resolveNodeTarget,
} from './guidance'
export { NODE_EDIT_TOOLS, NODE_FILE_OPERATIONS, NODE_MUTATION_TOOLS } from './guidance'
export const NODE_MANAGER_TOOLS = ['node_git_commit', 'node_worktree_remove']
export const NODE_AGENT_TOOL_NAMES = [
  'node_nodes',
  'node_folders',
  'list_node_worktrees',
  'node_ls',
  'node_read',
  ...NODE_MUTATION_TOOLS,
  'node_search',
  'node_git_status',
  'node_git_diff',
  'node_git_branches',
  'node_git_log',
  'node_git_blame',
  'node_worktree_switch',
  ...NODE_MANAGER_TOOLS,
]
export interface NodeAgentConnection {
  client: NodeClient
  childTitle?(parent: string, workspace: string): string | undefined
  /** Durable registration authority and installation/pin, never a display label. */
  principal(): string
  /** Process-local reauthorization fence; never persisted in approvals or mutation records. */
  readonly authorizationGeneration: number
}
export interface NodeAgentHost {
  ledger: NodeScopeLedger
  nodes(): { id: string; label: string; node_id?: string }[]
  /** Registry aliases are device-local; persisted scope uses the stable daemon ID. */
  nodeId?(id: string): string
  connection(node: string, chat?: NodeScopeChat): NodeAgentConnection
  childReadGuard?(
    chat: ChatSession,
    target: NodeScopeTarget
  ): Promise<(() => Promise<void>) | undefined>
  /** Trusted operation-ID allocator; production uses random IDs. */
  newOperationId?(tool: string): string
}
export type NodeAgentHostFactory = () => NodeAgentHost | Promise<NodeAgentHost>
const answer = (value: unknown, details?: unknown): AgentToolResult => ({
  content: [
    { type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) },
  ],
  details,
})
const text = (params: Record<string, unknown>, key: string, fallback = '') => {
  if (params[key] === undefined) return fallback
  return z.string().parse(params[key])
}
const pathSchema = protocol.RelativePathSchema.refine(
  (p) => !p.split('/').some((s) => s.toLowerCase() === '.git')
)
const fileSchema = pathSchema.refine((p) => p.length > 0)
function mutationArguments(name: string, params: Record<string, unknown>) {
  const path = fileSchema.parse(
    NODE_FILE_OPERATIONS.includes(name)
      ? text(params, 'from', text(params, 'path'))
      : text(params, 'path')
  )
  const expected_content_id = z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable()
    .parse(params.expected_content_id)
  return {
    path,
    expected_content_id,
    ...(name === 'node_write' ? { text: z.string().parse(params.text) } : {}),
    ...(['node_edit', 'node_replace'].includes(name)
      ? {
          old_text: z.string().min(1).parse(params.old_text),
          new_text: z.string().parse(params.new_text),
        }
      : {}),
    ...(['node_mv', 'node_cp'].includes(name) ? { to: fileSchema.parse(text(params, 'to')) } : {}),
  }
}
function pendingMutation(
  record: NodeMutationRecord,
  state: 'pending' | 'outcome_unknown'
): AgentToolResult {
  return answer(
    `Node mutation outcome is ${state}. Operation ID: ${record.operation_id}. Retry the exact request with operation_id ${record.operation_id}; never create a replacement operation.`,
    { operation_id: record.operation_id, state }
  )
}
const targetOf = (session: NodeScopeChat, params: Record<string, unknown>): NodeScopeTarget => {
  if (!params.node && !params.project && !params.workspace) {
    const selected = session.overrides.value.nodeTarget
    if (selected) {
      const parsed = NodeScopeTargetSchema.parse(selected)
      if (!parsed.target) throw new Error('The selected chat node target is missing')
      return { ...parsed, target: parsed.target }
    }
    // A chat given one folder or worktree reads there without naming it.
    const scopes = nodeScopeEntries(session)
    if (!scopes.length)
      throw new NodeAccessRefusalError(NO_NODE_ACCESS, { kind: 'no-access', node_id: '' })
    const [only] = scopes
    if (scopes.length === 1 && only.kind === 'target')
      return { node_id: only.node_id, project_id: only.project_id, target: only.target }
    throw new Error(`This chat may reach more than one folder, so name one. ${CHOOSE_TARGET}`)
  }
  return {
    node_id: text(params, 'node'),
    project_id: text(params, 'project'),
    target:
      z.enum(['workspace', 'worktree']).parse(params.target_kind ?? 'worktree') === 'workspace'
        ? { kind: 'workspace', workspace_id: text(params, 'workspace') }
        : { kind: 'worktree', worktree_id: text(params, 'workspace') },
  }
}

/** Catalogue identity validation is independent of selection and of scope permission. */
export async function validateNodeTarget(
  client: NodeClient,
  target: NodeScopeTarget,
  guard: () => void = () => {}
): Promise<void> {
  guard()
  const project = await client.getProject(target.project_id)
  guard()
  if (target.target.kind === 'workspace') {
    const workspace = await client.getWorkspace(target.target.workspace_id)
    guard()
    if (
      project.repository_path ||
      workspace.project_id !== target.project_id ||
      workspace.kind !== 'root' ||
      workspace.state !== 'ready'
    )
      throw new Error('The selected plain folder is missing or changed identity')
  } else {
    let cursor: string | undefined
    const known: string[] = []
    for (let page = 0; page < 64; page++) {
      guard()
      const result = await client.repository.worktrees({
        project_id: target.project_id,
        cursor,
        limit: 256,
      })
      guard()
      known.push(
        ...result.entries.map(
          (entry) => entry.branch?.replace(/^refs\/heads\//, '') || entry.worktree_id
        )
      )
      const found = result.entries.find(
        (entry) => entry.worktree_id === nodeTargetId(target.target)
      )
      if (found) {
        if (found.project_id !== target.project_id || found.availability !== 'available')
          throw new Error('The selected worktree is missing or unavailable')
        return
      }
      if (!result.cursor) break
      if (result.cursor === cursor) throw new Error('Invalid node catalogue cursor')
      cursor = result.cursor
    }
    throw new NodeAccessRefusalError('The selected worktree is not in this registered project', {
      kind: 'no-worktree',
      node_id: target.node_id,
      project_id: target.project_id,
      wanted: nodeTargetId(target.target),
      known,
    })
  }
}

type Pending = {
  host: NodeAgentHost
  session: ChatSession
  tool: string
  guard(): void
  readGuard?: () => Promise<void>
  text: string
  next?: () => Promise<AgentToolResult>
  expires: number
}
const maxReadBytes = 2 * 1024 * 1024
const retainedReads = new WeakMap<NodeAgentHostFactory, Map<string, Pending>>()

/** Core tool logic. The Obsidian adapter supplies local approvals and authenticated clients. */
export function createNodeAgentTools(factory: NodeAgentHostFactory): AgentTool[] {
  const pending = retainedReads.get(factory) ?? new Map<string, Pending>()
  retainedReads.set(factory, pending)
  function page(entry: Pending): AgentToolResult {
    entry.guard()
    let bytes = 0,
      end = 0
    for (const char of entry.text) {
      const size = new TextEncoder().encode(JSON.stringify(char)).length - 2
      if (bytes + size > 24 * 1024) break
      bytes += size
      end += char.length
    }
    const shown = entry.text.slice(0, end)
    entry.text = entry.text.slice(end)
    if (!entry.text && !entry.next) return answer(shown)
    while (pending.size >= 16) pending.delete(pending.keys().next().value!)
    const cursor = crypto.randomUUID()
    pending.set(cursor, entry)
    return answer(`${shown}\n\nResult continues. Call ${entry.tool} with cursor: ${cursor}`, {
      cursor,
    })
  }
  return NODE_AGENT_TOOL_NAMES.map((name) => ({
    name,
    label:
      name === 'node_git_commit'
        ? t('streamB.commit.82a9c4')
        : name === 'node_worktree_remove'
          ? t('streamB.deleteTheWorktree.ca8a5f')
          : name.replaceAll('_', ' '),
    category: 'Node files',
    description: nodeToolDescription(name),
    parameters: {
      type: 'object',
      properties: {
        ...Object.fromEntries(
          [
            'node',
            'project',
            'workspace',
            'path',
            'from',
            'to',
            'text',
            'old_text',
            'new_text',
            'query',
            'glob',
            'mode',
            'ref',
            'base',
            'cursor',
            'operation_id',
            'expected_head',
            'expected_observation_id',
            'message',
          ].map((key) => [key, { type: 'string' }])
        ),
        expected_content_id: { type: ['string', 'null'] },
        target_kind: { type: 'string', enum: ['workspace', 'worktree'] },
        case_sensitive: { type: 'boolean' },
        start: { type: 'integer', minimum: 1 },
        count: { type: 'integer', minimum: 1, maximum: 1500 },
        start_line: { type: 'integer', minimum: 1 },
        end_line: { type: 'integer', minimum: 1 },
      },
      additionalProperties: false,
      ...(name === 'node_write' ? { required: ['path', 'expected_content_id', 'text'] } : {}),
    },
    execute: async (_id, raw, signal, ctx) => {
      const session = ctx?.session
      if (!session) throw new Error('An executing Obsidian chat is required')
      const params = structuredClone(raw)
      if (name === 'node_write') z.string().parse(params.text)
      signal?.throwIfAborted()
      for (const [key, value] of pending) if (value.expires <= Date.now()) pending.delete(key)
      const cursor = text(params, 'cursor')
      if (cursor) {
        if (NODE_MUTATION_TOOLS.includes(name) || name === 'node_worktree_switch')
          throw new Error('Mutations cannot use a read cursor')
        const entry = pending.get(cursor)
        if (!entry || entry.session !== session || entry.tool !== name)
          throw new Error('Continuation belongs to another chat/tool or expired')
        if ((await factory()) !== entry.host)
          throw new Error('Node authority host changed; repeat the read')
        entry.guard()
        await entry.readGuard?.()
        pending.delete(cursor)
        return entry.text ? page(entry) : entry.next!()
      }
      const host = await factory()
      let childReadGuard: (() => Promise<void>) | undefined
      const checks: (() => void)[] = []
      const guard = () => {
        signal?.throwIfAborted()
        checks.forEach((check) => check())
      }
      const retain = (result: unknown): AgentToolResult => {
        guard()
        const value = typeof result === 'string' ? result : JSON.stringify(result, null, 2)
        if (new TextEncoder().encode(value).length > 4 * 1024 * 1024)
          throw new Error('Result too large; narrow the read')
        return page({
          host,
          session,
          tool: name,
          guard,
          readGuard: childReadGuard,
          text: value,
          expires: Date.now() + 600000,
        })
      }
      const scopes = nodeScopeEntries(session)
      // Where the call wanted to go, for a refusal the chat can act on.
      const admittedConnection = (node: string, want: Omit<NodeAccessWant, 'node_id'> = {}) => {
        const place = { node_id: node, ...want }
        if (!scopes.length)
          throw new NodeAccessRefusalError(NO_NODE_ACCESS, { kind: 'no-access', ...place })
        if (!scopes.some((entry) => entry.node_id === node))
          throw new NodeAccessRefusalError(
            `Node ${JSON.stringify(node)} is not in this chat's node access. This chat may use ${[
              ...new Set(scopes.map((entry) => JSON.stringify(entry.node_id))),
            ].join(', ')}; node_nodes lists them. ${GIVE_ACCESS}`,
            { kind: 'no-access', ...place }
          )
        const connection = host.connection(node, session),
          principal = connection.principal(),
          generation = connection.authorizationGeneration
        if (!host.ledger.approvedNode(session, node, principal))
          throw new NodeAccessRefusalError(NODE_ACCESS_NOT_APPROVED, {
            kind: 'not-approved',
            ...place,
          })
        checks.push(host.ledger.guardNode(session, node, principal))
        const identity = session.nodeScopeIdentity,
          conversation = session.conversationVersion.value,
          branch = session.branchSelectionVersion
        const scope = JSON.stringify(scopes)
        checks.push(() => {
          if (!connection.client.connected)
            throw new NodeAccessRefusalError(
              'Node offline; reconnect before agent file operations. The person connects it from the Node panel.',
              { kind: 'offline', node_id: node }
            )
          if (
            principal !== connection.principal() ||
            generation !== connection.authorizationGeneration ||
            identity !== session.nodeScopeIdentity ||
            conversation !== session.conversationVersion.value ||
            branch !== session.branchSelectionVersion ||
            scope !== JSON.stringify(nodeScopeEntries(session)) ||
            !host.ledger.approvedNode(session, node, principal)
          )
            throw new Error('Node scope approval changed or was revoked')
        })
        guard()
        return connection
      }
      const safe = async <T>(work: () => Promise<T>): Promise<T> => {
        guard()
        if (childReadGuard) {
          await childReadGuard()
          guard()
        }
        const result = await work()
        if (childReadGuard) await childReadGuard()
        guard()
        return result
      }
      if (name === 'node_nodes') {
        if (!scopes.length) return answer(NO_NODE_ACCESS)
        const result: unknown[] = []
        let unapproved = false
        for (const node of host.nodes()) {
          const nodeId = host.nodeId?.(node.id) ?? node.id
          if (!scopes.some((entry) => entry.node_id === nodeId)) continue
          const connection = host.connection(node.id),
            principal = connection.principal(),
            generation = connection.authorizationGeneration
          if (!host.ledger.approvedNode(session, nodeId, principal)) {
            unapproved = true
            continue
          }
          checks.push(host.ledger.guardNode(session, nodeId, principal))
          checks.push(() => {
            if (
              connection.principal() !== principal ||
              connection.authorizationGeneration !== generation
            )
              throw new Error('Node identity changed')
          })
          if (!connection.client.connected) {
            result.push({ node: nodeId, label: node.label, connected: false })
            continue
          }
          admittedConnection(nodeId)
          await safe(() => connection.client.describe())
          result.push({ node: nodeId, label: node.label, connected: true })
        }
        if (!result.length)
          return answer(
            unapproved
              ? NODE_ACCESS_NOT_APPROVED
              : 'The nodes this chat may use are not connected on this device. The person connects them from the Node panel.'
          )
        return retain(result)
      }
      if (name === 'node_folders') {
        const requested = text(params, 'node')
        const node = host.nodeId?.(requested) ?? requested,
          connection = admittedConnection(node),
          result: unknown[] = []
        const scopes = host.ledger.approvedEntries(session, node, connection.principal())
        let after: string | undefined
        for (let page = 0; page < 64; page++) {
          const projects = await safe(() => connection.client.listProjects(after))
          for (const project of projects) {
            if (
              !scopes.some(
                (entry) =>
                  entry.node_id === node &&
                  (entry.kind === 'node' || entry.project_id === project.project_id)
              )
            )
              continue
            const workspaces = []
            let workspaceAfter: string | undefined
            for (let page = 0; page < 64; page++) {
              const batch = await safe(() =>
                connection.client.listWorkspaces(project.project_id, workspaceAfter)
              )
              workspaces.push(
                ...batch.filter((workspace) =>
                  scopes.some((entry) =>
                    coversNodeScope(
                      entry,
                      {
                        node_id: node,
                        project_id: project.project_id,
                        target: { kind: 'workspace', workspace_id: workspace.workspace_id },
                      },
                      'read'
                    )
                  )
                )
              )
              if (batch.length < 100) break
              workspaceAfter = batch.at(-1)!.workspace_id
            }
            const worktrees = []
            if (project.repository_path) {
              let cursor: string | undefined
              for (let page = 0; page < 64; page++) {
                const batch = await safe(() =>
                  connection.client.repository.worktrees({ project_id: project.project_id, cursor })
                )
                worktrees.push(
                  ...batch.entries.filter((entry) =>
                    scopes.some((scope) =>
                      coversNodeScope(
                        scope,
                        {
                          node_id: node,
                          project_id: project.project_id,
                          target: { kind: 'worktree', worktree_id: entry.worktree_id },
                        },
                        'read'
                      )
                    )
                  )
                )
                if (!batch.cursor) break
                if (cursor === batch.cursor) throw new Error('Invalid worktree cursor')
                cursor = batch.cursor
              }
            }
            result.push({
              project: project.project_id,
              label: project.root_path,
              git: !!project.repository_path,
              workspaces: workspaces.map((workspace) => ({
                workspace_id: workspace.workspace_id,
                kind: workspace.kind,
                state: workspace.state,
              })),
              worktrees,
            })
          }
          if (projects.length < 100) return retain(result)
          const next = projects.at(-1)!.project_id
          if (next === after) throw new Error('Invalid project cursor')
          after = next
        }
        throw new Error('Node catalogue exceeds bounded listing limit')
      }
      if (name === 'list_node_worktrees') {
        const selected = session.overrides.value.nodeTarget
        const requested = text(params, 'node', selected?.node_id)
        const node = host.nodeId?.(requested) ?? requested,
          project = text(params, 'project', selected?.project_id)
        const connection = admittedConnection(node, { project_id: project })
        const scopes = host.ledger.approvedEntries(session, node, connection.principal())
        if (
          !scopes.some(
            (entry) =>
              entry.node_id === node && (entry.kind === 'node' || entry.project_id === project)
          )
        )
          throw new NodeAccessRefusalError(
            `Folder ${JSON.stringify(project)} is not in this chat's node access. ${GIVE_ACCESS}`,
            { kind: 'no-access', node_id: node, project_id: project }
          )
        const entries = [],
          omissions: string[] = []
        let cursor: string | undefined,
          incomplete = false
        for (let page = 0; page < 64; page++) {
          const result = await safe(() =>
            connection.client.repository.worktrees({ project_id: project, cursor })
          )
          entries.push(
            ...result.entries.filter((entry) =>
              scopes.some((scope) =>
                coversNodeScope(
                  scope,
                  {
                    node_id: node,
                    project_id: project,
                    target: { kind: 'worktree', worktree_id: entry.worktree_id },
                  },
                  'read'
                )
              )
            )
          )
          const broad = scopes.some(
            (entry) =>
              entry.node_id === node &&
              (entry.kind === 'node' || (entry.kind === 'project' && entry.project_id === project))
          )
          if (broad) omissions.push(...result.omissions)
          else if (result.omissions.length && !omissions.length)
            omissions.push('Some unavailable or out-of-scope resources were omitted.')
          incomplete ||= result.incomplete
          if (!result.cursor) return retain({ entries, incomplete, omissions })
          if (cursor === result.cursor) throw new Error('Invalid worktree cursor')
          cursor = result.cursor
        }
        throw new Error('Worktree catalogue exceeds bounded listing limit')
      }
      const target = targetOf(session, params)
      target.node_id = host.nodeId?.(target.node_id) ?? target.node_id
      const managerOperation = () => {
        if (!session.nodeScopeIdentity)
          throw new Error('A saved executing chat is required for manager actions')
        const alias = z.string().min(1).max(128).parse(params.operation_id)
        const { operation_id: _alias, ...action } = params
        return nodeMutationKey(session.nodeScopeIdentity, name, { target, alias }, action)
      }
      // The model retries its alias; the wire identity is private to this chat and action.
      const managerReceipt = (value: unknown) =>
        value && typeof value === 'object' && 'operation_id' in value
          ? { ...value, operation_id: params.operation_id }
          : value
      let mutation:
        | { store: NodeMutationStore; key: string; chat: string; retry?: NodeMutationRecord }
        | undefined
      if (NODE_MUTATION_TOOLS.includes(name)) {
        if (params.ref || params.base)
          throw new Error('Node writes only operate on current working files')
        const chat = session.nodeScopeIdentity
        if (!chat) throw new Error('A saved executing chat is required for node mutations')
        const candidate = host.connection(target.node_id, session)
        const store = new NodeMutationStore(
          candidate.client.store,
          host.newOperationId ? () => host.newOperationId!(name) : undefined
        )
        const key = nodeMutationKey(chat, name, target, mutationArguments(name, params))
        const retry = await store.find(
          chat,
          key,
          _id,
          params.operation_id === undefined ? undefined : z.string().parse(params.operation_id)
        )
        mutation = { store, key, chat, retry }
        if (retry && (!candidate.client.connected || candidate.principal() !== retry.principal))
          return pendingMutation(retry, 'outcome_unknown')
      }
      const wanted = {
        project_id: target.project_id,
        target: target.target,
        ...(NODE_MUTATION_TOOLS.includes(name) ? { access: 'edit' as const } : {}),
      }
      const connection = admittedConnection(target.node_id, wanted),
        client = connection.client
      const requireCommitTrust = async () => {
        const project = await safe(() => client.getProject(target.project_id))
        if (project.trust !== 'trusted')
          throw new Error(
            'Project is untrusted. The owner must trust this folder before committing; Git hooks can execute project code.'
          )
      }
      if (NODE_MANAGER_TOOLS.includes(name)) {
        checks.push(host.ledger.guard(session, target, connection.principal(), 'edit'))
        if (session.permissionMode.value !== 'allow-all' && !(ctx.interactive && ctx.approved))
          throw new Error('Explicit owner approval is required')
        const operation = managerOperation()
        const method =
          name === 'node_git_commit' ? 'repository.v1.git.commit' : 'repository.v1.worktree.delete'
        const request = {
          worktree_id: nodeTargetId(target.target),
          expected_head: z
            .string()
            .regex(/^[a-f0-9]{40,64}$/)
            .parse(params.expected_head),
          ...(name === 'node_git_commit'
            ? { message: z.string().min(1).max(8192).parse(params.message) }
            : {
                expected_observation_id: z
                  .string()
                  .min(1)
                  .max(128)
                  .parse(params.expected_observation_id),
              }),
        }
        const receipt = await safe(
          () => client.operationResult?.(operation) ?? Promise.resolve(undefined)
        )
        const pending = await safe(() =>
          readStore(client.store, (s) => {
            const legacy = s.outbox.find((entry) => entry.operation_id === params.operation_id)
            if (
              legacy?.method === method &&
              nodeMutationKey('', name, target, legacy.params) ===
                nodeMutationKey('', name, target, request)
            )
              throw new Error(
                'An earlier request with this operation_id is still unresolved. Reconnect and check its result before starting another action.'
              )
            return s.outbox.find((entry) => entry.operation_id === operation)
          })
        )
        const retained = receipt?.request ?? pending
        if (retained) {
          if (
            retained.method !== method ||
            nodeMutationKey('', name, target, retained.params) !==
              nodeMutationKey('', name, target, request)
          )
            throw new Error(
              'idempotency_mismatch: This retry ID was already used with different action arguments. Check the previous result before starting a new action with a new operation_id.'
            )
          if (receipt)
            return retain(
              managerReceipt(
                receipt.error ? { state: 'failed', error: receipt.error } : receipt.result
              )
            )
          // Retry only the exact retained action. Its target may already be gone;
          // re-resolving it would prevent recovering the original deletion receipt.
          if (name === 'node_git_commit') await requireCommitTrust()
          return retain(
            managerReceipt(
              await safe<unknown>(() =>
                name === 'node_git_commit'
                  ? client.repository.git.commit(
                      protocol.RepositoryGitMethodSchemas['repository.v1.git.commit'].parse(
                        request
                      ),
                      operation
                    )
                  : client.nodePath.deleteWorktree(
                      protocol.NodePathMethodSchemas['repository.v1.worktree.delete'].parse(
                        request
                      ),
                      operation
                    )
              )
            )
          )
        }
      }
      const writes =
        NODE_MUTATION_TOOLS.includes(name) ||
        NODE_MANAGER_TOOLS.includes(name) ||
        name === 'node_worktree_switch'
      const ordinarilyCovered = host.ledger
        .approvedEntries(session, target.node_id, connection.principal())
        .some((entry) => coversNodeScope(entry, target, 'read'))
      if (!writes && !ordinarilyCovered)
        childReadGuard = await host.childReadGuard?.(session, target)
      // The node is asked about a folder only once this chat may reach it.
      if (
        !childReadGuard &&
        !host.ledger
          .approvedEntries(session, target.node_id, connection.principal())
          .some((entry) => entry.kind === 'node' || entry.project_id === target.project_id)
      )
        throw new NodeAccessRefusalError(
          `Folder ${JSON.stringify(target.project_id)} is not in this chat's node access. ${CHOOSE_TARGET} ${GIVE_ACCESS}`,
          { kind: 'no-access', node_id: target.node_id, ...wanted }
        )
      await safe(() => resolveNodeTarget(client, target, scopes, guard))
      if (['node_read', ...NODE_MUTATION_TOOLS].includes(name)) ctx?.onNodeFileTarget?.(target)
      const id = nodeTargetId(target.target),
        git = target.target.kind === 'worktree'
      const access = NODE_MUTATION_TOOLS.includes(name) ? 'edit' : 'read'
      if (!childReadGuard)
        checks.push(
          host.ledger.guard(
            session,
            target,
            connection.principal(),
            NODE_MANAGER_TOOLS.includes(name) ? 'edit' : access
          )
        )
      // This chat's current selection is captured, never read from a human tab.
      const selection = JSON.stringify(session.overrides.value.nodeTarget)
      checks.push(() => {
        if (JSON.stringify(session.overrides.value.nodeTarget) !== selection)
          throw new Error('Chat node target changed during the operation')
      })
      await safe(() => validateNodeTarget(client, target, guard))
      const repo = client.repository
      if (NODE_MANAGER_TOOLS.includes(name)) {
        const approval = () => {
          if (session.permissionMode.value !== 'allow-all' && !(ctx.interactive && ctx.approved))
            throw new Error('Explicit owner approval is required')
        }
        checks.push(approval)
        approval()
        if (!git) throw new Error('This action requires a Git worktree')
        const operation = managerOperation()
        const expected_head = z
          .string()
          .regex(/^[a-f0-9]{40,64}$/)
          .parse(params.expected_head)
        if (name === 'node_git_commit') {
          const message = z.string().min(1).max(8192).parse(params.message)
          await requireCommitTrust()
          const result = await safe(() =>
            repo.git.commit({ worktree_id: id, expected_head, message }, operation)
          )
          console.debug('[Abele node tools] Commit receipt', operation, result.state)
          return answer(managerReceipt(result))
        }
        const expected_observation_id = z
          .string()
          .min(1)
          .max(128)
          .parse(params.expected_observation_id)
        const row = (
          await repo.worktrees({ project_id: target.project_id, limit: 256 })
        ).entries.find((entry) => entry.worktree_id === id)
        guard()
        if (!row || row.kind !== 'managed' || row.dirty !== false || row.locked)
          throw new Error('Only a clean, unlocked managed developer worktree can be removed')
        const result = await safe(() =>
          client.nodePath.deleteWorktree(
            { worktree_id: id, expected_head, expected_observation_id },
            operation
          )
        )
        console.debug('[Abele node tools] Worktree removal receipt', operation, result.state)
        return answer(managerReceipt(result))
      }
      const path = pathSchema.parse(text(params, 'path'))
      const revision = async (): Promise<RepositoryRevision> =>
        text(params, 'ref')
          ? safe(() => repo.resolve({ worktree_id: id, ref: text(params, 'ref') }))
          : (await safe(() => repo.observe({ worktree_id: id }))).revision
      const content = async (contentId: string): Promise<string> => {
        const prefix: number[] = []
        const decoded = await readNodeText(async (offset) => {
          const chunk = await safe(() =>
            git
              ? repo.content({ worktree_id: id, content_id: contentId, offset })
              : client.readContent(id, contentId, offset)
          )
          if (prefix.length < 3) {
            const bytes = atob(chunk.base64)
            for (let index = 0; index < bytes.length && prefix.length < 3; index++)
              prefix.push(bytes.charCodeAt(index))
          }
          return chunk
        }, maxReadBytes)
        // The presentation reader strips an initial BOM; exact file edits must retain it.
        return prefix[0] === 0xef && prefix[1] === 0xbb && prefix[2] === 0xbf
          ? `\ufeff${decoded}`
          : decoded
      }
      const read = async (file: string) => {
        fileSchema.parse(file)
        const blob = git
          ? await safe(async () =>
              repo.blob({ worktree_id: id, revision: await revision(), path: file })
            )
          : await safe(() => client.readFile(id, file))
        if (blob.binary || blob.too_large || blob.size > maxReadBytes || !blob.content_id)
          throw new Error('File is missing, binary or too large for bounded UTF-8 tools')
        const value = await content(blob.content_id)
        if (contentHash(value) !== blob.content_id)
          throw new Error('Node bytes do not match the exact file content identity')
        return { text: value, content_id: blob.content_id }
      }
      const paged = async <T>(
        work: (cursor?: string) => Promise<{
          entries: T[]
          cursor: string | null
          incomplete: boolean
          omissions: string[]
        }>
      ) => {
        const entries: T[] = [],
          omissions: string[] = []
        let cursor: string | undefined,
          incomplete = false,
          metadata: Record<string, unknown> = {}
        for (let page = 0; page < 64; page++) {
          const batch = await safe(() => work(cursor))
          if (!cursor) metadata = { ...batch }
          entries.push(...batch.entries)
          omissions.push(...batch.omissions)
          incomplete ||= batch.incomplete
          if (!batch.cursor) {
            const result: Record<string, unknown> & {
              entries: T[]
              cursor: string | null
              incomplete: boolean
              omissions: string[]
            } = { ...metadata, entries, cursor: null, incomplete, omissions }
            return result
          }
          if (batch.cursor === cursor) throw new Error('Invalid node cursor')
          cursor = batch.cursor
        }
        throw new Error('Node result exceeds bounded page count; narrow the read')
      }
      if (name === 'node_worktree_switch') {
        if (!git) throw new Error('Only Git worktrees can be switched')
        const prior = session.overrides.value.nodeTarget
        if (prior && (prior.node_id !== target.node_id || prior.project_id !== target.project_id))
          throw new Error('Switch only inside the currently selected registered folder')
        const entry = (
          await paged((cursor) => repo.worktrees({ project_id: target.project_id, cursor }))
        ).entries.find((entry) => entry.worktree_id === id)
        if (!entry || entry.availability !== 'available') throw new Error('Worktree is unavailable')
        guard()
        session.overrides.value = { ...session.overrides.value, nodeTarget: target }
        session.noteNodeWorktreeSwitch(entry.branch ?? entry.path_label)
        await session.saveForRelease()
        // Selection changed deliberately; permission did not.
        return answer({ state: 'switched', target })
      }
      if (name === 'node_read') {
        const result = await read(fileSchema.parse(path))
        if (params.start_line !== undefined || params.end_line !== undefined) {
          const start = z
            .number()
            .int()
            .min(1)
            .parse(params.start_line ?? 1)
          const end =
            params.end_line === undefined
              ? undefined
              : z.number().int().min(start).parse(params.end_line)
          result.text = result.text
            .split('\n')
            .slice(start - 1, end)
            .join('\n')
        }
        return retain(result)
      }
      if (name === 'node_ls') {
        if (git) {
          const ref = await revision()
          return retain(
            await paged((cursor) => repo.tree({ worktree_id: id, revision: ref, path, cursor }))
          )
        }
        const entries = []
        let after: string | undefined
        for (let page = 0; page < 64; page++) {
          const result = await safe(() => client.listFiles(id, path, after, 256))
          entries.push(...result.entries)
          if (!result.next) return retain({ entries, incomplete: false, omissions: [] })
          if (after === result.next) throw new Error('Invalid file cursor')
          after = result.next
        }
        throw new Error('Folder listing exceeds bounded page count')
      }
      if (name === 'node_search') {
        const mode = z.enum(['literal', 'regex', 'filename']).parse(params.mode ?? 'literal')
        const query = {
          query: text(params, 'query'),
          mode,
          case_sensitive: params.case_sensitive === true,
          ...(params.glob ? { path_glob: text(params, 'glob') } : {}),
          limit: 100,
        }
        if (!git)
          return retain(
            await paged((cursor) =>
              nodePathCall<Awaited<ReturnType<typeof repo.search>>>(
                client,
                'search',
                { workspace_id: id, ...query, cursor },
                safe
              )
            )
          )
        const ref = await revision()
        return retain(
          await paged((cursor) => repo.search({ worktree_id: id, revision: ref, ...query, cursor }))
        )
      }
      if (name.startsWith('node_git_')) {
        if (!git) throw new Error('Git tools require a Git worktree')
        const ref = await revision(),
          request = { worktree_id: id, revision: ref }
        switch (name) {
          case 'node_git_status': {
            const supported = supportsCapability(
              await safe(() => client.describe()),
              'node_path_v2'
            )
            return retain({
              target,
              revision: ref,
              ...(await paged((cursor) => {
                const enriched = protocol.RepositoryMethodSchemas['repository.v1.status'].safeParse(
                  { ...request, cursor, include_change_details: true }
                )
                return repo.status(
                  supported && enriched.success ? enriched.data : { ...request, cursor }
                )
              })),
            })
          }
          case 'node_git_branches':
            return retain(await paged((cursor) => repo.refs({ worktree_id: id, cursor })))
          case 'node_git_log': {
            const historyPage = async (cursor?: string): Promise<AgentToolResult> => {
              const batch = await safe(() =>
                repo.history({ ...request, cursor, limit: 50, ...(path ? { path } : {}) })
              )
              if (cursor && batch.cursor === cursor) throw new Error('Invalid node cursor')
              guard()
              const nextCursor = batch.cursor
              return page({
                host,
                session,
                tool: name,
                guard,
                text: JSON.stringify({ ...batch, cursor: null }, null, 2),
                next: nextCursor ? () => historyPage(nextCursor) : undefined,
                expires: Date.now() + 600000,
              })
            }
            return historyPage()
          }
          case 'node_git_blame':
            return retain(
              await paged((cursor) =>
                repo.blame({
                  ...request,
                  cursor,
                  path: fileSchema.parse(path),
                  start: params.start as number | undefined,
                  count: params.count as number | undefined,
                })
              )
            )
          case 'node_git_diff': {
            const mode = z
              .enum(['staged', 'unstaged', 'endpoint', 'merge-base'])
              .parse(params.mode ?? 'unstaged')
            const base =
              ref.kind === 'working' && ref.head === null && !params.base
                ? { kind: 'empty' as const }
                : await safe(() =>
                    repo.resolve({ worktree_id: id, ref: text(params, 'base', 'HEAD') })
                  )
            if (
              base.kind === 'empty' &&
              !supportsCapability(await safe(() => client.describe()), 'node_path_v2')
            )
              throw new Error('This node does not support unborn Git comparisons; update the node')
            const parsed = protocol.RepositoryMethodSchemas['repository.v1.compare'].safeParse({
              worktree_id: id,
              base,
              head: ref,
              mode,
            })
            if (!parsed.success)
              throw new Error(
                'This node protocol does not support an unborn Git comparison; update the node and plugin'
              )
            const comparison = await paged((cursor) => repo.compare({ ...parsed.data, cursor }))
            if (!path) return retain(comparison)
            const blob = await safe(() =>
              repo.patch({
                worktree_id: id,
                comparison_id: z.string().parse(comparison.comparison_id),
                path: fileSchema.parse(path),
              })
            )
            if (!blob.content_id || blob.too_large || blob.binary)
              throw new Error('Patch unavailable or too large')
            return retain({ ...comparison, patch: await content(blob.content_id) })
          }
        }
      }
      if (NODE_MUTATION_TOOLS.includes(name)) {
        const permissionGuard = () => {
          const mode = session.permissionMode.value
          const asks = NODE_EDIT_TOOLS.includes(name)
            ? !['allow-edit', 'allow-all'].includes(mode)
            : mode !== 'allow-all'
          if (asks && !(ctx.interactive && ctx.approved))
            throw new Error('Owner file-edit approval is required by this chat permission mode')
        }
        checks.push(permissionGuard)
        permissionGuard()
        if (!mutation) throw new Error('Node mutation context is missing')
        // Preflight retries too: a local capability refusal has not submitted an RPC.
        if (NODE_FILE_OPERATIONS.includes(name))
          await nodePathMethod(
            client,
            name === 'node_mv' ? 'fileMove' : name === 'node_cp' ? 'fileCopy' : 'fileRemove',
            safe
          )
        const principal = connection.principal()
        const perform = async (record: NodeMutationRecord): Promise<AgentToolResult> => {
          try {
            guard()
            if (record.principal !== principal) return pendingMutation(record, 'outcome_unknown')
            let receipt: unknown
            if (NODE_EDIT_TOOLS.includes(name)) {
              const operation = git
                ? await repo.write(
                    record.request.params as protocol.RepositoryParams<'repository.v1.write'>,
                    record.operation_id
                  )
                : await client.writeFile(
                    record.request.params as protocol.FileWrite,
                    record.operation_id
                  )
              if (operation.operation_id !== record.operation_id)
                throw new Error('Node returned a different operation identity')
              guard()
              receipt = git
                ? await repo.mutationResult(record.operation_id)
                : await client.fileMutationResult(record.operation_id)
              if (receipt === undefined) {
                await mutation!.store.settle(record, 'pending')
                return pendingMutation(record, 'pending')
              }
              const result = git
                ? protocol.RepositoryMutationResultSchema.parse(receipt)
                : protocol.FileMutationResultSchema.parse(receipt)
              const request = record.request.params as {
                path: string
                expected_content_id: string | null
              }
              if (
                result.operation_id !== record.operation_id ||
                result.path !== request.path ||
                result.expected_content_id !== request.expected_content_id ||
                (git
                  ? !('worktree_id' in result) || result.worktree_id !== id
                  : !('workspace_id' in result) || result.workspace_id !== id)
              )
                throw new Error('Node write receipt does not match the approved operation')
              if (result.state === 'saved' && result.content_id !== contentHash(record.after))
                throw new Error('Saved receipt content does not match the proposed text')
              guard()
              await mutation!.store.settle(record, result.state, result)
              guard()
              console.debug('[Abele node tools] Write receipt', result.operation_id, result.state)
              return answer(result, {
                ...result,
                ...(result.state === 'saved'
                  ? { diff: { old: record.before, new: record.after } }
                  : {}),
              })
            }
            const method =
              name === 'node_mv' ? 'fileMove' : name === 'node_cp' ? 'fileCopy' : 'fileRemove'
            const fn = await nodePathMethod(client, method, safe)
            guard()
            receipt = await fn(record.request.params, record.operation_id)
            guard()
            // NodePathClient validates the shared wire schema; this layer checks effect identity/disposition.
            const result = z.record(z.string(), z.unknown()).parse(receipt)
            const state = z.enum(['applied', 'conflict', 'outcome_unknown']).parse(result.state)
            if (result.operation_id !== record.operation_id)
              throw new Error('Node file-operation receipt does not match the admitted operation')
            await mutation!.store.settle(record, state, result)
            guard()
            return answer(result, {
              ...result,
              ...(state === 'applied' ? { diff: { old: record.before, new: record.after } } : {}),
            })
          } catch (error) {
            console.debug(
              '[Abele node tools] Retained uncertain mutation',
              record.operation_id,
              error
            )
            const known = await Promise.resolve()
              .then(() => client.operationResult(record.operation_id))
              .catch((): undefined => undefined)
            if (known?.error) {
              await mutation!.store
                .settle(record, 'rejected', { error: known.error })
                .catch((failure) =>
                  console.error(
                    '[Abele node tools] Could not retain mutation rejection',
                    record.operation_id,
                    failure
                  )
                )
              return answer(
                { operation_id: record.operation_id, state: 'rejected', error: known.error },
                { operation_id: record.operation_id, state: 'rejected' }
              )
            }
            await mutation!.store
              .settle(record, 'outcome_unknown')
              .catch((failure) =>
                console.error(
                  '[Abele node tools] Could not retain mutation outcome',
                  record.operation_id,
                  failure
                )
              )
            return pendingMutation(record, 'outcome_unknown')
          }
        }
        if (mutation.retry) return perform(mutation.retry)
        const reserve = async (
          request: { method: string; params: unknown },
          before: string,
          after: string
        ) => {
          guard()
          return mutation!.store.reserve({
            key: mutation!.key,
            chat_id: mutation!.chat,
            call_id: _id,
            principal,
            tool: name as NodeMutationRecord['tool'],
            request,
            before,
            after,
          })
        }
        const sourcePath = fileSchema.parse(
          NODE_FILE_OPERATIONS.includes(name) ? text(params, 'from', path) : path
        )
        const expected = z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .nullable()
          .parse(params.expected_content_id)
        const before =
          name === 'node_write' && expected === null
            ? { text: '', content_id: null }
            : await read(sourcePath)
        if (before.content_id !== expected)
          throw new Error('File content changed; repeat node_read before editing')
        if (NODE_FILE_OPERATIONS.includes(name)) {
          if (!expected) throw new Error('File operations require an exact source content identity')
          const method =
            name === 'node_mv' ? 'fileMove' : name === 'node_cp' ? 'fileCopy' : 'fileRemove'
          const request = {
            ...(git ? { worktree_id: id } : { workspace_id: id }),
            ...(name === 'node_rm'
              ? { path: sourcePath }
              : { from: sourcePath, to: fileSchema.parse(text(params, 'to')) }),
            expected_content_id: expected,
          }
          // Unsupported actions fail before durable admission, without a shell fallback.
          await nodePathMethod(client, method, safe)
          const suffix = name === 'node_mv' ? 'move' : name === 'node_cp' ? 'copy' : 'remove'
          return perform(
            await reserve(
              { method: `${git ? 'repository.v1' : 'workspace'}.file.${suffix}`, params: request },
              name === 'node_cp' ? '' : before.text,
              name === 'node_rm' ? '' : before.text
            )
          )
        }
        let after = name === 'node_write' ? z.string().parse(params.text) : ''
        if (name !== 'node_write') {
          const old = z.string().min(1).parse(params.old_text),
            replacement = z.string().parse(params.new_text)
          const parts = before.text.split(old),
            count = parts.length - 1
          if (!count || (name === 'node_edit' && count !== 1))
            throw new Error(
              'Edit text must match exactly; node_edit requires one unique occurrence'
            )
          after = parts.join(replacement)
        }
        const request = git
          ? protocol.RepositoryWriteSchema.parse({
              worktree_id: id,
              path: sourcePath,
              expected_content_id: expected,
              text: after,
            })
          : protocol.FileWriteSchema.parse({
              workspace_id: id,
              path: sourcePath,
              expected_content_id: expected,
              text: after,
            })
        return perform(
          await reserve(
            { method: git ? 'repository.v1.write' : 'workspace.write', params: request },
            before.text,
            after
          )
        )
      }
      throw new Error('Unsupported node tool')
    },
  }))
}

/** New file RPCs are supplied by the versioned NodePathClient, never synthesized with shell or raw owner RPCs. */
async function nodePathCall<T>(
  client: NodeClient,
  method: string,
  params: unknown,
  safe: <V>(work: () => Promise<V>) => Promise<V>
): Promise<T> {
  const fn = await nodePathMethod(client, method, safe)
  return safe(() => fn(params) as Promise<T>)
}
async function nodePathMethod(
  client: NodeClient,
  method: string,
  safe: <V>(work: () => Promise<V>) => Promise<V>
): Promise<(params: unknown, operation?: string) => Promise<unknown>> {
  const adapter = (client as unknown as { nodePath?: Record<string, unknown> }).nodePath
  const fn = adapter?.[method]
  if (typeof fn !== 'function')
    throw new Error(`This node client does not support ${method}; update the node and plugin`)
  const capability = method === 'search' ? 'node_path_v2' : 'node_path_file_operations'
  if (!supportsCapability(await safe(() => client.describe()), capability))
    throw new Error(`This node does not support ${capability}; update the node`)
  return (params, operation) => fn.call(adapter, params, operation) as Promise<unknown>
}

function supportsCapability(raw: unknown, name: string): boolean {
  if (!raw || typeof raw !== 'object' || !('capabilities' in raw)) return false
  const node = raw.capabilities
  if (!node || typeof node !== 'object' || !('capabilities' in node)) return false
  const flags = node.capabilities
  if (!flags || typeof flags !== 'object') return false
  const capability = protocol.CapabilitySchema.safeParse(Reflect.get(flags, name))
  return capability.success && capability.data.status === 'supported'
}

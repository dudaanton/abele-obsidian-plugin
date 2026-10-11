import type { NodeClient, RepositoryRevision } from '@abele/node-client'
import * as protocol from '@abele/node-protocol'
import { z } from 'zod'
import { sha256 } from '@noble/hashes/sha2'
import { bytesToHex } from '@noble/hashes/utils'
const contentHash = (value: string) => bytesToHex(sha256(new TextEncoder().encode(value)))
import type { AgentTool, AgentToolResult } from '../../client'
import type { ChatSession } from '../../ChatSession'
import { readNodeText } from '@/node/NodeFilesModel'
import {
  type NodeScopeLedger,
  type NodeScopeTarget,
  type NodeScopeChat,
  nodeScopeEntries,
  nodeTargetId,
  coversNodeScope,
  NodeScopeTargetSchema,
} from '../../nodeScope'

export const NODE_EDIT_TOOLS = ['node_edit', 'node_replace', 'node_write']
export const NODE_FILE_OPERATIONS = ['node_mv', 'node_cp', 'node_rm']
export const NODE_MUTATION_TOOLS = [...NODE_EDIT_TOOLS, ...NODE_FILE_OPERATIONS]
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
]
export interface NodeAgentConnection {
  client: NodeClient
  /** Stable installation/pin and owner-controller generation, never a display label. */
  principal(): string
}
export interface NodeAgentHost {
  ledger: NodeScopeLedger
  nodes(): { id: string; label: string; node_id?: string }[]
  /** Registry aliases are device-local; persisted scope uses the stable daemon ID. */
  nodeId?(id: string): string
  connection(node: string, chat?: NodeScopeChat): NodeAgentConnection
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
const targetOf = (session: NodeScopeChat, params: Record<string, unknown>): NodeScopeTarget => {
  if (!params.node && !params.project && !params.workspace) {
    const selected = session.overrides.value.nodeTarget
    if (selected) {
      const parsed = NodeScopeTargetSchema.parse(selected)
      if (!parsed.target) throw new Error('The selected chat node target is missing')
      return { ...parsed, target: parsed.target }
    }
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
    for (let page = 0; page < 64; page++) {
      guard()
      const result = await client.repository.worktrees({
        project_id: target.project_id,
        cursor,
        limit: 256,
      })
      guard()
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
    throw new Error('The selected worktree is not in this registered project')
  }
}

type Pending = {
  host: NodeAgentHost
  session: ChatSession
  tool: string
  guard(): void
  text: string
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
    if (!entry.text) return answer(shown)
    while (pending.size >= 16) pending.delete(pending.keys().next().value!)
    const cursor = crypto.randomUUID()
    pending.set(cursor, entry)
    return answer(`${shown}\n\nResult continues. Call ${entry.tool} with cursor: ${cursor}`, {
      cursor,
    })
  }
  return NODE_AGENT_TOOL_NAMES.map((name) => ({
    name,
    label: name.replaceAll('_', ' '),
    category: 'Node files',
    description: `${name}: files on registered node folders/worktrees allowed by this chat's locally approved node scope. Opaque node/project/workspace IDs only; target_kind is worktree (Git) or workspace (plain folder). Omit all IDs to use this chat's selected target. Read continuations use cursor alone. Writes act immediately, use exact expected_content_id (SHA-256 from node_read; null for exclusive creation), and follow the chat file-edit permission mode. node_edit replaces one unique old_text with new_text; node_replace replaces all exact old_text matches. node_write uses complete text. Moves/copies/removal are single regular files, same target, destination absent. No shell, staging, commits, push, owner settings or automatic retries.`,
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
    },
    execute: async (_id, raw, signal, ctx) => {
      const session = ctx?.session
      if (!session) throw new Error('An executing Obsidian chat is required')
      const params = structuredClone(raw)
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
        pending.delete(cursor)
        return page(entry)
      }
      const host = await factory()
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
        return page({ host, session, tool: name, guard, text: value, expires: Date.now() + 600000 })
      }
      const scopes = nodeScopeEntries(session)
      const admittedConnection = (node: string) => {
        if (!scopes.some((entry) => entry.node_id === node))
          throw new Error('This node is not in chat scope')
        const connection = host.connection(node, session),
          principal = connection.principal()
        checks.push(host.ledger.guardNode(session, node, principal))
        const identity = session.nodeScopeIdentity,
          conversation = session.conversationVersion.value,
          branch = session.branchSelectionVersion
        const scope = JSON.stringify(scopes)
        checks.push(() => {
          if (!connection.client.connected)
            throw new Error('Node offline; reconnect before agent file operations')
          if (
            principal !== connection.principal() ||
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
        const result = await work()
        guard()
        return result
      }
      if (name === 'node_nodes') {
        const result: unknown[] = []
        for (const node of host.nodes()) {
          const nodeId = host.nodeId?.(node.id) ?? node.id
          if (!scopes.some((entry) => entry.node_id === nodeId)) continue
          const connection = host.connection(node.id),
            principal = connection.principal()
          if (!host.ledger.approvedNode(session, nodeId, principal)) continue
          checks.push(host.ledger.guardNode(session, nodeId, principal))
          checks.push(() => {
            if (connection.principal() !== principal) throw new Error('Node identity changed')
          })
          if (!connection.client.connected) {
            result.push({ node: nodeId, label: node.label, connected: false })
            continue
          }
          admittedConnection(nodeId)
          await safe(() => connection.client.describe())
          result.push({ node: nodeId, label: node.label, connected: true })
        }
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
        const connection = admittedConnection(node)
        const scopes = host.ledger.approvedEntries(session, node, connection.principal())
        if (
          !scopes.some(
            (entry) =>
              entry.node_id === node && (entry.kind === 'node' || entry.project_id === project)
          )
        )
          throw new Error('Folder is outside node scope')
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
      const connection = admittedConnection(target.node_id),
        client = connection.client
      const id = nodeTargetId(target.target),
        git = target.target.kind === 'worktree'
      const access = NODE_MUTATION_TOOLS.includes(name) ? 'edit' : 'read'
      checks.push(host.ledger.guard(session, target, connection.principal(), access))
      // This chat's current selection is captured, never read from a human tab.
      const selection = JSON.stringify(session.overrides.value.nodeTarget)
      checks.push(() => {
        if (JSON.stringify(session.overrides.value.nodeTarget) !== selection)
          throw new Error('Chat node target changed during the operation')
      })
      await safe(() => validateNodeTarget(client, target, guard))
      const repo = client.repository
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
            return retain(
              await paged((cursor) => {
                const enriched = protocol.RepositoryMethodSchemas['repository.v1.status'].safeParse(
                  { ...request, cursor, include_change_details: true }
                )
                return repo.status(
                  supported && enriched.success ? enriched.data : { ...request, cursor }
                )
              })
            )
          }
          case 'node_git_branches':
            return retain(await paged((cursor) => repo.refs({ worktree_id: id, cursor })))
          case 'node_git_log':
            return retain(
              await paged((cursor) =>
                repo.history({ ...request, cursor, ...(path ? { path } : {}) })
              )
            )
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
        if (params.ref || params.base)
          throw new Error('Node writes only operate on current working files')
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
          const result = await nodePathCall(client, method, request, safe)
          const applied =
            typeof result === 'object' &&
            result !== null &&
            'state' in result &&
            result.state === 'applied'
          return answer(
            result,
            applied
              ? {
                  diff: {
                    old: name === 'node_cp' ? '' : before.text,
                    new: name === 'node_rm' ? '' : before.text,
                  },
                  state: 'applied',
                }
              : undefined
          )
        }
        let after = text(params, 'text')
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
        guard()
        // No offline admission and no automatic second-ID retry on uncertain effects.
        const operation = await safe(() =>
          git
            ? repo.write(request as protocol.RepositoryParams<'repository.v1.write'>)
            : client.writeFile(request as protocol.FileWrite)
        )
        const receipt = git
          ? await safe(() => repo.mutationResult(operation.operation_id))
          : await safe(() => client.fileMutationResult(operation.operation_id))
        if (!receipt)
          return answer('Node write receipt is pending; do not retry with a new operation ID.', {
            operation_id: operation.operation_id,
            state: 'pending',
            before: before.text,
            after,
          })
        if (
          receipt.operation_id !== operation.operation_id ||
          receipt.path !== sourcePath ||
          receipt.expected_content_id !== expected ||
          (git
            ? !('worktree_id' in receipt) || receipt.worktree_id !== id
            : !('workspace_id' in receipt) || receipt.workspace_id !== id)
        )
          throw new Error('Node write receipt does not match the approved operation')
        if (receipt.state === 'saved' && receipt.content_id !== contentHash(after))
          throw new Error('Saved receipt content does not match the proposed text')
        console.debug('[Abele node tools] Write receipt', receipt.operation_id, receipt.state)
        return answer(receipt, {
          ...receipt,
          ...(receipt.state === 'saved'
            ? { diff: { old: before.text, new: after } }
            : { before: before.text, after }),
        })
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
  const adapter = (client as unknown as { nodePath?: Record<string, unknown> }).nodePath
  const fn = adapter?.[method]
  if (typeof fn !== 'function')
    throw new Error(`This node client does not support ${method}; update the node and plugin`)
  const capability = method === 'search' ? 'node_path_v2' : 'node_path_file_operations'
  if (!supportsCapability(await safe(() => client.describe()), capability))
    throw new Error(`This node does not support ${capability}; update the node`)
  return safe(() => fn.call(adapter, params) as Promise<T>)
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

import type { AgentTool, AgentToolResult } from '../../client'
import type { ChatSession } from '../../ChatSession'
import type { RepositorySource, RepositoryIdentity, RepositoryTarget } from '@/repository/source'

export type RepositoryReadApproval = (
  target: Extract<RepositoryIdentity, { provider: 'node' }>,
  signal?: AbortSignal
) => Promise<boolean>

export interface NodeOpenRevision {
  ref: string
  base?: string
  commit?: string
  lines?: { start: number; end: number }
}

/** Part A attaches guarded repository sources and its shared, tab-reusing opener here. */
export interface NodeRepositoryTab {
  source: RepositorySource
  /** Shared owner/controller generation across a project's workspaces; fallback pins the source namespace. */
  authority?: string
  /** Current location/revision, supplied by the repository view for node_views. */
  target?(): RepositoryTarget
  selection(): unknown
  open(
    node: string,
    project: string,
    workspace: string,
    path?: string,
    revision?: NodeOpenRevision
  ): void | Promise<void>
}

type Grant = { conversation: number; principals: Set<string> }
type Pending = {
  session: ChatSession
  branchSelectionVersion: number
  tool: string
  tab?: NodeRepositoryTab
  guard(): void
  text: string
  expires: number
}

/** Ephemeral owner grants: never derived from tool approval, delegation, or an open tab. */
export class NodeRepositoryToolsHost {
  readonly tabs = new Set<NodeRepositoryTab>()
  private grants = new WeakMap<ChatSession, Map<string, Grant>>()
  private epochs = new WeakMap<ChatSession, Map<string, object>>()
  private key(node: string, project: string) {
    return JSON.stringify([node, project])
  }
  private principal(tab: NodeRepositoryTab): string {
    const i = tab.source.identity
    return JSON.stringify([
      i.provider === 'node' ? i.installation : '',
      tab.authority ?? tab.source.cacheNamespace,
    ])
  }
  attach(tab: NodeRepositoryTab): () => void {
    if (tab.source.identity.provider !== 'node') throw new Error('Expected a node source')
    this.tabs.add(tab)
    return () => {
      this.tabs.delete(tab)
    }
  }
  /** Owner UI only; tool arguments and generic tool approvals cannot call this. */
  grant(
    session: ChatSession,
    node: string,
    project: string,
    approvedTab?: NodeRepositoryTab
  ): void {
    let grants = this.grants.get(session)
    if (!grants) this.grants.set(session, (grants = new Map()))
    const key = this.key(node, project)
    const conversation = session.conversationVersion?.value ?? 0
    if (approvedTab || grants.get(key)?.conversation !== conversation)
      grants.set(key, {
        conversation,
        principals: new Set(
          (approvedTab ? [approvedTab] : [...this.tabs]).flatMap((t) => {
            const i = t.source.identity
            return i.provider === 'node' && i.node === node && i.project === project
              ? [this.principal(t)]
              : []
          })
        ),
      })
  }
  revoke(session: ChatSession, node: string, project: string): void {
    this.grants.get(session)?.delete(this.key(node, project))
    this.epochMap(session).set(this.key(node, project), {})
  }
  revokeAll(session: ChatSession): void {
    this.grants.delete(session)
    this.epochs.delete(session)
  }
  private epochMap(session: ChatSession): Map<string, object> {
    let map = this.epochs.get(session)
    if (!map) this.epochs.set(session, (map = new Map()))
    return map
  }
  async request(
    session: ChatSession,
    tab: NodeRepositoryTab,
    approve: RepositoryReadApproval,
    signal?: AbortSignal
  ): Promise<void> {
    const identity = { ...tab.source.identity }
    if (identity.provider !== 'node') throw new Error('Expected a node source')
    const key = this.key(identity.node, identity.project),
      epochs = this.epochMap(session)
    if (!epochs.has(key)) epochs.set(key, {})
    const epoch = epochs.get(key),
      conversation = session.conversationVersion?.value ?? 0,
      namespace = tab.source.cacheNamespace
    tab.source.assertCurrent()
    if (!(await approve(identity, signal)))
      throw new Error('Owner repository read grant was denied')
    signal?.throwIfAborted()
    if (
      conversation !== (session.conversationVersion?.value ?? 0) ||
      epoch !== epochs.get(key) ||
      this.epochMap(session) !== epochs ||
      !this.tabs.has(tab) ||
      namespace !== tab.source.cacheNamespace ||
      JSON.stringify(identity) !== JSON.stringify(tab.source.identity)
    )
      throw new Error('Repository read approval changed while waiting')
    tab.source.assertCurrent()
    this.grant(session, identity.node, identity.project, tab)
  }
  authorized(session: ChatSession, tab: NodeRepositoryTab): boolean {
    const i = tab.source.identity
    const grant =
      i.provider === 'node' ? this.grants.get(session)?.get(this.key(i.node, i.project)) : undefined
    return (
      i.provider === 'node' &&
      !!grant &&
      grant.conversation === (session.conversationVersion?.value ?? 0) &&
      grant.principals.has(this.principal(tab))
    )
  }
  guard(session: ChatSession, tab: NodeRepositoryTab): () => void {
    const i = tab.source.identity
    if (i.provider !== 'node') throw new Error('Expected a node source')
    const key = this.key(i.node, i.project)
    const grant = this.grants.get(session)?.get(key)
    const namespace = tab.source.cacheNamespace
    const identity = JSON.stringify(i)
    const check = () => {
      if (!grant || this.grants.get(session)?.get(key) !== grant || !this.authorized(session, tab))
        throw new Error('Owner repository read grant is missing or revoked for this chat/project')
      if (
        !this.tabs.has(tab) ||
        namespace !== tab.source.cacheNamespace ||
        identity !== JSON.stringify(tab.source.identity)
      )
        throw new Error('Repository source changed; repeat the read')
      tab.source.assertCurrent()
    }
    check()
    return check
  }
}

export const nodeRepositoryToolsHost = new NodeRepositoryToolsHost()
const continuations = new WeakMap<NodeRepositoryToolsHost, Map<string, Pending>>()
const names = [
  'views',
  'worktrees',
  'read',
  'tree',
  'file',
  'changes',
  'commits',
  'commit',
  'compare',
  'search',
  'grep',
  'blame',
  'open',
] as const
const string = (p: Record<string, unknown>, key: string, fallback = ''): string => {
  if (p[key] === undefined) return fallback
  if (typeof p[key] !== 'string') throw new Error(`${key} must be a string`)
  return p[key]
}

/** Results retain exact bytes per invocation, with no cross-chat or authority cache reuse. */
export function createNodeTools(
  host = nodeRepositoryToolsHost,
  approve?: RepositoryReadApproval
): AgentTool[] {
  let pending = continuations.get(host)
  if (!pending) continuations.set(host, (pending = new Map()))
  const answer = (text: string, details?: unknown): AgentToolResult => ({
    content: [{ type: 'text', text }],
    details,
  })
  const page = (entry: Pending): AgentToolResult => {
    entry.guard()
    if (entry.branchSelectionVersion !== (entry.session.branchSelectionVersion ?? 0)) {
      entry.text = ''
      return answer('The chat branch changed; start the read again.')
    }
    // 24 KiB payload leaves ample room for the note and continuation envelope.
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
    const cursor = crypto.randomUUID()
    pending.set(cursor, entry)
    return answer(
      `${shown}\n\nRemaining result omitted from this call. Continue with the same tool and cursor: ${cursor}`,
      { cursor }
    )
  }
  return names.map(
    (kind): AgentTool => ({
      name: kind === 'worktrees' ? 'list_node_worktrees' : `node_${kind}`,
      label: `Node repository ${kind}`,
      category: 'Node repositories',
      description: `Read-only node repository ${kind}. Requires an owner grant for the executing chat and project. Use opaque node/project/workspace IDs; revision defaults to the working tree. Continuations use cursor alone. ${kind === 'search' ? 'Mode code or path; query, regex, case_sensitive and glob select matches.' : ''}`,
      parameters: {
        type: 'object',
        properties: {
          ...Object.fromEntries(
            [
              'node',
              'project',
              'workspace',
              'path',
              'revision',
              'base',
              'query',
              'glob',
              'cursor',
              'mode',
              'commit',
            ].map((key) => [key, { type: 'string' }])
          ),
          regex: { type: 'boolean' },
          case_sensitive: { type: 'boolean' },
          start_line: { type: 'integer', minimum: 1 },
          end_line: { type: 'integer', minimum: 1 },
        },
      },
      execute: async (_id, p, signal, ctx) => {
        // Only the executing context supplies identity; no active-tab/session fallback.
        const session = ctx?.session
        if (!session) throw new Error('An executing chat is required for a repository read grant')
        const branchSelectionVersion = session.branchSelectionVersion ?? 0
        signal?.throwIfAborted()
        for (const [key, entry] of pending) if (entry.expires <= Date.now()) pending.delete(key)
        const cursor = string(p, 'cursor')
        if (cursor) {
          const entry = pending.get(cursor)
          if (!entry || entry.session !== session || entry.tool !== kind)
            throw new Error('Continuation is expired or belongs to another chat/tool')
          entry.guard()
          pending.delete(cursor)
          return page(entry)
        }
        const checks: (() => void)[] = []
        const accessGuard = () => checks.forEach((check) => check())
        const guard = () => {
          if (signal?.aborted) throw new Error('Repository read cancelled')
          accessGuard()
        }
        let result: unknown, tab: NodeRepositoryTab | undefined
        if (kind === 'views') {
          result = [...host.tabs]
            .filter((t) => host.authorized(session, t))
            .map((t) => {
              const check = host.guard(session, t)
              checks.push(check)
              const target = t.target?.()
              check()
              return { source: t.source.identity, target, selection: t.selection() }
            })
        } else {
          const node = string(p, 'node'),
            project = string(p, 'project'),
            workspace = string(p, 'workspace')
          tab = [...host.tabs].find((t) => {
            const i = t.source.identity
            return (
              i.provider === 'node' &&
              i.node === node &&
              i.project === project &&
              i.workspace === workspace
            )
          })
          if (!tab) throw new Error('No repository source is available for these IDs')
          if (!host.authorized(session, tab) && approve && ctx.interactive)
            await host.request(session, tab, approve, signal)
          checks.push(host.guard(session, tab))
          guard()
          const s = new Proxy(tab.source, {
              get(target, key) {
                const value = Reflect.get(target, key)
                if (typeof value !== 'function') return value
                return async (...args: unknown[]) => {
                  guard()
                  const result: unknown = await value.apply(target, args)
                  guard()
                  return result
                }
              },
            }),
            ref = string(p, 'revision', 'WORKTREE'),
            path = string(p, 'path')
          if (
            path.startsWith('/') ||
            path.includes('\\') ||
            path.split('/').some((part) => part === '..' || part.toLowerCase() === '.git') ||
            /^[a-z]:/i.test(path) ||
            path.includes('\0')
          )
            throw new Error('Use a relative repository path without traversal')
          switch (kind) {
            case 'worktrees':
              result = await s.workspaces()
              break
            case 'read':
              result = { overview: await s.home(ref), workspaces: await s.workspaces() }
              break
            case 'tree':
              result = await s.folder(ref, path)
              break
            case 'file':
              result = await s.text(ref, path)
              if (p.start_line !== undefined || p.end_line !== undefined) {
                const start = p.start_line ?? 1,
                  end = p.end_line
                if (
                  !Number.isInteger(start) ||
                  (start as number) < 1 ||
                  (end !== undefined &&
                    (!Number.isInteger(end) || (end as number) < (start as number)))
                )
                  throw new Error('Invalid line range')
                result = (result as string)
                  .split('\n')
                  .slice((start as number) - 1, end as number | undefined)
                  .join('\n')
              }
              break
            case 'changes':
              result = path
                ? await s.comparisonFile(await s.comparison(string(p, 'base', 'HEAD'), ref), path)
                : {
                    status: await s.status(),
                    comparison: await s.compare(string(p, 'base', 'HEAD'), ref, true),
                  }
              break
            case 'commits':
              result = await s.commits(ref, path || undefined)
              break
            case 'commit':
              result = await s.commit(ref)
              break
            case 'compare':
              result = await s.compare(string(p, 'base') || undefined, ref, true)
              break
            case 'blame':
              result = await s.blame(ref, path)
              break
            case 'search':
            case 'grep':
              if (p.mode !== undefined && !['code', 'path'].includes(string(p, 'mode')))
                throw new Error('Search mode must be code or path')
              result = await s.search({
                ref,
                scope: p.mode === 'path' ? 'names' : 'repo',
                query: {
                  text: string(p, 'query'),
                  regex: p.regex === true,
                  caseSensitive: p.case_sensitive === true,
                },
                glob: string(p, 'glob'),
                limitBytes: 32768,
                signal,
              })
              break
            case 'open': {
              const start = p.start_line,
                end = p.end_line ?? start
              if (
                start !== undefined &&
                (!Number.isInteger(start) ||
                  (start as number) < 1 ||
                  !Number.isInteger(end) ||
                  (end as number) < (start as number))
              )
                throw new Error('Invalid line range')
              guard()
              await tab.open(node, project, workspace, path || undefined, {
                ref,
                ...(p.commit ? { commit: string(p, 'commit') } : {}),
                ...(p.base ? { base: string(p, 'base') } : {}),
                ...(start !== undefined
                  ? { lines: { start: start as number, end: end as number } }
                  : {}),
              })
              result = 'Repository tab opened'
              break
            }
          }
        }
        guard()
        const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2)
        if (new TextEncoder().encode(text).length > 4 * 1024 * 1024)
          throw new Error('Result exceeds retained continuation limit; narrow the read')
        while (pending.size >= 16) {
          const oldest = pending.keys().next().value
          if (oldest === undefined) break
          pending.delete(oldest)
        }
        return page({
          session,
          branchSelectionVersion,
          tool: kind,
          tab,
          guard: accessGuard,
          text,
          expires: Date.now() + 600000,
        })
      },
    })
  )
}

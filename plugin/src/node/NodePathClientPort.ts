import { responseSchema } from '@abele/channel-protocol'
import { readWithIgnoredFallback } from './ignoredRead'
import { uiErrorMessage, UiError, uiMessage } from '@/i18n/streamBErrors'

import type { NodeClient } from '@abele/node-client'
import { sessionActivity } from './sessionActivity'
import { searchNodePathCode } from './NodePathSearch'
import { worktreeDisplayPath } from './worktreePresentation'
import { nodeAdvertisesMethod } from './advertisedMethods'
import { ChannelError } from '@abele/channel-protocol'
import { bindPathTarget } from './nodePathChat'
import { supportsExpectedTarget } from './expectedTarget'
import {
  RepositoryChangeBatchSchema,
  RepositoryBlobSchema,
  WorkspaceChangeBatchSchema,
  type RepositoryChangeBatch,
  type WorkspaceChangeBatch,
  type RepositoryChangesCursor,
  type RepositoryRevision,
  type WorktreeEntry,
} from '@abele/node-protocol'
import type { PathTreeBatch } from './nodePathChanges'
import type { BranchState, CommitSummary, FileChange, TreeEntry } from '@/components/nodeWork/types'
import { formatTimestamp } from '@/helpers/displayFormat'
import { shortRef } from './presentation'
import { nodePages } from './nodePages'
import { readNodeText } from './NodeFilesModel'
import { COMMIT_FILE_READS, eachBounded } from './bounded'
import { readNodeImage, isNodeImagePath, NODE_IMAGE_MAX_BYTES } from './nodeImagePreview'
import { GIT_WRITE_CAPABILITY, nodePathGit, type NodeGitClient, type PathGit } from './nodePathGit'
import type { PathForge } from './nodePathForge'
import type {
  NewPull,
  PathPulls,
  NodePathPort,
  PathCatalogue,
  PathChange,
  PathDocument,
  PathFileStage,
  PathBranch,
  PathInspection,
  PathTarget,
  PathTreePage,
  KnownPathRead,
} from './NodePathModel'

type ReadClient = Pick<
  NodeClient,
  | 'repository'
  | 'nodePath'
  | 'describe'
  | 'listProjects'
  | 'listSessions'
  | 'listWorkspaces'
  | 'listFiles'
  | 'readFile'
  | 'readContent'
  | 'onEvent'
  | 'subscribe'
  | 'store'
> &
  Partial<Pick<NodeClient, 'request'>>
export async function pathPages<T>(
  read: (
    cursor?: string
  ) => Promise<{ entries: T[]; cursor: string | null; incomplete: boolean; omissions: string[] }>
): Promise<T[]> {
  const entries: T[] = [],
    visited = new Set<string>()
  let cursor: string | undefined
  for (;;) {
    const page = await read(cursor)
    if (page.incomplete)
      throw new UiError(
        page.omissions.join(' · ')
          ? uiErrorMessage(new Error(page.omissions.join(' · ')))
          : uiMessage('streamBError.e12006025a')
      )
    entries.push(...page.entries)
    if (!page.cursor) return entries
    if (visited.has(page.cursor)) throw new UiError(uiMessage('streamBError.fd3e95b2aa'))
    visited.add(page.cursor)
    cursor = page.cursor
  }
}
const branchName = (name: string | null) => name?.replace(/^refs\/heads\//, '') ?? 'Detached'
const changeKind = (status: string): FileChange['kind'] =>
  status.startsWith('A')
    ? 'added'
    : status.startsWith('D')
      ? 'deleted'
      : status.startsWith('R')
        ? 'renamed'
        : 'modified'
export function pathStatus(
  entry: Awaited<ReturnType<NodeClient['repository']['status']>>['entries'][number]
): PathChange {
  const conflict =
    entry.index === 'U' ||
    entry.worktree === 'U' ||
    ['AA', 'DD'].includes(entry.index + entry.worktree)
  const staged = ![' ', '?', '!'].includes(entry.index)
  const unstaged = ![' ', '!'].includes(entry.worktree)
  const kind: FileChange['kind'] = conflict
    ? 'conflict'
    : entry.index + entry.worktree === '??' || entry.index === 'A'
      ? 'added'
      : entry.index === 'R' || entry.worktree === 'R'
        ? 'renamed'
        : entry.index === 'D' || entry.worktree === 'D'
          ? 'deleted'
          : 'modified'
  return {
    path: entry.path,
    kind,
    stage: conflict ? 'unstaged' : staged && unstaged ? 'partly' : staged ? 'staged' : 'unstaged',
    from: entry.original_path,
    ...('change_id' in entry
      ? { changeId: entry.change_id, when: `Observed ${formatTimestamp(entry.changed_at).label}` }
      : {}),
    before: '',
    after: '',
    added: 0,
    removed: 0,
  }
}
function commitSummary(
  commit: Awaited<ReturnType<NodeClient['repository']['commit']>>
): CommitSummary {
  const date = formatTimestamp(commit.authored_at)
  const [day, time] = date.label.split(', ')
  return {
    hash: commit.commit,
    subject: commit.subject,
    author: commit.author,
    day,
    when: time ?? date.label,
  }
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
export function supportedNodePathCapabilities(description: unknown): string[] {
  const capabilities = record(record(record(description).capabilities).capabilities)
  return Object.entries(capabilities)
    .filter(([, value]) => record(value).status === 'supported')
    .map(([name]) => name)
}

/** Schema-validated node reads; enriched fields are explicitly capability-gated. */
export class NodePathClientPort implements NodePathPort {
  protected worktrees = new Map<string, WorktreeEntry>()
  protected capabilities: string[] = []
  private subscribedSessions = new Set<string>()
  private description?: ReturnType<ReadClient['describe']>
  private treeReads = 0
  private treeQueue: (() => void)[] = []
  private interactiveReads = 0
  private resumeTrees: (() => void)[] = []
  private statusReads = new Map<string, ReturnType<NodePathClientPort['readStatus']>>()
  constructor(
    readonly client: ReadClient,
    readonly identity: { nodeId: string; registrationId: string },
    /** The git service a folder's remote lives on, for its pull requests. */
    private readonly forge?: PathForge
  ) {}
  invalidate(target?: PathTarget): void {
    if (target) {
      this.worktrees.delete(target.id)
      for (const key of this.statusReads.keys()) {
        const [nodeId, id] = JSON.parse(key) as [string, string]
        if (nodeId === target.nodeId && id === target.id) this.statusReads.delete(key)
      }
    } else {
      this.statusReads.clear()
      this.worktrees.clear()
      this.subscribedSessions.clear()
      this.description = undefined
    }
  }
  /** Git writes, once the node says it has them and its client speaks them. */
  get git(): PathGit | undefined {
    const git = (this.client.repository as unknown as { git?: NodeGitClient }).git
    return git && this.capabilities.includes(GIT_WRITE_CAPABILITY) ? nodePathGit(git) : undefined
  }
  private forgePulls = new Map<string, { at: number; read: ReturnType<PathForge['pulls']> }>()
  /** A service's open pull requests, read at most once a minute: every save observes anew. */
  private readPulls(repo: Parameters<PathForge['pulls']>[0]): ReturnType<PathForge['pulls']> {
    const key = `${this.forge!.cacheKey?.(repo) ?? repo.kind}:${repo.deployment ?? repo.host}/${repo.owner}/${repo.name}`,
      known = this.forgePulls.get(key)
    if (known && Date.now() - known.at < 60000) return known.read
    const read = this.forge!.pulls(repo)
    this.forgePulls.set(key, { at: Date.now(), read })
    read.catch(() => this.forgePulls.delete(key))
    return read
  }
  /** Pull requests come from the remote's git service, which only the node's git can name. */
  get pulls(): ((target: PathTarget) => Promise<PathPulls>) | undefined {
    const git = this.git,
      forge = this.forge
    if (!git || !forge) return undefined
    return async (target) => {
      const info = await git.info(target)
      if (!info.forge) return { remote: null, connected: false, pulls: [] }
      const read = await this.readPulls(info.forge)
      return { remote: `${info.forge.owner}/${info.forge.name}`, ...read }
    }
  }
  get createPull():
    | ((target: PathTarget, pull: NewPull) => Promise<{ number: number; url?: string }>)
    | undefined {
    const git = this.git,
      forge = this.forge
    if (!git || !forge) return undefined
    return async (target, pull) => {
      const info = await git.info(target)
      if (!info.forge) throw new UiError(uiMessage('streamBError.91f21e6d95'))
      if (!info.branch) throw new UiError(uiMessage('streamBError.474dc449ab'))
      const made = await forge.create(info.forge, { ...pull, head: info.branch })
      this.forgePulls.clear()
      return made
    }
  }
  protected binding(projectId: string, kind: PathTarget['kind'], id: string): PathTarget {
    return { ...this.identity, projectId, kind, id }
  }
  private describe(refresh = false): ReturnType<ReadClient['describe']> {
    if (refresh) this.description = undefined
    return (this.description ??= this.client
      .describe()
      .then((description) => {
        this.capabilities = supportedNodePathCapabilities(description)
        return description
      })
      .catch((error: unknown) => {
        this.description = undefined
        throw error
      }))
  }
  private readonly workspaceCatalogues = new Map<
    string,
    Awaited<ReturnType<ReadClient['listWorkspaces']>>
  >()
  async catalogue(capabilities?: (capabilities: string[]) => void): Promise<PathCatalogue> {
    const description = await this.describe(true)
    capabilities?.([...this.capabilities])
    const guarded = supportsExpectedTarget(description)
    const enriched = this.capabilities.includes('node_path_v2')
    const [projects, sessions] = await Promise.all([
      nodePages(
        (after) => this.client.listProjects(after),
        (p) => p.project_id
      ),
      nodePages(
        (after) => this.client.listSessions(after),
        (s) => s.session_id
      ),
    ])
    const targets: PathTarget[] = [],
      workspaceTargets = new Map<string, PathTarget>()
    const folders: PathCatalogue['folders'] = []
    for (const project of projects) {
      let unavailable = false
      const workspaces = await nodePages(
        (after) => this.client.listWorkspaces(project.project_id, after),
        (w) => w.workspace_id
      ).catch((error: unknown) => {
        if (
          !project.repository_path ||
          !(error instanceof ChannelError) ||
          !['repository_unavailable', 'stale_resource'].includes(error.code)
        )
          throw error
        console.debug('[Abele] node path: registered workspace unavailable', project.project_id)
        unavailable = true
        return this.workspaceCatalogues.get(project.project_id) ?? []
      })
      if (!unavailable) this.workspaceCatalogues.set(project.project_id, workspaces)
      if (project.repository_path) {
        const rows = unavailable
          ? []
          : await pathPages((cursor) =>
              this.client.repository.worktrees({
                project_id: project.project_id,
                cursor,
                ...(enriched ? { include_selection: true } : {}),
                ...(nodeAdvertisesMethod(this.client, 'repository.v1.file.directory')
                  ? { include_identity: true }
                  : {}),
              })
            ).catch((error: unknown): WorktreeEntry[] => {
              // The project's fingerprint is checked before filesystem availability. A
              // removed .git can therefore refuse the entire catalogue as stale_resource.
              // This is not an obsolete worktree ID: choosing another row cannot repair it.
              if (
                !(error instanceof ChannelError) ||
                !['repository_unavailable', 'stale_resource'].includes(error.code)
              )
                throw error
              console.debug(
                '[Abele] node path: registered repository unavailable',
                project.project_id
              )
              unavailable = true
              return []
            })
        if (unavailable) {
          const root = workspaces.find((w) => w.kind === 'root' && w.state !== 'removed')
          if (root) targets.push(this.binding(project.project_id, 'workspace', root.workspace_id))
          folders.push({
            id: project.project_id,
            name: project.root_path.split('/').pop() || project.root_path,
            path: project.root_path,
            git: true,
            missing: true,
            copies: [],
          })
          continue
        }
        rows.sort((a, b) => Number(b.kind === 'root') - Number(a.kind === 'root'))
        const listed = rows.filter((w) =>
          enriched ? w.listed === true || w.kind === 'root' : w.kind !== 'external'
        )
        for (const row of rows) this.worktrees.set(row.worktree_id, row)
        for (const row of listed) {
          const target = this.binding(project.project_id, 'worktree', row.worktree_id)
          const workspace = workspaces.find((w) => w.workspace_id === row.workspace_id)
          const path =
            row.kind === 'root'
              ? project.root_path
              : (row.identity?.canonical_path ??
                workspace?.path ??
                (row.path_label.startsWith('/') ? row.path_label : undefined))
          if (path?.startsWith('/'))
            target.location = {
              root: project.root_path,
              path,
              kind: row.kind,
            }
          targets.push(target)
          if (row.workspace_id) workspaceTargets.set(row.workspace_id, target)
        }
        folders.push({
          id: project.project_id,
          name: project.root_path.split('/').pop() || project.root_path,
          path: project.root_path,
          git: true,
          copies: listed.map((w) => ({
            id: w.worktree_id,
            kind: w.kind === 'root' ? 'project' : w.detached ? 'detached' : 'worktree',
            branch: branchName(w.branch),
            path: worktreeDisplayPath(w.path_label, w.branch),
            changed: 0,
            missing: w.availability !== 'available',
          })),
        })
      } else {
        const root = workspaces.find((w) => w.kind === 'root' && w.state !== 'removed')
        if (root) {
          const target = this.binding(project.project_id, 'workspace', root.workspace_id)
          targets.push(target)
          workspaceTargets.set(root.workspace_id, target)
        }
        folders.push({
          id: project.project_id,
          name: project.root_path.split('/').pop() || project.root_path,
          path: project.root_path,
          git: false,
          copies: [],
        })
      }
    }
    const bound: PathCatalogue['sessions'] = []
    for (const session of sessions) {
      let target = session.workspace_id ? workspaceTargets.get(session.workspace_id) : undefined
      if (this.capabilities.includes('node_path_execution')) {
        try {
          const binding = await this.client.nodePath.sessionWorktreeGet({
            session_id: session.session_id,
            ...(guarded ? { include_incarnation: true } : {}),
          })
          target = {
            ...bindPathTarget(this.identity, binding.project_id, binding.target),
            ...(binding.incarnation ? { incarnation: binding.incarnation } : {}),
          }
        } catch (error) {
          if (
            !(
              error instanceof ChannelError &&
              ['workspace_required', 'stale_resource', 'repository_unavailable'].includes(
                error.code
              )
            )
          )
            throw error
          // A dead binding is unresolved, never rebound to a replacement worktree.
          target = undefined
        }
      }
      if (target && !this.subscribedSessions.has(session.session_id)) {
        await this.client.subscribe(session.session_id)
        this.subscribedSessions.add(session.session_id)
      }
      // Runs and a long-lived session's turns alike, and a question waiting for the owner.
      const activity = await this.client.store.transaction((state) =>
        sessionActivity(state.events[session.session_id] ?? [])
      )
      bound.push({ session, target, running: activity.running, activity })
    }
    return { folders, targets, capabilities: this.capabilities, sessions: bound }
  }
  async inspect(
    target: PathTarget,
    files = true,
    observed?: RepositoryRevision
  ): Promise<PathInspection> {
    if (target.kind === 'workspace')
      return { entries: files ? (await this.tree(target, '')).entries : [], changes: [] }
    const revision =
      observed ?? (await this.client.repository.observe({ worktree_id: target.id })).revision
    const status = await this.status(target, revision)
    const head = revision.kind === 'commit' ? revision.commit : revision.head
    const last = head
      ? (
          await this.client.repository.history({
            worktree_id: target.id,
            revision: { kind: 'commit', commit: head },
            limit: 1,
          })
        ).entries[0]
      : undefined
    return {
      revision,
      lastCommit: last
        ? `${last.subject} · ${formatTimestamp(last.authored_at).label}`
        : 'No commits yet',
      changes: status.map(pathStatus),
      entries: files ? (await this.tree(target, '', undefined, revision)).entries : [],
      ...(this.capabilities.includes('node_path_v2')
        ? await this.divergence(target)
        : { note: 'Change times and branch divergence require an updated node.' }),
    }
  }
  /**
   * Where the branch stands: its base (the default branch or the one chosen), how far apart they
   * are, the remote branch of the same name and what is not on it yet, and the files the branch
   * committed that its base does not have.
   */
  async branch(target: PathTarget, base?: string): Promise<PathBranch> {
    await this.describe()
    if (target.kind !== 'worktree' || !this.capabilities.includes('node_path_v2'))
      throw new UiError(uiMessage('streamBError.d4a2fc884b'))
    const own = this.worktrees.get(target.id)?.branch ?? null
    const name = own ? branchName(own) : null
    let [divergence, refs] = await Promise.all([
      this.client.nodePath.divergence({
        worktree_id: target.id,
        ...(base ? { base_ref: base } : {}),
      }),
      pathPages((cursor) => this.client.repository.refs({ worktree_id: target.id, cursor })),
    ])
    const remotes = name
      ? refs.filter((r) => /^refs\/remotes\/[^/]+\//.test(r.name) && r.name.endsWith(`/${name}`))
      : []
    // The remote branch of the same name, origin's first: how far the branch is pushed.
    const upstream = remotes.find((r) => r.name === `refs/remotes/origin/${name}`) ?? remotes[0]
    // The node's git names the real upstream and a rebase that stopped; without it, the remote
    // branch of the same name stands in for the upstream.
    const info = await this.git?.info(target)
    if (!base && !divergence.base_ref && divergence.reason === 'default_branch_required') {
      const rootBranch = [...this.worktrees.values()].find(
        (row) => row.project_id === target.projectId && row.kind === 'root'
      )?.branch
      const candidates = [
        info?.defaultBranch,
        refs.find((ref) => ref.name === 'refs/remotes/origin/HEAD')?.symbolic,
        rootBranch && rootBranch !== own ? `refs/heads/${branchName(rootBranch)}` : undefined,
        ...['main', 'master', 'trunk'].map((name) => `refs/heads/${name}`),
      ]
      const fallback = candidates.find(
        (candidate) => candidate && candidate !== own && refs.some((ref) => ref.name === candidate)
      )
      if (fallback)
        divergence = await this.client.nodePath.divergence({
          worktree_id: target.id,
          base_ref: fallback,
        })
    }
    const pr =
      info?.forge && info.branch && this.forge
        ? (await this.readPulls(info.forge).catch((): undefined => undefined))?.pulls.find(
            (p) => p.branch === info.branch
          )
        : undefined
    const pushed =
      !info && upstream
        ? await this.client.nodePath.divergence({ worktree_id: target.id, base_ref: upstream.name })
        : undefined
    const ahead = divergence.ahead ?? 0
    const committed =
      ahead && divergence.base_commit && divergence.head_commit
        ? (
            await pathPages((cursor) =>
              this.client.repository.compare({
                worktree_id: target.id,
                base: { kind: 'commit', commit: divergence.base_commit! },
                head: { kind: 'commit', commit: divergence.head_commit! },
                mode: 'merge-base',
                cursor,
              })
            )
          ).map(
            (entry): PathChange => ({
              path: entry.path,
              kind: changeKind(entry.status),
              before: '',
              after: '',
              added: 0,
              removed: 0,
            })
          )
        : []
    const state: BranchState = {
      ...(info ? { hasRemote: info.hasRemote } : {}),
      base: divergence.base_ref ? shortRef(divergence.base_ref) : null,
      ...(divergence.base_ref ? { baseRef: divergence.base_ref } : {}),
      ahead,
      behind: divergence.behind ?? 0,
      ...(info
        ? {
            ...(pr ? { pr } : {}),
            ...(info.upstream ? { upstream: shortRef(info.upstream.ref) } : {}),
            unpushed: info.upstream?.ahead ?? 0,
            ...(info.operation &&
            (info.operation.kind === 'rebase' || info.operation.kind === 'merge')
              ? {
                  stopped: {
                    kind: info.operation.kind,
                    onto: divergence.base_ref ? shortRef(divergence.base_ref) : '',
                    conflicts: info.operation.conflicts.length,
                  },
                }
              : {}),
          }
        : {
            ...(upstream ? { upstream: shortRef(upstream.name) } : {}),
            unpushed: pushed?.ahead ?? 0,
          }),
    }
    return {
      state,
      committed,
      refs: refs
        .filter((r) => !r.symbolic && r.name !== own && !r.name.endsWith('/HEAD'))
        .map((r) => r.name),
    }
  }
  async search(target: PathTarget, query: string): Promise<TreeEntry[]> {
    const rows =
      target.kind === 'worktree'
        ? await (async () => {
            const { revision } = await this.client.repository.observe({ worktree_id: target.id })
            return pathPages((cursor) =>
              this.client.repository.search({
                worktree_id: target.id,
                revision,
                query,
                mode: 'filename',
                scope: 'repository',
                case_sensitive: false,
                limit: 100,
                cursor,
              })
            )
          })()
        : await pathPages((cursor) =>
            this.client.nodePath.search({
              workspace_id: target.id,
              query,
              mode: 'filename',
              case_sensitive: false,
              limit: 100,
              cursor,
            })
          )
    return [...new Set(rows.map((row) => row.path))].map((path) => ({
      path,
      name: path.split('/').pop()!,
      kind: 'file',
    }))
  }
  searchCode(...args: Parameters<NonNullable<NodePathPort['searchCode']>>) {
    return searchNodePathCode(this.client, ...args)
  }
  protected status(target: PathTarget, revision: RepositoryRevision) {
    const key = JSON.stringify([target.nodeId, target.id, revision])
    const previous = this.statusReads.get(key)
    if (previous !== undefined) return previous
    const read = this.readStatus(target, revision).catch((error: unknown) => {
      this.statusReads.delete(key)
      throw error
    })
    this.statusReads.set(key, read)
    if (this.statusReads.size > 64) this.statusReads.delete(this.statusReads.keys().next().value)
    return read
  }
  private readStatus(target: PathTarget, revision: RepositoryRevision) {
    return pathPages((cursor) =>
      this.client.repository.status({
        worktree_id: target.id,
        revision,
        cursor,
        ...(this.capabilities.includes('node_path_v2') ? { include_change_details: true } : {}),
      })
    )
  }
  private async divergence(
    target: PathTarget
  ): Promise<Pick<PathInspection, 'ahead' | 'behind' | 'base' | 'note'>> {
    const result = await this.client.nodePath.divergence({ worktree_id: target.id })
    return {
      ahead: result.ahead ?? undefined,
      behind: result.behind ?? undefined,
      base: result.base_ref ?? undefined,
      ...(result.reason !== 'ok'
        ? {
            note:
              result.reason === 'default_branch_required'
                ? 'Choose the default branch in repository settings to compare divergence.'
                : 'No commits yet on one side of this comparison.',
          }
        : {}),
    }
  }
  /** Bound the recursive browser across concurrent refreshes, not just within one folder. */
  private async treeRead<T>(read: () => Promise<T>): Promise<T> {
    if (this.treeReads >= 4) await new Promise<void>((resolve) => this.treeQueue.push(resolve))
    else ++this.treeReads
    try {
      while (this.interactiveReads)
        await new Promise<void>((resolve) => this.resumeTrees.push(resolve))
      return await read()
    } finally {
      const next = this.treeQueue.shift()
      if (next) next()
      else --this.treeReads
    }
  }
  private async gitTree(
    id: string,
    revision: RepositoryRevision,
    path = '',
    budget = { count: 0 }
  ): Promise<TreeEntry[]> {
    const entries = await pathPages((cursor) =>
      this.treeRead(() => this.client.repository.tree({ worktree_id: id, revision, path, cursor }))
    )
    const out = await Promise.all(
      entries.map(async (entry): Promise<TreeEntry | undefined> => {
        if (++budget.count > 10000) throw new UiError(uiMessage('streamBError.6714d255c9'))
        if (entry.kind === 'file') return { path: entry.path, name: entry.name, kind: 'file' }
        if (entry.kind === 'directory')
          return {
            path: entry.path,
            name: entry.name,
            kind: 'folder',
            children: await this.gitTree(id, revision, entry.path, budget),
          }
      })
    )
    return out.filter((entry): entry is TreeEntry => entry !== undefined)
  }
  async tree(
    target: PathTarget,
    path = '',
    cursor?: string,
    observed?: RepositoryRevision
  ): Promise<PathTreePage> {
    const revision =
      target.kind === 'worktree'
        ? (observed ?? (await this.client.repository.observe({ worktree_id: target.id })).revision)
        : undefined
    const page =
      target.kind === 'worktree'
        ? await this.treeRead(() =>
            this.client.repository.tree({
              worktree_id: target.id,
              revision: revision!,
              path,
              cursor,
            })
          )
        : await this.treeRead(() => this.client.listFiles(target.id, path, cursor))
    if ('incomplete' in page && page.incomplete)
      throw new UiError(
        page.omissions.join(' · ')
          ? uiErrorMessage(new Error(page.omissions.join(' · ')))
          : uiMessage('streamBError.e12006025a')
      )
    return {
      revision,
      cursor: 'cursor' in page ? page.cursor : (page.next ?? null),
      entries: page.entries.flatMap((entry): TreeEntry[] =>
        entry.kind === 'file'
          ? [{ path: entry.path, name: entry.name, kind: 'file' }]
          : entry.kind === 'directory'
            ? [{ path: entry.path, name: entry.name, kind: 'folder' }]
            : []
      ),
    }
  }
  protected async gitText(target: PathTarget, revision: RepositoryRevision, path: string) {
    const blob = await this.client.repository.blob({ worktree_id: target.id, revision, path })
    return this.textBlob(target, blob)
  }
  private async textBlob(
    target: PathTarget,
    blob: Awaited<ReturnType<NodeClient['repository']['blob']>>
  ) {
    if (!blob.content_id || blob.binary || blob.requires_larger_load || blob.too_large)
      throw new UiError(
        blob.binary ? uiMessage('streamBError.3cdea71657') : uiMessage('streamBError.9ba095fdb1')
      )
    return {
      text: await readNodeText(
        (offset) =>
          this.client.repository.content({
            worktree_id: target.id,
            content_id: blob.content_id!,
            offset,
          }),
        1024 * 1024
      ),
      contentId: blob.content_id,
    }
  }
  private async commitText(
    target: PathTarget,
    revision: RepositoryRevision,
    path: string
  ): Promise<{ text: string; binary: boolean; previewNote?: string }> {
    const blob = await this.client.repository.blob({ worktree_id: target.id, revision, path })
    if (blob.binary) return { text: '', binary: true }
    if (blob.requires_larger_load || blob.too_large)
      return {
        text: '',
        binary: false,
        previewNote: 'This file needs an explicit larger load in the repository browser.',
      }
    return { ...(await this.textBlob(target, blob)), binary: false }
  }
  private async gitPreview(
    target: PathTarget,
    revision: RepositoryRevision,
    path: string
  ): Promise<Pick<PathDocument, 'text' | 'contentId' | 'image'>> {
    const blob = await this.client.repository.blob({ worktree_id: target.id, revision, path })
    return this.previewBlob(target, revision, path, blob)
  }
  private async previewBlob(
    target: PathTarget,
    revision: RepositoryRevision,
    path: string,
    blob: Awaited<ReturnType<NodeClient['repository']['blob']>>
  ): Promise<Pick<PathDocument, 'text' | 'contentId' | 'image'>> {
    if (isNodeImagePath(path)) {
      if (blob.size > NODE_IMAGE_MAX_BYTES || blob.too_large)
        throw new UiError(uiMessage('streamBError.b98a7f8f5f'))
      if (blob.requires_larger_load)
        blob = await this.client.repository.blob({
          worktree_id: target.id,
          revision,
          path,
          larger: true,
        })
    }
    if (!blob.binary) return this.textBlob(target, blob)
    return {
      text: '',
      contentId: blob.content_id,
      image: await readNodeImage(path, blob, (offset) =>
        this.client.repository.content({
          worktree_id: target.id,
          content_id: blob.content_id!,
          offset,
        })
      ),
    }
  }
  protected async patch(
    target: PathTarget,
    revision: RepositoryRevision,
    path: string,
    mode: 'staged' | 'unstaged'
  ): Promise<string> {
    if (revision.kind !== 'working') throw new UiError(uiMessage('streamBError.9bc23eb575'))
    if (!revision.head && !this.capabilities.includes('node_path_v2'))
      throw new UiError(uiMessage('streamBError.aecd43ae62'))
    const manifest = await this.client.repository.compare({
      worktree_id: target.id,
      base: revision.head ? { kind: 'commit', commit: revision.head } : { kind: 'empty' },
      head: revision,
      mode,
    })
    if (manifest.incomplete)
      throw new UiError(
        manifest.omissions.join(' · ')
          ? uiErrorMessage(new Error(manifest.omissions.join(' · ')))
          : uiMessage('streamBMeta.fdaefbc963')
      )
    const blob = await this.client.repository.patch({
      worktree_id: target.id,
      comparison_id: manifest.comparison_id,
      path,
    })
    if (!blob.content_id || blob.binary) throw new UiError(uiMessage('streamBError.8647963b04'))
    return readNodeText(
      (offset) =>
        this.client.repository.content({
          worktree_id: target.id,
          content_id: blob.content_id!,
          offset,
        }),
      8 * 1024 * 1024
    )
  }
  private async interactive<T>(read: () => Promise<T>): Promise<T> {
    ++this.interactiveReads
    try {
      return await read()
    } finally {
      if (!--this.interactiveReads) {
        const waiting = this.resumeTrees.splice(0)
        for (const resume of waiting) resume()
      }
    }
  }
  file(
    target: PathTarget,
    path: string,
    stage?: PathFileStage,
    frozen?: RepositoryRevision,
    known?: KnownPathRead
  ): Promise<PathDocument> {
    return this.interactive(() => this.readFile(target, path, stage, frozen, known))
  }
  private async readFile(
    target: PathTarget,
    path: string,
    stage?: PathFileStage,
    frozen?: RepositoryRevision,
    known?: KnownPathRead
  ): Promise<PathDocument> {
    if (typeof stage === 'object') return this.readCommittedFile(target, path, stage.base)
    if (target.kind === 'workspace') {
      const blob = await this.client.readFile(target.id, path)
      if (blob.binary)
        return {
          target,
          path,
          text: '',
          contentId: blob.content_id,
          image: await readNodeImage(path, blob, (offset) =>
            this.client.readContent(target.id, blob.content_id!, offset)
          ),
        }
      if (!blob.content_id || blob.large || blob.too_large)
        throw new UiError(uiMessage('streamBError.23d06ee9cc'))
      return {
        target,
        path,
        contentId: blob.content_id,
        text: await readNodeText(
          (offset) => this.client.readContent(target.id, blob.content_id!, offset),
          1024 * 1024
        ),
      }
    }
    await this.describe()
    const revision =
      frozen ??
      known?.revision ??
      (await this.client.repository.observe({ worktree_id: target.id })).revision
    // Both reads are pinned to the same observation. Status must not delay the blob/content
    // round trips; a missing blob is expected only for an authoritatively deleted file.
    const changes = frozen
      ? Promise.resolve([])
      : known?.changes
        ? Promise.resolve(known.changes)
        : this.status(target, revision).then((entries) => entries.map(pathStatus))
    const params = { worktree_id: target.id, revision, path }
    const blob = readWithIgnoredFallback(
      path,
      async (ignored) => {
        if (!ignored || revision.kind !== 'working' || !this.client.request)
          return this.client.repository.blob(params)
        const value = await this.client.request('repository.v1.blob', {
          ...params,
          include_ignored: true,
        })
        const blob = responseSchema(RepositoryBlobSchema).parse(value)
        return { ...blob, content_id: blob.content_id ?? null }
      },
      false,
      false
    )
    const comparison = changes.then(async (entries) => {
      const observedChange = entries.find((entry) => entry.path === path)
      if (!observedChange) return undefined
      const change = { ...observedChange }
      if (change.kind === 'conflict') {
        // An unmerged index has several sides, not a reversible two-way patch. Citations
        // still open the working file verbatim, including any conflict markers.
        if (stage === 'staged') throw new UiError(uiMessage('streamBError.6e57d7786b'))
        return undefined
      }
      const mode = stage ?? (change.stage === 'staged' ? 'staged' : 'unstaged')
      if (
        change.kind === 'deleted' &&
        mode === 'staged' &&
        revision.kind === 'working' &&
        revision.head &&
        isNodeImagePath(path)
      ) {
        const base = await this.gitPreview(target, { kind: 'commit', commit: revision.head }, path)
        if (base.image) return { change, mode, unstaged: '', diff: '', base }
      }
      const metadata = await blob.catch((): undefined => undefined)
      if (metadata?.binary || (metadata?.requires_larger_load && isNodeImagePath(path)))
        return { change, mode, unstaged: '', diff: '' }
      const [unstaged, staged] = await Promise.all([
        change.stage !== 'staged' ? this.patch(target, revision, path, 'unstaged') : '',
        mode === 'staged' ? this.patch(target, revision, path, 'staged') : '',
      ])
      return { change, mode, unstaged, diff: mode === 'unstaged' ? unstaged : staged }
    })
    const [compared, bytes] = await Promise.all([
      comparison,
      blob
        .then((value) => this.previewBlob(target, revision, path, value))
        .then(
          (value) => ({ value }),
          (error: unknown) => ({ error })
        ),
    ])
    let loaded: Pick<PathDocument, 'text' | 'contentId' | 'image'>
    const base = compared && 'base' in compared ? compared.base : undefined
    if (base) loaded = base
    else if (compared?.change.kind === 'deleted') loaded = { text: '', contentId: null }
    else if ('error' in bytes) throw bytes.error
    else loaded = bytes.value
    if (loaded.image && compared?.mode === 'staged' && compared.change.stage === 'partly')
      throw new UiError(uiMessage('streamBError.a3b91e1549'))
    if (loaded.image)
      return {
        ...loaded,
        target,
        path,
        revision,
        ...(compared ? { change: { ...compared.change, stage: compared.mode, binary: true } } : {}),
      }
    if (!compared) return { ...loaded, target, path, revision }
    const { change, mode, unstaged, diff } = compared
    const indexText = unstaged ? reverseNodePatch(loaded.text, unstaged) : loaded.text
    const after = mode === 'unstaged' ? loaded.text : indexText
    const before = diff ? reverseNodePatch(after, diff) : after
    change.before = before
    change.after = after
    change.added = diff.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).length
    change.removed = diff
      .split('\n')
      .filter((l) => l.startsWith('-') && !l.startsWith('---')).length
    change.stage = mode
    return {
      ...loaded,
      text: change.kind === 'deleted' ? before : loaded.text,
      target,
      path,
      revision,
      change,
    }
  }
  private async readCommittedFile(
    target: PathTarget,
    path: string,
    base: string
  ): Promise<PathDocument> {
    if (target.kind !== 'worktree' || !base)
      throw new Error('A committed diff requires a repository base.')
    const repository = this.client.repository
    const [from, observed] = await Promise.all([
      repository.resolve({ worktree_id: target.id, ref: base }),
      repository.observe({ worktree_id: target.id }),
    ])
    const at = observed.revision
    const head = at.kind === 'commit' ? at.commit : at.head
    if (!head) throw new Error('The branch has no commits to compare.')
    const revision = { kind: 'commit' as const, commit: head }
    let comparisonId = ''
    const entries = await pathPages(async (cursor) => {
      const page = await repository.compare({
        worktree_id: target.id,
        base: from,
        head: revision,
        mode: 'merge-base',
        cursor,
      })
      comparisonId = page.comparison_id
      return page
    })
    const entry = entries.find((entry) => entry.path === path)
    if (!entry)
      throw new Error(
        'This file is no longer changed against the selected base. Refresh the changes.'
      )
    const kind = changeKind(entry.status)
    const loaded =
      kind === 'deleted'
        ? { text: '', contentId: null }
        : await this.gitPreview(target, revision, path)
    const patch = await repository.patch({
      worktree_id: target.id,
      comparison_id: comparisonId,
      path,
    })
    const change: PathChange = { path, kind, before: '', after: '', added: 0, removed: 0 }
    if (patch.binary || loaded.image) {
      change.binary = true
    } else {
      if (!patch.content_id) throw new UiError(uiMessage('streamBError.8647963b04'))
      const diff = await readNodeText(
        (offset) =>
          repository.content({ worktree_id: target.id, content_id: patch.content_id!, offset }),
        8 * 1024 * 1024
      )
      change.after = loaded.text
      change.before = reverseNodePatch(loaded.text, diff)
      change.added = diff
        .split('\n')
        .filter((line) => line.startsWith('+') && !line.startsWith('+++')).length
      change.removed = diff
        .split('\n')
        .filter((line) => line.startsWith('-') && !line.startsWith('---')).length
    }
    return {
      ...loaded,
      text: kind === 'deleted' ? change.before : loaded.text,
      target,
      path,
      revision,
      change,
    }
  }
  history(target: PathTarget, cursor?: string, frozen?: RepositoryRevision) {
    return this.interactive(() => this.readHistory(target, cursor, frozen))
  }
  private async readHistory(target: PathTarget, cursor?: string, frozen?: RepositoryRevision) {
    if (target.kind !== 'worktree') throw new UiError(uiMessage('streamBError.d822bad866'))
    const observed =
      frozen ?? (await this.client.repository.observe({ worktree_id: target.id })).revision
    const revision: RepositoryRevision | undefined =
      observed.kind === 'commit'
        ? observed
        : observed.head
          ? { kind: 'commit', commit: observed.head }
          : undefined
    if (!revision) return { entries: [], cursor: null, revision }
    const page = await this.client.repository.history({
      worktree_id: target.id,
      revision,
      cursor,
      limit: 100,
    })
    if (page.incomplete)
      throw new UiError(
        page.omissions.join(' · ')
          ? uiErrorMessage(new Error(page.omissions.join(' · ')))
          : uiMessage('streamBError.7d3850fd71')
      )
    return { entries: page.entries.map(commitSummary), cursor: page.cursor, revision }
  }
  /** A commit and every file it changed, contents included. */
  async commit(target: PathTarget, hash: string): Promise<CommitSummary> {
    const index = await this.commitIndex(target, hash),
      files = [...(index.files ?? [])]
    await eachBounded(files, COMMIT_FILE_READS, async (file, i) => {
      files[i] = await this.commitFile(target, index, file)
    })
    return { ...index, files }
  }
  /**
   * A commit and the paths it changed, without their contents: two reads however big the commit
   * is, so its page opens at once. Each file stays `pending` until `commitFile` reads it.
   */
  async commitIndex(target: PathTarget, hash: string): Promise<CommitSummary> {
    const revision = { kind: 'commit' as const, commit: hash }
    const commit = await this.client.repository.commit({ worktree_id: target.id, revision })
    const parent = commit.parents[0]
    const pending = (path: string, kind: FileChange['kind']): FileChange => ({
      path,
      kind,
      before: '',
      after: '',
      added: 0,
      removed: 0,
      pending: true,
    })
    const files: FileChange[] = []
    if (parent) {
      const changed = await pathPages((cursor) =>
        this.client.repository.compare({
          worktree_id: target.id,
          base: { kind: 'commit', commit: parent },
          head: revision,
          mode: 'endpoint',
          cursor,
        })
      )
      for (const entry of changed)
        files.push(
          pending(
            entry.path,
            entry.status.startsWith('A')
              ? 'added'
              : entry.status.startsWith('D')
                ? 'deleted'
                : 'modified'
          )
        )
    } else {
      const walk = (entries: TreeEntry[]) => {
        for (const entry of entries)
          if (entry.kind === 'folder') walk(entry.children ?? [])
          else files.push(pending(entry.path, 'added'))
      }
      walk(await this.gitTree(target.id, revision))
    }
    return { ...commitSummary(commit), ...(parent ? { parent } : {}), files }
  }
  /**
   * Both sides of one file a commit changed, read as the commit page reaches it. One read at a
   * time, and tree reads wait meanwhile: the node refuses a fifth repository read in flight.
   */
  commitFile(target: PathTarget, commit: CommitSummary, file: FileChange): Promise<FileChange> {
    return this.interactive(() => this.readCommitFile(target, commit, file))
  }
  private async readCommitFile(
    target: PathTarget,
    commit: CommitSummary,
    file: FileChange
  ): Promise<FileChange> {
    const empty: { text: string; binary: boolean; previewNote?: string } = {
      text: '',
      binary: false,
    }
    const before =
      file.kind === 'added' || !commit.parent
        ? empty
        : await this.commitText(target, { kind: 'commit', commit: commit.parent }, file.path)
    const after =
      file.kind === 'deleted'
        ? empty
        : await this.commitText(target, { kind: 'commit', commit: commit.hash }, file.path)
    const binary = before.binary || after.binary
    const previewNote = before.previewNote ?? after.previewNote
    return {
      path: file.path,
      kind: file.kind,
      before: binary || previewNote ? '' : before.text,
      after: binary || previewNote ? '' : after.text,
      ...(binary ? { binary: true } : {}),
      ...(previewNote ? { previewNote } : {}),
      added: 0,
      removed: 0,
    }
  }
  async subscribe(notify: () => void): Promise<() => void> {
    const stop = this.client.onEvent((event) => {
      // A batch that only moves files changes no folder, copy or branch; the watch applies it.
      if (event.type === 'lsp.diagnostics' || event.type === 'lsp.status') return
      const data = record(event.data)
      if (event.type === 'repository.changed' && data.complete === true && data.git === null) return
      if (event.type === 'workspace.files_changed' && data.complete === true) return
      if (
        event.stream_id === 'catalog' ||
        event.type === 'stream.redacted' ||
        [
          'run.started',
          'run.completed',
          'run.failed',
          'run.interrupted',
          'session.worktree.changed',
        ].includes(event.type)
      )
        notify()
    })
    try {
      await this.client.subscribe('catalog')
    } catch (error) {
      stop()
      throw error
    }
    return () => {
      stop()
    }
  }
  /**
   * `changed`, when given, receives the node's change batches in order on a node that streams
   * them; `notify` then asks for a full reread only when a batch is incomplete, one is missing,
   * or the node says it lost track.
   */
  async watch(
    target: PathTarget,
    notify: () => void,
    changed?: (batch: PathTreeBatch) => void
  ): Promise<() => void> {
    await this.describe()
    if (target.kind === 'workspace' && !this.capabilities.includes('node_path_v2')) return () => {}
    // A git copy and a plain folder each have their own stream on the node.
    const streaming =
      !!changed &&
      this.capabilities.includes(
        target.kind === 'worktree' ? 'repository_changes_v1' : 'workspace_changes_v1'
      )
    let cursor: RepositoryChangesCursor | undefined
    /** Batches that arrived before the lease said where the stream stands. */
    const early: (RepositoryChangeBatch | WorkspaceChangeBatch)[] = []
    let lease: Awaited<ReturnType<NodeClient['repository']['watch']>> | undefined
    const acquire = () =>
      target.kind === 'workspace'
        ? this.client.nodePath.watch(
            streaming
              ? { workspace_id: target.id, changes: cursor ?? null }
              : { workspace_id: target.id }
          )
        : this.client.repository.watch({
            worktree_id: target.id,
            ...(streaming ? { changes: cursor ?? null } : {}),
            ...(this.capabilities.includes('repository_watch_renewal_v1') && lease
              ? { subscription_id: lease.subscription_id }
              : {}),
          })
    const release = (subscription_id: string) =>
      target.kind === 'workspace'
        ? this.client.nodePath.unwatch({ workspace_id: target.id, subscription_id })
        : this.client.repository.unwatch({ worktree_id: target.id, subscription_id })
    const follow = (batch: RepositoryChangeBatch | WorkspaceChangeBatch) => {
      if (!cursor) {
        if (early.length < 64) early.push(batch)
        return
      }
      if (batch.stream_id === cursor.stream_id && batch.revision <= cursor.revision) return
      const next = { stream_id: batch.stream_id, revision: batch.revision }
      const inOrder =
        batch.complete &&
        batch.stream_id === cursor.stream_id &&
        batch.revision === cursor.revision + 1
      cursor = next
      if (!inOrder) {
        console.debug('[Abele] node path: rereading the files', {
          reason: 'reason' in batch ? batch.reason : 'revision gap',
          to: next,
        })
        notify()
      } else changed!({ entries: batch.entries, git: 'git' in batch && batch.git !== null })
    }
    /** False on a node without the stream: the caller rereads as it always did. */
    const adopt = (lease: Awaited<ReturnType<typeof acquire>>) => {
      if (!streaming || !lease.changes) return false
      const pending = early.splice(0)
      if (lease.refresh_required) {
        // The first lease only says where the stream starts: the caller reads the files after
        // the watch is up. A later one means batches were lost.
        if (cursor) notify()
        cursor = lease.changes
        // Behind the lease is fine: the node says every batch since is on its way here.
      } else cursor ??= lease.changes
      for (const batch of pending) follow(batch)
      return true
    }
    let stopped = false,
      timer: number | undefined
    const stop = this.client.onEvent((event) => {
      if (event.type === 'repository.changed') {
        const batch =
          streaming && target.kind === 'worktree'
            ? responseSchema(RepositoryChangeBatchSchema).safeParse(event.data)
            : null
        if (batch?.success && batch.data.worktree_id === target.id) follow(batch.data)
        else if (
          streaming &&
          target.kind === 'worktree' &&
          record(event.data).worktree_id === target.id
        ) {
          console.debug(
            '[Abele] node path: unreadable repository batch; rereading the files',
            batch && !batch.success ? batch.error : undefined
          )
          notify()
        }
        return
      }
      if (event.type === 'workspace.files_changed') {
        const batch =
          streaming && target.kind === 'workspace'
            ? responseSchema(WorkspaceChangeBatchSchema).safeParse(event.data)
            : null
        if (batch?.success && batch.data.workspace_id === target.id) follow(batch.data)
        else if (
          streaming &&
          target.kind === 'workspace' &&
          record(event.data).workspace_id === target.id
        ) {
          console.debug(
            '[Abele] node path: unreadable workspace batch; rereading the files',
            batch && !batch.success ? batch.error : undefined
          )
          notify()
        }
        return
      }
      if (
        (event.type === 'repository.invalidated' &&
          target.kind === 'worktree' &&
          record(event.data).worktree_id === target.id &&
          // On the change stream every filesystem edit arrives as a batch.
          !(streaming && cursor && record(event.data).reason === 'filesystem')) ||
        (event.type === 'workspace.invalidated' &&
          target.kind === 'workspace' &&
          record(event.data).workspace_id === target.id &&
          !(streaming && cursor && record(event.data).reason === 'filesystem')) ||
        event.type === 'stream.redacted'
      )
        notify()
    })
    try {
      lease = await acquire()
    } catch (error) {
      stop()
      throw error
    }
    adopt(lease)
    const renew = async () => {
      const previous = lease
      try {
        const next = await acquire()
        if (stopped) {
          await release(next.subscription_id)
          return
        }
        lease = next
        if (previous && previous.subscription_id !== next.subscription_id)
          await release(previous.subscription_id)
        if (!adopt(next)) notify()
      } catch (error) {
        // Reacquire after the node has forgotten an expired lease, keeping the stream cursor.
        if (
          target.kind === 'worktree' &&
          this.capabilities.includes('repository_watch_renewal_v1') &&
          lease === previous &&
          (error as { code?: unknown })?.code === 'unauthorized'
        )
          lease = undefined
        notify()
      }
      if (!stopped)
        timer = window.setTimeout(() => {
          void renew()
        }, 45000)
    }
    timer = window.setTimeout(() => {
      void renew()
    }, 45000)
    return () => {
      stopped = true
      window.clearTimeout(timer)
      stop()
      if (lease) void release(lease.subscription_id).catch(() => {})
    }
  }
}

/** Reverse a retained unified patch against its exact after bytes; never guess on mismatch. */
export function reverseNodePatch(text: string, patch: string): string {
  const output = text ? text.split('\n') : []
  const afterHasNewline = text.endsWith('\n')
  if (afterHasNewline) output.pop()
  const lines = patch.split('\n')
  const hunks: { start: number; after: string[]; before: string[]; beforeNoNewline?: boolean }[] =
    []
  let current: (typeof hunks)[number] | undefined
  let beforeHasNewline = afterHasNewline || !text
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i],
      match = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line)
    if (match) {
      current = { start: Number(match[1]) === 0 ? 0 : Number(match[1]) - 1, after: [], before: [] }
      hunks.push(current)
      continue
    }
    if (!current) continue
    if (line.startsWith('\\ No newline')) {
      if (lines[i - 1]?.startsWith('-') || lines[i - 1]?.startsWith(' '))
        current.beforeNoNewline = true
      continue
    }
    if (line.startsWith(' ')) {
      current.after.push(line.slice(1))
      current.before.push(line.slice(1))
    } else if (line.startsWith('+')) current.after.push(line.slice(1))
    else if (line.startsWith('-')) current.before.push(line.slice(1))
  }
  if (
    !hunks.length &&
    /^similarity index 100%$/m.test(patch) &&
    /^rename from /m.test(patch) &&
    /^rename to /m.test(patch)
  )
    return text
  if (!hunks.length && patch.trim()) throw new UiError(uiMessage('streamBError.aa6abd6309'))
  const afterLength = output.length
  for (const hunk of hunks.reverse()) {
    if (hunk.start + hunk.after.length === afterLength && hunk.before.length)
      beforeHasNewline = !hunk.beforeNoNewline
    if (
      output.slice(hunk.start, hunk.start + hunk.after.length).join('\n') !== hunk.after.join('\n')
    )
      throw new UiError(uiMessage('streamBError.0e5dd7f8f9'))
    output.splice(hunk.start, hunk.after.length, ...hunk.before)
  }
  return output.length ? output.join('\n') + (beforeHasNewline ? '\n' : '') : ''
}

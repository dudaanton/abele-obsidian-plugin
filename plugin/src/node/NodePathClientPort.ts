import type { NodeClient } from '@abele/node-client'
import { ChannelError } from '@abele/channel-protocol'
import { bindPathTarget } from './nodePathChat'
import { supportsExpectedTarget } from './expectedTarget'
import type { RepositoryRevision, WorktreeEntry } from '@abele/node-protocol'
import type { CommitSummary, FileChange, TreeEntry } from '@/components/nodeWork/types'
import { formatTimestamp } from '@/helpers/displayFormat'
import { nodePages } from './NodeWorkspaceModel'
import { readNodeText } from './NodeFilesModel'
import { readNodeImage, isNodeImagePath, NODE_IMAGE_MAX_BYTES } from './nodeImagePreview'
import type {
  NodePathPort,
  PathCatalogue,
  PathChange,
  PathDocument,
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
>
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
      throw new Error(page.omissions.join(' · ') || 'The node returned an incomplete listing')
    entries.push(...page.entries)
    if (!page.cursor) return entries
    if (visited.has(page.cursor)) throw new Error('Node pagination did not advance')
    visited.add(page.cursor)
    cursor = page.cursor
  }
}
const branchName = (name: string | null) => name?.replace(/^refs\/heads\//, '') ?? 'Detached'
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
    readonly identity: { nodeId: string; registrationId: string }
  ) {}
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
  async catalogue(): Promise<PathCatalogue> {
    const description = await this.describe(true)
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
      const workspaces = await nodePages(
        (after) => this.client.listWorkspaces(project.project_id, after),
        (w) => w.workspace_id
      )
      if (project.repository_path) {
        const rows = await pathPages((cursor) =>
          this.client.repository.worktrees({
            project_id: project.project_id,
            cursor,
            ...(enriched ? { include_selection: true } : {}),
          })
        )
        rows.sort((a, b) => Number(b.kind === 'root') - Number(a.kind === 'root'))
        const listed = rows.filter((w) =>
          enriched ? w.listed === true || w.kind === 'root' : w.kind !== 'external'
        )
        for (const row of rows) this.worktrees.set(row.worktree_id, row)
        for (const row of listed) {
          const target = this.binding(project.project_id, 'worktree', row.worktree_id)
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
            path: w.path_label,
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
          if (!(error instanceof ChannelError && error.code === 'workspace_required')) throw error
        }
      }
      if (target && !this.subscribedSessions.has(session.session_id)) {
        await this.client.subscribe(session.session_id)
        this.subscribedSessions.add(session.session_id)
      }
      const running = await this.client.store.transaction((state) => {
        const runs = new Set<string>()
        for (const event of state.events[session.session_id] ?? []) {
          const data = record(event.data)
          if (typeof data.run_id !== 'string') continue
          if (event.type === 'run.started') runs.add(data.run_id)
          else if (['run.completed', 'run.failed', 'run.interrupted'].includes(event.type))
            runs.delete(data.run_id)
        }
        return runs.size > 0
      })
      bound.push({ session, target, running })
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
        if (++budget.count > 10000)
          throw new Error(
            'This folder exceeds the 10,000-entry tree limit. Use the repository browser for paginated browsing.'
          )
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
      throw new Error(page.omissions.join(' · ') || 'The node returned an incomplete listing')
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
      throw new Error(
        blob.binary
          ? 'Binary file: no text preview.'
          : 'This file needs an explicit larger load in the repository browser.'
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
  private async gitPreview(target: PathTarget, revision: RepositoryRevision, path: string) {
    const blob = await this.client.repository.blob({ worktree_id: target.id, revision, path })
    return this.previewBlob(target, revision, path, blob)
  }
  private async previewBlob(
    target: PathTarget,
    revision: RepositoryRevision,
    path: string,
    blob: Awaited<ReturnType<NodeClient['repository']['blob']>>
  ) {
    if (isNodeImagePath(path)) {
      if (blob.size > NODE_IMAGE_MAX_BYTES || blob.too_large)
        throw new Error('Image preview is limited to 4 MiB.')
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
    if (revision.kind !== 'working')
      throw new Error('A working comparison requires an observation.')
    if (!revision.head && !this.capabilities.includes('node_path_v2'))
      throw new Error('Unborn working-tree comparisons require an updated node.')
    const manifest = await this.client.repository.compare({
      worktree_id: target.id,
      base: revision.head ? { kind: 'commit', commit: revision.head } : { kind: 'empty' },
      head: revision,
      mode,
    })
    if (manifest.incomplete)
      throw new Error(manifest.omissions.join(' · ') || 'Incomplete comparison')
    const blob = await this.client.repository.patch({
      worktree_id: target.id,
      comparison_id: manifest.comparison_id,
      path,
    })
    if (!blob.content_id || blob.binary)
      throw new Error('No text comparison is available for this file.')
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
    stage?: 'staged' | 'unstaged',
    frozen?: RepositoryRevision,
    known?: KnownPathRead
  ): Promise<PathDocument> {
    return this.interactive(() => this.readFile(target, path, stage, frozen, known))
  }
  private async readFile(
    target: PathTarget,
    path: string,
    stage?: 'staged' | 'unstaged',
    frozen?: RepositoryRevision,
    known?: KnownPathRead
  ): Promise<PathDocument> {
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
        throw new Error('This file cannot be previewed as bounded text.')
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
    const blob = this.client.repository.blob({ worktree_id: target.id, revision, path })
    const comparison = changes.then(async (entries) => {
      const observedChange = entries.find((entry) => entry.path === path)
      if (!observedChange) return undefined
      const change = { ...observedChange }
      if (change.kind === 'conflict')
        throw new Error(
          'Resolve the conflict in the code editor or repository browser; a single comparison would omit a side.'
        )
      const mode = stage ?? (change.stage === 'staged' ? 'staged' : 'unstaged')
      const metadata = await blob.catch(() => undefined)
      if (metadata?.binary)
        return { change, mode, unstaged: '', diff: '' }
      const [unstaged, staged] = await Promise.all([
        change.stage !== 'staged' ? this.patch(target, revision, path, 'unstaged') : '',
        mode === 'staged' ? this.patch(target, revision, path, 'staged') : '',
      ])
      return { change, mode, unstaged, diff: mode === 'unstaged' ? unstaged : staged }
    })
    const [compared, bytes] = await Promise.all([
      comparison,
      blob.then((value) => this.previewBlob(target, revision, path, value)).then(
        (value) => ({ value }),
        (error: unknown) => ({ error })
      ),
    ])
    let loaded: Pick<PathDocument, 'text' | 'contentId' | 'image'>
    if (compared?.change.kind === 'deleted') loaded = { text: '', contentId: null }
    else if ('error' in bytes) throw bytes.error
    else loaded = bytes.value
    if (loaded.image)
      return {
        ...loaded,
        target,
        path,
        revision,
        ...(compared ? { change: { ...compared.change, binary: true } } : {}),
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
  history(target: PathTarget, cursor?: string, frozen?: RepositoryRevision) {
    return this.interactive(() => this.readHistory(target, cursor, frozen))
  }
  private async readHistory(target: PathTarget, cursor?: string, frozen?: RepositoryRevision) {
    if (target.kind !== 'worktree') throw new Error('A plain folder has no Git history.')
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
    if (page.incomplete) throw new Error(page.omissions.join(' · ') || 'Incomplete history')
    return { entries: page.entries.map(commitSummary), cursor: page.cursor, revision }
  }
  async commit(target: PathTarget, hash: string): Promise<CommitSummary> {
    const revision = { kind: 'commit' as const, commit: hash }
    const commit = await this.client.repository.commit({ worktree_id: target.id, revision })
    const files: FileChange[] = []
    if (commit.parents[0]) {
      const base = { kind: 'commit' as const, commit: commit.parents[0] }
      const changed = await pathPages((cursor) =>
        this.client.repository.compare({
          worktree_id: target.id,
          base,
          head: revision,
          mode: 'endpoint',
          cursor,
        })
      )
      for (const entry of changed) {
        const before = entry.status.startsWith('A')
          ? { text: '', binary: false }
          : await this.commitText(target, base, entry.path)
        const after = entry.status.startsWith('D')
          ? { text: '', binary: false }
          : await this.commitText(target, revision, entry.path)
        const binary = before.binary || after.binary
        const previewNote = before.previewNote ?? after.previewNote
        files.push({
          path: entry.path,
          kind: entry.status.startsWith('A')
            ? 'added'
            : entry.status.startsWith('D')
              ? 'deleted'
              : 'modified',
          before: binary || previewNote ? '' : before.text,
          after: binary || previewNote ? '' : after.text,
          ...(binary ? { binary: true } : {}),
          ...(previewNote ? { previewNote } : {}),
          added: 0,
          removed: 0,
        })
      }
    } else {
      const walk = async (entries: TreeEntry[]): Promise<void> => {
        for (const entry of entries) {
          if (entry.kind === 'folder') await walk(entry.children ?? [])
          else {
            const loaded = await this.commitText(target, revision, entry.path)
            files.push({
              path: entry.path,
              kind: 'added',
              before: '',
              after: loaded.text,
              ...(loaded.binary ? { binary: true } : {}),
              ...(loaded.previewNote ? { previewNote: loaded.previewNote } : {}),
              added: 0,
              removed: 0,
            })
          }
        }
      }
      await walk(await this.gitTree(target.id, revision))
    }
    return { ...commitSummary(commit), files }
  }
  async subscribe(notify: () => void): Promise<() => void> {
    const stop = this.client.onEvent((event) => {
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
  async watch(target: PathTarget, notify: () => void): Promise<() => void> {
    if (target.kind === 'workspace' && !this.capabilities.includes('node_path_v2')) return () => {}
    const acquire = () =>
      target.kind === 'workspace'
        ? this.client.nodePath.watch({ workspace_id: target.id })
        : this.client.repository.watch({ worktree_id: target.id })
    const release = (subscription_id: string) =>
      target.kind === 'workspace'
        ? this.client.nodePath.unwatch({ workspace_id: target.id, subscription_id })
        : this.client.repository.unwatch({ worktree_id: target.id, subscription_id })
    let stopped = false,
      timer: number | undefined
    let lease = await acquire()
    const stop = this.client.onEvent((event) => {
      if (
        (event.type === 'repository.invalidated' &&
          target.kind === 'worktree' &&
          record(event.data).worktree_id === target.id) ||
        (event.type === 'workspace.invalidated' &&
          target.kind === 'workspace' &&
          record(event.data).workspace_id === target.id) ||
        event.type === 'stream.redacted'
      )
        notify()
    })
    const renew = async () => {
      try {
        const next = await acquire()
        if (stopped) {
          await release(next.subscription_id)
          return
        }
        const previous = lease
        lease = next
        if (previous.subscription_id !== next.subscription_id)
          await release(previous.subscription_id)
        notify()
      } catch {
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
      void release(lease.subscription_id).catch(() => {})
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
  if (!hunks.length && patch.trim()) throw new Error('No bounded text hunks in this patch.')
  const afterLength = output.length
  for (const hunk of hunks.reverse()) {
    if (hunk.start + hunk.after.length === afterLength && hunk.before.length)
      beforeHasNewline = !hunk.beforeNoNewline
    if (
      output.slice(hunk.start, hunk.start + hunk.after.length).join('\n') !== hunk.after.join('\n')
    )
      throw new Error(
        'The retained patch does not match this file. Refresh to capture a new comparison.'
      )
    output.splice(hunk.start, hunk.after.length, ...hunk.before)
  }
  return output.length ? output.join('\n') + (beforeHasNewline ? '\n' : '') : ''
}

import type {
  NodeClient,
  RepositoryClient,
  RepositoryRevision as NodeRevision,
} from '@abele/node-client'
import { RepositoryInvalidationSchema } from '@abele/node-protocol'
import type {
  RepositoryIdentity,
  RepositorySource,
  RepositoryWorkspace,
  RepositoryRevision,
  RepositoryChange,
  RepositoryTree,
  RepositorySearch,
  RepositoryComparisonMode,
} from './source'
import type {
  RepoHomeData,
  BlobData,
  CommitSummary,
  CommitData,
  CompareData,
  ComparisonIndex,
  PinnedFile,
  TreeNode,
  BlameRange,
  CodeResults,
} from './model'
import type { DiffFile } from '@/github/api'
import type { FileChange } from '@/github/comparison/trees'
import { fullDiff } from '@/github/comparison/text'
import { parsePatch } from '@/github/patch'
import { sortNodes, findNode } from '@/github/tree/fileTree'
import { readNodeText } from '@/node/NodeFilesModel'
import { nodeRepositoryLink } from './nodeLinks'

export const WORKING_TREE = 'Working tree'
const workingPrefix = 'working-'
export const nodeRevisionLabel = (ref: string): string =>
  ref.startsWith(workingPrefix) ? WORKING_TREE : ref
export type NodeRepositoryClient = Pick<
  NodeClient,
  'repository' | 'onEvent' | 'subscribe' | 'connected'
>
type NodeIdentity = Extract<RepositoryIdentity, { provider: 'node' }>
type Page<T> = { entries: T[]; cursor: string | null; incomplete: boolean; omissions: string[] }
type Commit = Awaited<ReturnType<RepositoryClient['commit']>>
const summary = (c: Commit): CommitSummary => ({
  sha: c.commit,
  author: c.author,
  date: c.authored_at,
  message: c.message,
})
const changedStatus = (s: string): FileChange['status'] =>
  s.startsWith('A') || s === '??'
    ? 'added'
    : s.startsWith('D')
      ? 'removed'
      : s.startsWith('R')
        ? 'renamed'
        : s.startsWith('T')
          ? 'type changed'
          : 'modified'

/** One tab/source lifetime. Mutable aliases are separate from retained immutable revision keys. */
export class NodeRepositorySource implements RepositorySource {
  readonly cacheNamespace: string
  private disposed = false
  private retired = false
  private authorityGeneration = 0
  private external = false
  private aliases = new Map<string, Promise<string>>()
  private revisions = new Map<string, NodeRevision>()
  private listeners = new Set<(event: RepositoryChange) => void>()
  private fileContents = new Map<string, string>()
  private textCache = new Map<string, string>()
  private textBytes = 0
  private stopEvents?: () => void
  private timer?: number
  private subscription?: string
  private watching = false
  private comparisonIds = new WeakMap<ComparisonIndex, string>()
  readonly navigation: RepositorySource['navigation']
  constructor(
    private readonly client: NodeRepositoryClient,
    readonly identity: NodeIdentity,
    private readonly labels: { node: string; project: string; isCurrent?: () => boolean },
    revision?: RepositoryRevision
  ) {
    this.cacheNamespace = JSON.stringify(identity)
    if (revision)
      this.remember(
        revision.kind === 'commit'
          ? revision
          : {
              kind: 'working',
              head: revision.head,
              observation_id: revision.observation,
              observed_at: revision.observedAt,
            }
      )
    const link = (location: Parameters<typeof nodeRepositoryLink>[1]) => {
      const ref =
        'ref' in location
          ? location.ref
          : location.kind === 'comparison'
            ? location.head
            : undefined
      const contentId =
        location.kind === 'file'
          ? this.fileContents.get(JSON.stringify([location.ref, location.path]))
          : undefined
      return nodeRepositoryLink(
        identity,
        location.kind === 'file' && contentId ? { ...location, contentId } : location,
        ref ? this.revision(ref) : undefined
      )
    }
    this.navigation = {
      workspace: (id) =>
        nodeRepositoryLink({ ...identity, workspace: id }, { kind: 'home', ref: WORKING_TREE }),
      home: (ref = WORKING_TREE) => link({ kind: 'home', ref }),
      file: (ref, path, line) =>
        link({ kind: 'file', ref, path, ...(line ? { lines: { from: line, to: line } } : {}) }),
      folder: (ref, path) => link({ kind: 'folder', ref, path }),
      commit: (commit) => link({ kind: 'commit', commit }),
      comparison: (base, head, direct = true, mode) =>
        link({ kind: 'comparison', base, head, direct, ...(mode ? { mode } : {}) }),
      blobLink: (ref, path, lines) => ({
        label: `${path} · ${nodeRevisionLabel(ref)} · ${lines.from}–${lines.to}`,
        url: link({ kind: 'file', ref, path, lines }),
      }),
    }
  }
  get isCurrent() {
    return !this.disposed && !this.retired && (this.labels.isCurrent?.() ?? true)
  }
  assertCurrent() {
    if (!this.isCurrent)
      throw new Error(
        'This node repository is no longer available. Reconnect or choose a workspace.'
      )
  }
  private async read<T>(work: () => Promise<T>): Promise<T> {
    this.assertCurrent()
    const generation = this.authorityGeneration
    const value = await work()
    this.assertCurrent()
    if (generation !== this.authorityGeneration)
      throw new Error('Repository authorization changed during this read. Refresh deliberately.')
    return value
  }
  private get target() {
    return { worktree_id: this.identity.workspace }
  }
  private remember(revision: NodeRevision): string {
    const key =
      revision.kind === 'commit' ? revision.commit : workingPrefix + revision.observation_id
    this.revisions.set(key, revision)
    if (this.revisions.size > 64) this.revisions.delete(this.revisions.keys().next().value!)
    return key
  }
  revision(ref: string): RepositoryRevision | undefined {
    const revision = this.revisions.get(ref)
    return revision?.kind === 'working'
      ? {
          kind: 'working-tree',
          head: revision.head,
          observation: revision.observation_id,
          observedAt: revision.observed_at,
        }
      : revision
  }
  refresh() {
    this.aliases.clear()
  }
  reconnect() {
    this.refresh()
    this.textCache.clear()
    this.textBytes = 0
    this.emit({ kind: 'workspace' })
  }
  async resolve(ref = WORKING_TREE): Promise<string> {
    this.assertCurrent()
    if (this.revisions.has(ref)) return ref
    if (ref.startsWith(workingPrefix))
      throw new Error(
        'This Working tree observation expired. Refresh to inspect the current files.'
      )
    let pending = this.aliases.get(ref)
    if (!pending) {
      pending = this.read(async () =>
        this.remember(
          ref === WORKING_TREE
            ? (await this.client.repository.observe(this.target)).revision
            : await this.client.repository.resolve({ ...this.target, ref })
        )
      )
      this.aliases.set(ref, pending)
      void pending.catch(() => {
        if (this.aliases.get(ref) === pending) this.aliases.delete(ref)
      })
    }
    return pending
  }
  private async at(ref: string): Promise<NodeRevision> {
    const key = await this.resolve(ref)
    const revision = this.revisions.get(key)
    if (!revision) throw new Error('This repository revision expired. Refresh deliberately.')
    return revision
  }
  private async pages<T>(
    load: (cursor?: string) => Promise<Page<T>>,
    max = 4096,
    allowIncomplete = false
  ): Promise<{ entries: T[]; incomplete: boolean; omissions: string[] }> {
    const entries: T[] = [],
      omissions = new Set<string>(),
      cursors = new Set<string>()
    let cursor: string | undefined,
      bytes = 0,
      incomplete = false
    do {
      const page = await this.read(() => load(cursor))
      bytes += JSON.stringify(page).length
      entries.push(...page.entries)
      incomplete ||= page.incomplete
      for (const note of page.omissions) omissions.add(note)
      if (
        entries.length > max ||
        bytes > 4 * 1024 * 1024 ||
        (page.cursor && cursors.has(page.cursor))
      )
        throw new Error(
          'This repository listing exceeds the view limit. Narrow the path or search.'
        )
      cursor = page.cursor ?? undefined
      if (cursor) cursors.add(cursor)
    } while (cursor)
    if (incomplete && !allowIncomplete)
      throw new Error([...omissions].join(' · ') || 'The node could not return a complete listing.')
    return { entries, incomplete, omissions: [...omissions] }
  }
  async workspaces(): Promise<RepositoryWorkspace[]> {
    const rows = await this.pages(
      (cursor) => this.client.repository.worktrees({ project_id: this.identity.project, cursor }),
      1024
    )
    this.external =
      rows.entries.find((row) => row.worktree_id === this.identity.workspace)?.kind === 'external'
    return rows.entries.map((row) => ({
      id: row.worktree_id,
      label: row.path_label,
      kind: row.kind,
      branch: row.branch,
      head: row.head,
      dirty: row.dirty,
      availability: row.availability,
      workspaceId: row.workspace_id,
      locked: row.locked,
      prunable: row.prunable,
      readOnly: row.kind === 'external',
      ...(row.head ? { revision: { kind: 'commit' as const, commit: row.head } } : {}),
    }))
  }
  private async refPage() {
    return this.pages((cursor) => this.client.repository.refs({ ...this.target, cursor }))
  }
  async refs(prefix = '') {
    const page = await this.refPage()
    return {
      branches: [
        WORKING_TREE,
        'HEAD',
        ...page.entries
          .filter((r) => !r.name.startsWith('refs/tags/'))
          .map((r) => r.name.replace(/^refs\/heads\//, '')),
      ].filter((name) => name.toLowerCase().includes(prefix.toLowerCase())),
      tags: page.entries
        .filter((r) => r.name.startsWith('refs/tags/'))
        .map((r) => r.name.slice(10))
        .filter((name) => name.toLowerCase().includes(prefix.toLowerCase())),
      more: false,
    }
  }
  async defaultBranch() {
    const page = await this.read(() => this.client.repository.refs(this.target))
    if (!page.default_branch)
      throw new Error('No default branch is known. Choose a branch to compare against.')
    return page.default_branch
  }
  async metadata(): Promise<RepoHomeData['meta']> {
    const page = await this.read(() => this.client.repository.refs(this.target))
    return {
      owner: this.labels.node,
      name: this.labels.project,
      description: '',
      homepage: '',
      topics: [],
      stars: 0,
      forks: 0,
      watchers: 0,
      defaultBranch: page.default_branch ?? '',
      license: null,
      visibility: 'local',
      archived: false,
      parent: null,
      hasIssues: false,
      url: this.navigation.home(),
    }
  }
  async home(ref = WORKING_TREE): Promise<RepoHomeData> {
    const workspaces = await this.workspaces()
    const selected = workspaces.find((w) => w.id === this.identity.workspace)
    if (!selected || selected.availability !== 'available')
      throw new Error('This workspace is missing or unavailable. Choose another workspace.')
    const folder = await this.folder(ref, '')
    const revision = await this.at(folder.ref)
    const status = await this.status()
    const commits =
      revision.kind === 'working' && !revision.head ? [] : await this.commits(folder.ref)
    return {
      ...folder,
      meta: await this.metadata(),
      empty: !folder.entries.length && !selected.head,
      node: { workspaces, status, commits },
    }
  }
  async tree(ref: string): Promise<RepositoryTree> {
    const sha = await this.resolve(ref),
      revision = await this.at(sha)
    const root: TreeNode = { name: '', path: '', kind: 'dir' }
    const expand = async (node: TreeNode) => {
      if (node.kind !== 'dir' || node.children) return
      const page = await this.pages((cursor) =>
        this.client.repository.tree({ ...this.target, revision, path: node.path, cursor })
      )
      node.children = sortNodes(
        page.entries.map((entry) => ({
          name: entry.name,
          path: entry.path,
          kind:
            entry.kind === 'directory'
              ? ('dir' as const)
              : entry.kind === 'submodule'
                ? ('submodule' as const)
                : ('file' as const),
          mode:
            entry.kind === 'symlink' ? '120000' : entry.kind === 'directory' ? '040000' : '100644',
          ...(entry.oid ? { sha: entry.oid } : {}),
          ...(entry.size !== null ? { size: entry.size } : {}),
        }))
      )
    }
    await expand(root)
    return {
      root,
      sha,
      truncated: true,
      expand,
      reveal: async (path) => {
        const parts = path.split('/')
        for (let i = 1; i < parts.length; i++) {
          const node = findNode(root, parts.slice(0, i).join('/'))
          if (node) await expand(node)
        }
      },
    }
  }
  async folder(ref: string, path: string) {
    const sha = await this.resolve(ref),
      revision = await this.at(sha)
    const page = await this.pages((cursor) =>
      this.client.repository.tree({ ...this.target, revision, path, cursor })
    )
    return {
      ref: sha,
      path,
      url: this.navigation.folder(sha, path),
      entries: page.entries.map((e) => ({
        name: e.name,
        path: e.path,
        kind: e.kind === 'directory' ? ('dir' as const) : e.kind,
        ...(e.size !== null ? { size: e.size } : {}),
      })),
    }
  }
  private async content(id: string, limit = 1024 * 1024): Promise<string> {
    this.assertCurrent()
    const cached = this.textCache.get(id)
    if (cached !== undefined) {
      this.textCache.delete(id)
      this.textCache.set(id, cached)
      return cached
    }
    const text = await this.read(() =>
      readNodeText(
        (offset) =>
          this.read(() =>
            this.client.repository.content({ ...this.target, content_id: id, offset })
          ),
        limit
      )
    )
    const size = text.length * 2
    if (size <= 4 * 1024 * 1024) {
      this.textCache.set(id, text)
      this.textBytes += size
      while (this.textBytes > 4 * 1024 * 1024) {
        const key = this.textCache.keys().next().value!
        this.textBytes -= this.textCache.get(key)!.length * 2
        this.textCache.delete(key)
      }
    }
    return text
  }
  async blob(ref: string, path: string, contentId?: string): Promise<BlobData> {
    if (contentId) {
      const text = await this.content(contentId)
      this.rememberContent(ref, path, contentId)
      return { ref, path, text, contentId, url: this.navigation.file(ref, path) }
    }
    const sha = await this.resolve(ref),
      revision = await this.at(sha)
    const blob = await this.read(() =>
      this.client.repository.blob({ ...this.target, revision, path })
    )
    if (blob.content_id) this.rememberContent(sha, path, blob.content_id)
    const note = blob.binary
      ? 'Binary file · no text preview.'
      : blob.too_large || blob.requires_larger_load
        ? 'This file is too large for automatic display.'
        : undefined
    return {
      ref: sha,
      path,
      text: !note && blob.content_id ? await this.content(blob.content_id) : '',
      url: this.navigation.file(sha, path),
      contentId: blob.content_id,
      note,
    }
  }
  private rememberContent(ref: string, path: string, id: string) {
    this.fileContents.set(JSON.stringify([ref, path]), id)
    if (this.fileContents.size > 2048)
      this.fileContents.delete(this.fileContents.keys().next().value!)
  }
  async text(ref: string, path: string) {
    const blob = await this.blob(ref, path)
    if (blob.note) throw new Error(blob.note)
    return blob.text
  }
  async status() {
    const key = await this.resolve(WORKING_TREE),
      revision = await this.at(key)
    const page = await this.pages((cursor) =>
      this.client.repository.status({ ...this.target, revision, cursor })
    )
    return {
      supported: true,
      revision: this.revision(key),
      files: page.entries.map((e) => ({
        path: e.path,
        staged: ![' ', '?', '!'].includes(e.index),
        unstaged: ![' ', '!'].includes(e.worktree),
        untracked: e.index === '?' || e.worktree === '?',
        status:
          e.index === '?'
            ? 'untracked'
            : e.index === 'D' || e.worktree === 'D'
              ? 'deleted'
              : e.index === 'A' || e.worktree === 'A'
                ? 'added'
                : 'modified',
      })),
    }
  }
  async commits(ref: string, path?: string): Promise<CommitSummary[]> {
    const revision = await this.at(ref)
    if (revision.kind === 'working' && !revision.head) return []
    const page = await this.read(() =>
      this.client.repository.history({ ...this.target, revision, path, limit: 100 })
    )
    // The shared commit list has no continuation UI; explicitly mark a bounded window.
    return page.entries.map(summary)
  }
  async commit(ref: string): Promise<CommitData> {
    const revision = await this.at(ref),
      c = await this.read(() => this.client.repository.commit({ ...this.target, revision }))
    const files = c.parents.length
      ? (await this.compare(c.parents[0], c.commit, true)).files
      : await this.rootCommitFiles(c.commit)
    return { ...summary(c), parentSha: c.parents[0], url: this.navigation.commit(c.commit), files }
  }
  private async rootCommitFiles(ref: string): Promise<DiffFile[]> {
    const tree = await this.tree(ref),
      files: DiffFile[] = []
    const walk = async (node: TreeNode): Promise<void> => {
      if (node.kind === 'dir') {
        await tree.expand(node)
        for (const child of node.children ?? []) await walk(child)
        return
      }
      if (files.length >= 4096)
        throw new Error(
          'This root commit exceeds the changed-file view limit. Browse its tree instead.'
        )
      const file: DiffFile = {
        path: node.path,
        status: 'added',
        additions: 0,
        deletions: 0,
        hash: node.path,
        reviewComments: [],
        blobUrl: this.navigation.file(ref, node.path),
      }
      file.loadPatch = async () => {
        const blob = await this.blob(ref, node.path)
        if (blob.note) {
          file.diffNote = blob.note
          return
        }
        const lines = blob.text.match(/[^\n]*\n|[^\n]+$/g) ?? []
        if (lines.length > 100000) throw new Error('This file exceeds the diff line limit.')
        file.patch = `--- /dev/null\n+++ b/${node.path}\n@@ -0,0 +1,${lines.length} @@\n${lines.map((line) => '+' + line.replace(/\n$/, '')).join('\n')}`
        file.additions = lines.length
      }
      files.push(file)
    }
    await walk(tree.root)
    return files
  }
  async blame(ref: string, path: string): Promise<BlameRange[]> {
    const revision = await this.at(ref)
    const page = await this.pages(
      (cursor) =>
        this.client.repository.blame({
          ...this.target,
          revision,
          path,
          start: 1,
          count: 1500,
          cursor,
        }),
      1500
    )
    const ranges: BlameRange[] = []
    for (const line of page.entries) {
      const sha = line.commit ?? '',
        previous = ranges.at(-1)
      if (previous && previous.commit.sha === sha && previous.end + 1 === line.line)
        previous.end = line.line
      else
        ranges.push({
          start: line.line,
          end: line.line,
          commit: {
            sha,
            author: line.commit ? line.author : 'Uncommitted',
            message: line.commit ? '' : 'Working tree',
            date: '',
          },
        })
    }
    return ranges
  }
  private async manifest(base: string, head: string, mode: RepositoryComparisonMode = 'endpoint') {
    const from = await this.at(base),
      to = await this.at(head)
    const first = await this.read(() =>
      this.client.repository.compare({ ...this.target, base: from, head: to, mode })
    )
    const rest = first.cursor
      ? await this.pages((cursor) =>
          this.client.repository.compare({
            ...this.target,
            base: from,
            head: to,
            mode,
            cursor: cursor ?? first.cursor!,
          })
        )
      : { entries: [], incomplete: false, omissions: [] }
    if (first.incomplete || rest.incomplete)
      throw new Error(
        [...first.omissions, ...rest.omissions].join(' · ') || 'Incomplete comparison'
      )
    return { ...first, entries: [...first.entries, ...rest.entries] }
  }
  private async diffFiles(
    manifest: Awaited<ReturnType<NodeRepositorySource['manifest']>>
  ): Promise<DiffFile[]> {
    const ref = this.remember(manifest.head)
    return manifest.entries.map((e) => {
      const file: DiffFile = {
        path: e.path,
        status: changedStatus(e.status),
        ...(e.index !== undefined
          ? {
              staged: ![' ', '?'].includes(e.index),
              unstaged: ![' ', '!'].includes(e.worktree ?? ' '),
              untracked: e.index === '?',
            }
          : {}),
        additions: 0,
        deletions: 0,
        hash: e.path,
        blobUrl: this.navigation.file(
          e.status.startsWith('D') ? this.remember(manifest.base) : ref,
          e.path
        ),
        reviewComments: [],
      }
      let pending: Promise<void> | undefined
      file.loadPatch = () =>
        (pending ??= this.read(async () => {
          const blob = await this.client.repository.patch({
            ...this.target,
            comparison_id: manifest.comparison_id,
            path: e.path,
          })
          const patch = blob.content_id
            ? await this.content(blob.content_id, 8 * 1024 * 1024)
            : undefined
          this.assertCurrent()
          file.patch = patch
          file.diffNote = !patch ? 'No text patch is available for this file.' : undefined
          const lines = patch ? parsePatch(patch) : []
          file.additions = lines.filter((l) => l.type === 'add').length
          file.deletions = lines.filter((l) => l.type === 'del').length
        }).catch((error) => {
          pending = undefined
          throw error
        }))
      return file
    })
  }
  async compare(
    base: string | undefined,
    head: string,
    direct = true,
    mode?: RepositoryComparisonMode
  ): Promise<CompareData> {
    const from = base ?? (await this.defaultBranch()),
      manifest = await this.manifest(from, head, mode ?? (direct ? 'endpoint' : 'merge-base'))
    const baseSha = this.remember(manifest.base),
      headSha = this.remember(manifest.head)
    const headHistory =
      manifest.head.kind === 'working' && !manifest.head.head
        ? { entries: [] as Commit[], cursor: null as string | null, incomplete: false }
        : await this.read(() =>
            this.client.repository.history({ ...this.target, revision: manifest.head, limit: 100 })
          )
    const baseHistory = await this.read(() =>
      this.client.repository.history({ ...this.target, revision: manifest.base, limit: 100 })
    )
    const baseCommits = new Set(baseHistory.entries.map((c) => c.commit))
    const commits = headHistory.entries.filter((c) => !baseCommits.has(c.commit)).map(summary)
    const modeLabel =
      manifest.mode === 'staged'
        ? 'Staged changes · HEAD to index'
        : manifest.mode === 'unstaged'
          ? 'Unstaged changes · index to Working tree'
          : manifest.mode === 'endpoint'
            ? 'Endpoint comparison'
            : 'Merge-base comparison'
    return {
      base: baseSha,
      head: headSha,
      direct: manifest.mode !== 'merge-base',
      mode: manifest.mode,
      status: manifest.entries.length ? 'changed' : 'identical',
      aheadBy: commits.length,
      behindBy: 0,
      totalCommits: commits.length,
      commits,
      commitsComplete:
        !headHistory.cursor &&
        !baseHistory.cursor &&
        !headHistory.incomplete &&
        !baseHistory.incomplete,
      files: await this.diffFiles(manifest),
      filesComplete: true,
      additions: 0,
      deletions: 0,
      headSha,
      mergeBaseSha: baseSha,
      url: this.navigation.comparison(baseSha, headSha, direct, manifest.mode),
      note: `${modeLabel}${manifest.head.kind === 'working' ? ' · Working tree is observed, not atomic. Refresh if files changed on disk.' : ''}`,
    }
  }
  async comparison(base: string, head: string, signal?: AbortSignal): Promise<ComparisonIndex> {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
    const manifest = await this.manifest(base, head),
      baseSha = this.remember(manifest.base),
      targetSha = this.remember(manifest.head)
    const before = await this.tree(baseSha),
      after = await this.tree(targetSha)
    const changes: FileChange[] = manifest.entries.map((e) => ({
      path: e.path,
      status: changedStatus(e.status),
      ...(e.status.startsWith('A') || e.status === '??'
        ? {}
        : { base: { name: e.path.split('/').pop()!, path: e.path, kind: 'file' as const } }),
      ...(e.status.startsWith('D')
        ? {}
        : { target: { name: e.path.split('/').pop()!, path: e.path, kind: 'file' as const } }),
    }))
    const index: ComparisonIndex = {
      baseSha,
      targetSha,
      base: before,
      target: after,
      changes,
      counts: new Map(),
    }
    this.comparisonIds.set(index, manifest.comparison_id)
    return index
  }
  async comparisonFile(
    index: ComparisonIndex,
    path: string,
    large = false,
    signal?: AbortSignal
  ): Promise<PinnedFile> {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
    const change = index.changes.find((e) => e.path === path) ?? {
      path,
      status: 'unchanged' as const,
      base: { name: path.split('/').pop()!, path, kind: 'file' as const },
      target: { name: path.split('/').pop()!, path, kind: 'file' as const },
    }
    const readSide = async (ref: string) => {
      const revision = await this.at(ref),
        blob = await this.read(() =>
          this.client.repository.blob({ ...this.target, revision, path, larger: large })
        )
      if (blob.content_id) this.rememberContent(ref, path, blob.content_id)
      return blob.binary
        ? { kind: 'binary' as const }
        : !blob.content_id
          ? { kind: 'unsupported' as const }
          : {
              kind: 'text' as const,
              text: await this.content(blob.content_id, large ? 16 * 1024 * 1024 : 1024 * 1024),
            }
    }
    const before = change.base
        ? await readSide(index.baseSha)
        : { kind: 'text' as const, text: '' },
      after = change.target ? await readSide(index.targetSha) : { kind: 'text' as const, text: '' }
    const text =
      before.text !== undefined && after.text !== undefined
        ? fullDiff(before.text, after.text)
        : undefined
    if (text)
      index.counts.set(path, {
        state: 'ready',
        additions: text.additions,
        deletions: text.deletions,
      })
    this.assertCurrent()
    return {
      baseSha: index.baseSha,
      targetSha: index.targetSha,
      path,
      index,
      change,
      before,
      after,
      text,
      note: !text ? 'Binary or large file · open each side separately.' : undefined,
      canLoadLarge: !text && !large,
    }
  }
  async search(request: RepositorySearch): Promise<CodeResults> {
    const revision = await this.at(request.ref),
      q = request.query
    if (request.signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
    const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const query = q.wholeWord
      ? `(?<![\\w$])(?:${q.regex ? q.text : escape(q.text)})(?![\\w$])`
      : q.text
    const page = await this.pages(
      (cursor) => {
        if (request.signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
        return this.client.repository.search({
          ...this.target,
          revision,
          query,
          mode:
            request.scope === 'names' ? 'filename' : q.regex || q.wholeWord ? 'regex' : 'literal',
          case_sensitive: q.caseSensitive,
          path_glob: request.glob || undefined,
          scope: request.scope === 'changes' ? 'changed' : 'repository',
          cursor,
        })
      },
      1000,
      true
    )
    const files = new Map<string, CodeResults['files'][number]>(),
      ref = this.remember(revision)
    for (const match of page.entries) {
      if (match.content_id) this.rememberContent(ref, match.path, match.content_id)
      let file = files.get(match.path)
      if (!file) {
        file = { path: match.path, url: this.navigation.file(ref, match.path), lines: [] }
        files.set(match.path, file)
      }
      if (match.line)
        file.lines.push({
          label: String(match.line),
          text: match.text,
          column: 0,
          length: 0,
          url: this.navigation.file(ref, match.path, match.line),
        })
    }
    this.assertCurrent()
    return {
      files: [...files.values()],
      total: page.entries.length,
      capped: page.incomplete,
      note: page.omissions.join(' · ') || undefined,
    }
  }
  async definitions(ref: string, name: string, _fromPath: string, _limitBytes: number) {
    const results = await this.search({
      ref,
      scope: 'repo',
      query: {
        text: `(?:function|class|const|let|interface|type)\\s+${name.replace(/[^\w$]/g, '')}\\b`,
        regex: true,
      },
      glob: '',
      limitBytes: 0,
    })
    return results.files.flatMap((file) =>
      file.lines.map((line) => ({
        path: file.path,
        line: Number(line.label),
        text: line.text,
        column: 0,
        length: name.length,
      }))
    )
  }
  subscribe(listener: (event: RepositoryChange) => void) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  private emit(event: RepositoryChange) {
    for (const listener of this.listeners) listener(event)
  }
  async startWatching() {
    if (this.watching || this.disposed) return
    this.watching = true
    this.stopEvents = this.client.onEvent((event) => {
      const data = event.data as { project_id?: string; external_read?: boolean } | undefined
      if (
        event.type === 'project.repository_settings.changed' &&
        data?.project_id === this.identity.project
      ) {
        ++this.authorityGeneration
        this.textCache.clear()
        this.textBytes = 0
        if (this.external && data.external_read === false) {
          this.retired = true
          this.emit({ kind: 'authority' })
          window.clearTimeout(this.timer)
          return
        }
        this.refresh()
        this.emit({ kind: 'refs' })
      }
      if (event.type !== 'repository.invalidated') return
      const parsed = RepositoryInvalidationSchema.safeParse(event.data)
      if (
        !parsed.success ||
        parsed.data.project_id !== this.identity.project ||
        parsed.data.worktree_id !== this.identity.workspace
      )
        return
      this.refresh()
      this.textCache.clear()
      this.textBytes = 0
      this.emit({ kind: 'workspace' })
    })
    try {
      await this.read(() => this.client.subscribe('catalog'))
      await this.renewWatch()
    } catch {
      this.emit({ kind: 'workspace' })
      this.timer = window.setTimeout(() => {
        void this.renewWatch()
      }, 5000)
    }
  }
  private async renewWatch() {
    if (this.disposed || this.retired) return
    try {
      if (this.client.connected) {
        const lease = await this.read(() => this.client.repository.watch(this.target))
        this.subscription = lease.subscription_id
      }
    } catch {
      /* Reconnection polling will retry the bounded lease. */
    }
    if (!this.disposed)
      this.timer = window.setTimeout(() => {
        void this.renewWatch()
      }, 30000)
  }
  dispose() {
    this.disposed = true
    window.clearTimeout(this.timer)
    this.stopEvents?.()
    this.aliases.clear()
    this.textCache.clear()
    this.textBytes = 0
    if (this.subscription)
      void this.client.repository
        .unwatch({ ...this.target, subscription_id: this.subscription })
        .catch(() => {})
    this.listeners.clear()
  }
}

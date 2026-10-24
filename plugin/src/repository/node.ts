import {
  uiFieldMessage,
  uiFields,
  uiMessage,
  copyUiField,
  uiField,
  UiError,
} from '@/i18n/streamBErrors'

import { reactive } from 'vue'
import { compileQuery } from '@/github/search/textSearch'
import type {
  NodeClient,
  RepositoryClient,
  RepositoryRevision as NodeRevision,
} from '@abele/node-client'
import {
  RepositoryChangeBatchSchema,
  RepositoryInvalidationSchema,
  type RepositoryChangeBatch,
  type RepositoryChangesCursor,
} from '@abele/node-protocol'
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
import { readNodeImage } from '@/node/nodeImagePreview'
import { nodeRepositoryLink } from './nodeLinks'
import { applyTreeChanges, nodeTreeNode } from './nodeTreeChanges'

export const WORKING_TREE = 'Working tree'
export const EMPTY_TREE = 'Empty tree'
const workingPrefix = 'working-'
export const nodeRevisionLabel = (ref: string): string =>
  ref === WORKING_TREE || ref.startsWith(workingPrefix) ? 'Current files' : ref
export type NodeRepositoryClient = Pick<
  NodeClient,
  'repository' | 'onEvent' | 'subscribe' | 'connected'
> &
  Partial<Pick<NodeClient, 'nodePath' | 'describe'>>
type NodeIdentity = Extract<RepositoryIdentity, { provider: 'node' }>
const isStale = (error: unknown) =>
  !!error && typeof error === 'object' && (error as { code?: unknown }).code === 'stale_revision'
const staleComparison = () => new UiError(uiMessage('streamBError.9ae33c33a2'))
type Page<T> = { entries: T[]; cursor: string | null; incomplete: boolean; omissions: string[] }
type Commit = Awaited<ReturnType<RepositoryClient['commit']>>
const summary = (c: Commit): CommitSummary => ({
  sha: c.commit,
  author: c.author,
  date: c.authored_at,
  message: c.message,
})
// Tabs share the node's read capacity. Keep room for file and tree reads as well.
const blameCommitQueues = new WeakMap<
  NodeRepositoryClient,
  { active: number; waiting: (() => void)[] }
>()
async function withBlameCommitSlot<T>(client: NodeRepositoryClient, read: () => Promise<T>) {
  let queue = blameCommitQueues.get(client)
  if (!queue) blameCommitQueues.set(client, (queue = { active: 0, waiting: [] }))
  if (queue.active >= 2) await new Promise<void>((resolve) => queue.waiting.push(resolve))
  else ++queue.active
  try {
    return await read()
  } finally {
    const next = queue.waiting.shift()
    if (next) next()
    else --queue.active
  }
}
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
  private mutableWatch = false
  /** Set once the node is known to send change batches; null until asked. */
  private changeStream: Promise<boolean> | null = null
  private watchRenewal = false
  private streaming = false
  private cursor?: RepositoryChangesCursor
  /** Batches that arrived before the lease said where the stream stands. */
  private early: RepositoryChangeBatch[] = []
  /** Settles once the first lease said whether and where the change stream stands. */
  private ready?: Promise<void>
  /** Bumped by every reread: what was read before it no longer follows the stream. */
  private epoch = 0
  /** The latest complete batches of this epoch, so a read that overlapped them catches up. */
  private recent: RepositoryChangeBatch[] = []
  /** Where the stream stood when each observation of the current files was taken. */
  private observedAt = new Map<string, { epoch: number; revision: number }>()
  /** Roots of the trees of the current files handed out, patched by every batch. */
  private liveRoots = new WeakSet<TreeNode>()
  private liveTrees = new Set<WeakRef<TreeNode>>()
  private comparisonIds = new WeakMap<ComparisonIndex, string>()
  readonly navigation: RepositorySource['navigation']
  constructor(
    private readonly client: NodeRepositoryClient,
    readonly identity: NodeIdentity,
    private readonly labels: { node: string; project: string; isCurrent?: () => boolean },
    revision?: RepositoryRevision
  ) {
    this.identity = Object.freeze({ ...identity })
    this.cacheNamespace = `${JSON.stringify(this.identity)}:${crypto.randomUUID()}`
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
        this.identity,
        location.kind === 'file' && contentId ? { ...location, contentId } : location,
        ref ? this.revision(ref) : undefined
      )
    }
    this.navigation = {
      workspace: (id) =>
        nodeRepositoryLink(
          { ...this.identity, workspace: id },
          { kind: 'home', ref: WORKING_TREE }
        ),
      home: (ref = WORKING_TREE) => link({ kind: 'home', ref }),
      file: (ref, path, line) =>
        link({ kind: 'file', ref, path, ...(line ? { lines: { from: line, to: line } } : {}) }),
      folder: (ref, path) => link({ kind: 'folder', ref, path }),
      commit: (commit) => link({ kind: 'commit', commit }),
      comparison: (base, head, direct = true, mode, baseName) =>
        link({
          kind: 'comparison',
          base,
          ...(baseName && baseName !== base ? { baseName } : {}),
          head,
          direct,
          ...(mode ? { mode } : {}),
        }),
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
    if (!this.isCurrent) throw new UiError(uiMessage('streamBError.a890b77334'))
  }
  private async read<T>(work: () => Promise<T>): Promise<T> {
    this.assertCurrent()
    const generation = this.authorityGeneration
    const value = await work()
    this.assertCurrent()
    if (generation !== this.authorityGeneration)
      throw new UiError(uiMessage('streamBError.1d3298ac1d'))
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
    this.forget('reconnect')
    this.refresh()
    this.textCache.clear()
    this.textBytes = 0
    this.emit({ kind: 'workspace' })
  }
  async resolve(ref = WORKING_TREE): Promise<string> {
    // Agent reads use the protocol-neutral selector; owner tab state retains its legacy alias.
    if (ref === 'WORKTREE') ref = WORKING_TREE
    this.assertCurrent()
    if (this.revisions.has(ref)) return ref
    if (ref.startsWith(workingPrefix)) throw new UiError(uiMessage('streamBError.b46591df0d'))
    let pending = this.aliases.get(ref)
    if (!pending) {
      // Taken before asking: every batch after this mark may be missing from the observation.
      const mark = ref === WORKING_TREE ? this.mark() : null
      pending = this.read(async () => {
        const key = this.remember(
          ref === WORKING_TREE
            ? (await this.client.repository.observe(this.target)).revision
            : await this.client.repository.resolve({ ...this.target, ref })
        )
        if (mark) {
          this.observedAt.set(key, mark)
          if (this.observedAt.size > 64)
            this.observedAt.delete(this.observedAt.keys().next().value!)
        }
        return key
      })
      this.aliases.set(ref, pending)
      if (this.aliases.size > 64) this.aliases.delete(this.aliases.keys().next().value!)
      void pending.catch(() => {
        if (this.aliases.get(ref) === pending) this.aliases.delete(ref)
      })
    }
    return pending
  }
  private async at(ref: string): Promise<NodeRevision> {
    const key = await this.resolve(ref)
    const revision = this.revisions.get(key)
    if (!revision) throw new UiError(uiMessage('streamBError.1a2309dd33'))
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
        throw new UiError(uiMessage('streamBError.b930e16c73'))
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
    if (!page.default_branch) throw new UiError(uiMessage('streamBError.7de42eef4a'))
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
      throw new UiError(uiMessage('streamBError.696ab2ea7b'))
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
    this.assertCurrent()
    if (ref === EMPTY_TREE)
      return {
        root: { name: '', path: '', kind: 'dir', children: [] },
        sha: EMPTY_TREE,
        truncated: false,
        expand: async () => {},
        reveal: async () => {},
      }
    // A tab reads its tree beside the watch it has just started: wait for the stream to say
    // where it stands, so the tree can follow it instead of being read again at once.
    if (ref === WORKING_TREE || this.revisions.get(ref)?.kind === 'working')
      await this.streamSettled()
    const sha = await this.resolve(ref),
      revision = await this.at(sha)
    // Reactive, as GitHub's tree is: a folder read later appears in whatever shows the tree.
    const root: TreeNode = reactive({ name: '', path: '', kind: 'dir' })
    const liveRoots = () => this.liveRoots
    /** Reads one folder; at the files as they are now while the stream is followed. */
    const read = async (node: TreeNode, fresh: boolean) => {
      // The caller's observation may predate the stream; a fresh one knows where it stood.
      const key = fresh ? await this.resolve(WORKING_TREE) : sha
      const at = fresh ? await this.at(key) : revision
      const page = await this.pages((cursor) =>
        this.client.repository.tree({ ...this.target, revision: at, path: node.path, cursor })
      )
      node.children = sortNodes(page.entries.map(nodeTreeNode))
      return key
    }
    const expand = async (node: TreeNode) => {
      if (node.kind !== 'dir' || node.children) return
      // The current files on the change stream are patched in place, so a folder opened later
      // is read as the files are now, then given the batches that overlapped the read.
      const following = liveRoots().has(root)
      const key = await read(node, following)
      if (following && liveRoots().has(root)) this.catchUp(root, key)
    }
    const key = await read(root, revision.kind === 'working' && this.streaming)
    if (revision.kind === 'working' && this.catchUp(root, key)) {
      this.liveRoots.add(root)
      this.liveTrees.add(new WeakRef(root))
    }
    if (revision.kind === 'working')
      console.debug('[Abele] node repository: a tree of the current files', {
        live: this.liveRoots.has(root),
        streaming: this.streaming,
        at: this.observedAt.get(key) ?? null,
        cursor: this.cursor ?? null,
        epoch: this.epoch,
      })
    return {
      root,
      sha,
      truncated: true,
      get live() {
        return liveRoots().has(root)
      },
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
  async image(ref: string, path: string): Promise<Blob> {
    if (
      !path ||
      path.startsWith('/') ||
      path.includes('\\') ||
      path.split('/').some((part) => part === '..' || part === '.')
    )
      throw new Error('Invalid repository image path')
    const revision = await this.at(await this.resolve(ref))
    return this.read(async () => {
      const blob = await this.read(() =>
        this.client.repository.blob({ ...this.target, revision, path })
      )
      const image = await readNodeImage(path, blob, (offset) =>
        this.read(() =>
          this.client.repository.content({ ...this.target, content_id: blob.content_id!, offset })
        )
      )
      return new Blob([image.bytes], { type: image.mime })
    })
  }
  largeBlob(ref: string, path: string, contentId?: string) {
    return this.blob(ref, path, contentId, true)
  }
  async blob(ref: string, path: string, contentId?: string, larger = false): Promise<BlobData> {
    try {
      return await this.readBlob(ref, path, contentId, larger)
    } catch (error) {
      if (ref !== WORKING_TREE || contentId || !isStale(error)) throw error
      // A cached observation can expire before the change stream reaches this view.
      // Only the live alias may move; retained bytes and explicit revisions stay fixed.
      console.debug('[Abele] node repository: stale live file; observing again', { path })
      this.aliases.delete(WORKING_TREE)
      return this.readBlob(ref, path, undefined, larger)
    }
  }
  private async readBlob(
    ref: string,
    path: string,
    contentId?: string,
    larger = false
  ): Promise<BlobData> {
    console.debug('[Abele] node repository: file read requested', {
      workspace: this.identity.workspace,
      ref,
      path,
      retained: !!contentId,
    })
    const limit = (larger ? 16 : 1) * 1024 * 1024
    if (contentId) {
      const first = await this.read(() =>
        this.client.repository.content({ ...this.target, content_id: contentId, offset: 0 })
      )
      if (first.total > limit)
        return uiFields(
          {
            ref,
            path,
            text: '',
            contentId,
            url: this.navigation.file(ref, path),
            note: 'This retained file is too large for automatic display.',
            canLoadLarge: !larger && first.total <= 16 * 1024 * 1024,
          },
          { note: uiMessage('streamBError.888e010715') }
        )
      const text = await this.content(contentId, limit)
      this.rememberContent(ref, path, contentId)
      return { ref, path, text, contentId, url: this.navigation.file(ref, path) }
    }
    const sha = await this.resolve(ref),
      revision = await this.at(sha)
    const blob = await this.read(() =>
      this.client.repository.blob({ ...this.target, revision, path, larger })
    )
    console.debug('[Abele] node repository: file read answered', {
      workspace: this.identity.workspace,
      path,
      ref: sha,
      contentId: blob.content_id,
    })
    if (blob.content_id) this.rememberContent(sha, path, blob.content_id)
    const note = blob.binary
      ? 'Binary file · no text preview.'
      : blob.too_large || blob.requires_larger_load
        ? 'This file is too large for automatic display.'
        : undefined
    return uiFields(
      {
        ref: sha,
        path,
        text: !note && blob.content_id ? await this.content(blob.content_id, limit) : '',
        url: this.navigation.file(sha, path),
        contentId: blob.content_id,
        canLoadLarge: blob.requires_larger_load && !blob.too_large,
        note,
      },
      {
        note: blob.binary
          ? uiMessage('streamBError.6018e8db9e')
          : blob.too_large || blob.requires_larger_load
            ? uiMessage('streamBError.96018da9a1')
            : undefined,
      }
    )
  }
  private rememberContent(ref: string, path: string, id: string) {
    this.fileContents.set(JSON.stringify([ref, path]), id)
    if (this.fileContents.size > 2048)
      this.fileContents.delete(this.fileContents.keys().next().value!)
  }
  async contentIdentity(ref: string, path: string) {
    this.assertCurrent()
    return this.fileContents.get(JSON.stringify([await this.resolve(ref), path]))
  }
  async text(ref: string, path: string) {
    const blob = await this.blob(ref, path)
    if (blob.note) throw new UiError(uiFieldMessage(blob, 'note'))
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
    // The page shows the files alone: no commit lists, and no lookups of ids the node just named.
    const files = c.parents.length
      ? await this.diffFiles(
          await this.manifest(
            this.remember({ kind: 'commit', commit: c.parents[0] }),
            this.remember({ kind: 'commit', commit: c.commit })
          )
        )
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
      if (files.length >= 4096) throw new UiError(uiMessage('streamBError.88e5c20cd0'))
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
          copyUiField(blob, 'note', file, 'diffNote')
          return
        }
        const lines = blob.text.match(/[^\n]*\n|[^\n]+$/g) ?? []
        if (lines.length > 100000) throw new UiError(uiMessage('streamBError.b0f4afdb21'))
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
    const load = (start: number) =>
      this.pages(
        (cursor) =>
          this.client.repository.blame({
            ...this.target,
            revision,
            path,
            start,
            count: 1500,
            cursor,
          }),
        1500
      )
    const page = await load(1)
    let batch = page,
      bytes = JSON.stringify(page.entries).length
    // Count selects a line range; cursors only paginate within that range.
    while (batch.entries.length === 1500) {
      batch = await load(batch.entries.at(-1)!.line + 1)
      bytes += JSON.stringify(batch.entries).length
      if (page.entries.length + batch.entries.length > 100000 || bytes > 4 * 1024 * 1024)
        throw new UiError(uiMessage('streamBError.b930e16c73'))
      page.entries.push(...batch.entries)
    }
    // Blame lines carry identities and authors only. Read immutable commit metadata without
    // loading each commit's changed files, and share it across every range of that commit.
    const commits = [...new Set(page.entries.flatMap((line) => (line.commit ? [line.commit] : [])))]
    const metadata = new Map<string, CommitSummary>()
    for (let from = 0; from < commits.length; from += 2) {
      await Promise.all(
        commits.slice(from, from + 2).map(async (commit): Promise<void> => {
          const result = await withBlameCommitSlot(this.client, () =>
            this.read(async () => {
              for (let attempt = 0; attempt < 3; ++attempt) {
                this.assertCurrent()
                try {
                  return await this.client.repository.commit({
                    ...this.target,
                    revision: { kind: 'commit', commit },
                  })
                } catch (error) {
                  this.assertCurrent()
                  if (
                    attempt === 2 ||
                    !error ||
                    typeof error !== 'object' ||
                    (error as { code?: unknown }).code !== 'resource_busy'
                  ) {
                    console.debug('[Abele] node blame: commit metadata unavailable', commit, error)
                    return undefined
                  }
                  console.debug(
                    '[Abele] node blame: retrying busy commit metadata',
                    commit,
                    attempt + 1
                  )
                  await new Promise((resolve) => window.setTimeout(resolve, 50 * (attempt + 1)))
                }
              }
            })
          )
          if (result) metadata.set(commit, summary(result))
        })
      )
    }
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
          commit: metadata.get(sha) ?? {
            sha,
            author: line.commit ? line.author : 'Uncommitted',
            message: line.commit ? '' : WORKING_TREE,
            date: '',
          },
        })
    }
    return ranges
  }
  private async manifest(base: string, head: string, mode: RepositoryComparisonMode = 'endpoint') {
    const from = base === EMPTY_TREE ? { kind: 'empty' as const } : await this.at(base)
    let to = await this.at(head)
    const ask = () =>
      this.read(() =>
        this.client.repository.compare({ ...this.target, base: from, head: to, mode })
      )
    let first: Awaited<ReturnType<typeof ask>>
    try {
      first = await ask()
    } catch (error) {
      if (!isStale(error)) throw error
      if (to.kind !== 'working') throw staleComparison()
      // The current files moved on since they were observed: compare them as they are now.
      console.debug('[Abele] node comparison: the current files changed, observing them again')
      this.aliases.delete(WORKING_TREE)
      to = await this.at(WORKING_TREE)
      first = await ask().catch((again) => {
        throw isStale(again) ? staleComparison() : again
      })
    }
    const rest = first.cursor
      ? await this.pages((cursor) =>
          this.client.repository.compare({
            ...this.target,
            base: from,
            head: to,
            mode,
            cursor: cursor ?? first.cursor!,
          })
        ).catch((error) => {
          throw isStale(error) ? staleComparison() : error
        })
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
        countsPending: true,
        hash: e.path,
        blobUrl: this.navigation.file(
          e.status.startsWith('D') && manifest.base.kind !== 'empty'
            ? this.remember(manifest.base)
            : ref,
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
          uiField(file, 'diffNote', !patch ? uiMessage('streamBError.d2999e7b21') : undefined)
          const lines = patch ? parsePatch(patch) : []
          file.additions = lines.filter((l) => l.type === 'add').length
          file.deletions = lines.filter((l) => l.type === 'del').length
          // A file with no text patch has no lines to count: its counts stay unknown, never 0.
          file.countsPending = !patch
        }).catch((error) => {
          pending = undefined
          throw isStale(error) ? staleComparison() : error
        }))
      return file
    })
  }
  async compare(
    base: string | undefined,
    head: string,
    direct = true,
    mode?: RepositoryComparisonMode,
    baseName?: string
  ): Promise<CompareData> {
    const from = base ?? (await this.defaultBranch()),
      manifest = await this.manifest(from, head, mode ?? (direct ? 'endpoint' : 'merge-base'))
    const baseSha = manifest.base.kind === 'empty' ? EMPTY_TREE : this.remember(manifest.base),
      headSha = this.remember(manifest.head)
    const headHistory =
      manifest.head.kind === 'working' && !manifest.head.head
        ? { entries: [] as Commit[], cursor: null as string | null, incomplete: false }
        : await this.read(() =>
            this.client.repository.history({ ...this.target, revision: manifest.head, limit: 100 })
          )
    const baseRevision = manifest.base
    const baseHistory =
      baseRevision.kind === 'empty'
        ? { entries: [] as Commit[], cursor: null as string | null, incomplete: false }
        : await this.read(() =>
            this.client.repository.history({ ...this.target, revision: baseRevision, limit: 100 })
          )
    const baseCommits = new Set(baseHistory.entries.map((c) => c.commit))
    const commits = headHistory.entries.filter((c) => !baseCommits.has(c.commit)).map(summary)
    let divergence:
      | Awaited<ReturnType<NonNullable<NodeRepositoryClient['nodePath']>['divergence']>>
      | undefined
    if (manifest.head.kind === 'working' && this.client.nodePath) {
      const supported =
        !this.client.describe ||
        (await import('@/node/NodePathClientPort'))
          .supportedNodePathCapabilities(await this.read(() => this.client.describe!()))
          .includes('node_path_v2')
      if (supported)
        divergence = await this.read(() =>
          this.client.nodePath!.divergence({
            ...this.target,
            ...(base && base !== EMPTY_TREE ? { base_ref: base } : {}),
          })
        )
    }
    return uiFields(
      {
        base: baseSha,
        ...(baseName && baseName !== baseSha ? { baseName } : {}),
        head: headSha,
        direct: manifest.mode !== 'merge-base',
        mode: manifest.mode,
        status: manifest.entries.length ? 'changed' : 'identical',
        aheadBy: divergence?.ahead ?? null,
        behindBy: divergence?.behind ?? null,
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
        url: this.navigation.comparison(baseSha, headSha, direct, manifest.mode, baseName),
        note:
          manifest.head.kind === 'working'
            ? 'Files can change while you look. Refresh to update.'
            : manifest.mode === 'merge-base'
              ? 'Changes since the common ancestor.'
              : undefined,
      },
      {
        note:
          manifest.head.kind === 'working'
            ? uiMessage('streamBError.b2d5677c39')
            : manifest.mode === 'merge-base'
              ? uiMessage('streamBError.f3d48d14b9')
              : undefined,
      }
    )
  }
  async comparison(base: string, head: string, signal?: AbortSignal): Promise<ComparisonIndex> {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
    const manifest = await this.manifest(base, head),
      baseSha = manifest.base.kind === 'empty' ? EMPTY_TREE : this.remember(manifest.base),
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
    return uiFields(
      {
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
      },
      { note: !text ? uiMessage('streamBError.9da9b97d87') : undefined }
    )
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
    const expression = compileQuery(q)
    for (const match of page.entries) {
      if (match.content_id) this.rememberContent(ref, match.path, match.content_id)
      let file = files.get(match.path)
      if (!file) {
        file = { path: match.path, url: this.navigation.file(ref, match.path), lines: [] }
        files.set(match.path, file)
      }
      if (match.line) {
        expression.lastIndex = 0
        const highlight = expression.exec(match.text)
        file.lines.push({
          label: String(match.line),
          text: match.text,
          column: highlight?.index ?? 0,
          length: highlight?.[0].length ?? 0,
          url: this.navigation.file(ref, match.path, match.line),
        })
      }
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
    console.debug('[Abele] node repository: notify views', {
      workspace: this.identity.workspace,
      subscription: this.subscription,
      ...event,
      listeners: this.listeners.size,
    })
    for (const listener of this.listeners) listener(event)
  }
  async startWatching(mutable = true) {
    if (this.disposed) return
    this.mutableWatch = mutable
    if (this.watching) {
      if (mutable && !this.timer) await this.renewWatch()
      return
    }
    this.watching = true
    this.stopEvents = this.client.onEvent((event) => {
      const data = event.data as
        | {
            project_id?: string
            worktree_id?: string
            external_read?: boolean
            refresh_required?: boolean
          }
        | undefined
      if (
        event.type === 'stream.redacted' &&
        event.stream_id === 'catalog' &&
        data?.refresh_required === true
      ) {
        // The skipped event may have changed permissions or any mutable repository state.
        ++this.authorityGeneration
        this.reconnect()
        return
      }
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
      if (event.type === 'repository.changed') {
        const batch = RepositoryChangeBatchSchema.safeParse(event.data)
        if (
          data?.project_id === this.identity.project &&
          data.worktree_id === this.identity.workspace
        )
          console.debug('[Abele] node repository: batch delivered', {
            workspace: this.identity.workspace,
            valid: batch.success,
            streaming: this.streaming,
            cursor: this.cursor,
          })
        if (
          batch.success &&
          // Before the first lease answers, batches are kept until it says where the stream is.
          (this.streaming || !this.cursor) &&
          batch.data.project_id === this.identity.project &&
          batch.data.worktree_id === this.identity.workspace
        )
          this.changed(batch.data)
        else if (
          !batch.success &&
          data?.project_id === this.identity.project &&
          data.worktree_id === this.identity.workspace
        ) {
          console.debug(
            '[Abele] node repository: unreadable batch; rereading the files',
            batch.error
          )
          this.reread(this.cursor)
        }
        return
      }
      if (event.type !== 'repository.invalidated') return
      const parsed = RepositoryInvalidationSchema.safeParse(event.data)
      if (
        !parsed.success ||
        parsed.data.project_id !== this.identity.project ||
        parsed.data.worktree_id !== this.identity.workspace
      )
        return
      // On the change stream every filesystem edit, our own saves included, arrives as a batch.
      if (this.streaming && parsed.data.reason === 'filesystem') return
      this.refresh()
      this.emit({ kind: 'workspace' })
    })
    const ready = (async () => {
      try {
        await this.read(() => this.client.subscribe('catalog'))
        if (this.mutableWatch) await this.renewWatch()
      } catch {
        this.emit({ kind: 'workspace' })
        if (this.mutableWatch && !this.disposed && !this.retired)
          this.timer = window.setTimeout(() => {
            void this.renewWatch()
          }, 5000)
      }
    })()
    this.ready = ready
    await ready
  }
  /** Waits, briefly, for the first lease; a slow node does not hold the tree back for long. */
  private async streamSettled() {
    if (!this.ready) return
    let timer: number | undefined
    await Promise.race([
      this.ready,
      new Promise<void>((resolve) => (timer = window.setTimeout(resolve, 3000))),
    ])
    window.clearTimeout(timer)
  }
  private mark() {
    return this.streaming && this.cursor
      ? { epoch: this.epoch, revision: this.cursor.revision }
      : null
  }
  /**
   * Applies to a tree read at `revision` the batches that came after its observation. False when
   * that cannot be known — taken before the stream, before a reread, or too long ago — and the
   * tree has to be read again instead.
   */
  private catchUp(root: TreeNode, key: string) {
    const mark = this.observedAt.get(key)
    if (!mark || !this.cursor || mark.epoch !== this.epoch) return false
    const missed = this.recent.filter((batch) => batch.revision > mark.revision)
    if (missed.length !== this.cursor.revision - mark.revision) return false
    for (const batch of missed) if (batch.complete) applyTreeChanges(root, batch.entries)
    return true
  }
  /** Nothing handed out so far follows the stream any more; it is all read again. */
  private forget(reason: string) {
    console.debug('[Abele] node repository: the trees handed out stop following the stream', {
      reason,
      epoch: this.epoch,
    })
    this.epoch++
    this.recent = []
    this.observedAt.clear()
    this.liveRoots = new WeakSet()
    this.liveTrees.clear()
  }
  stopWatching() {
    console.debug('[Abele] node repository: watch stopped', {
      workspace: this.identity.workspace,
      subscription: this.subscription,
    })
    this.mutableWatch = false
    window.clearTimeout(this.timer)
    this.timer = undefined
    const subscription = this.subscription
    this.subscription = undefined
    if (subscription)
      void this.client.repository
        .unwatch({ ...this.target, subscription_id: subscription })
        .catch(() => {})
  }
  private supportsChanges() {
    const client = this.client
    // Called on the client itself: the node client's describe reads its own fields.
    this.changeStream ??= client.describe
      ? this.read(() => client.describe!())
          .then((description) => {
            const capabilities = (
              description as { capabilities?: { capabilities?: Record<string, unknown> } }
            )?.capabilities?.capabilities
            const stream = capabilities?.repository_changes_v1 as { status?: unknown } | undefined
            this.watchRenewal =
              (capabilities?.repository_watch_renewal_v1 as { status?: unknown } | undefined)
                ?.status === 'supported'
            return stream?.status === 'supported'
          })
          .catch(() => {
            this.changeStream = null
            return false
          })
      : Promise.resolve(false)
    return this.changeStream
  }
  /** Rereads everything once; batches after `cursor` describe what changes from there. */
  private reread(cursor?: RepositoryChangesCursor) {
    this.forget('reread')
    this.cursor = cursor
    this.refresh()
    this.emit({ kind: 'workspace' })
  }
  private changed(batch: RepositoryChangeBatch) {
    console.debug('[Abele] node repository: batch received', {
      workspace: this.identity.workspace,
      subscription: this.subscription,
      cursor: this.cursor,
      stream: batch.stream_id,
      revision: batch.revision,
      complete: batch.complete,
    })
    if (!this.cursor) {
      // The lease has not said yet where the stream stands; keep it until it does.
      if (this.early.length < 64) this.early.push(batch)
      return
    }
    if (batch.stream_id === this.cursor.stream_id && batch.revision <= this.cursor.revision) return
    const next = { stream_id: batch.stream_id, revision: batch.revision }
    if (
      !batch.complete ||
      batch.stream_id !== this.cursor.stream_id ||
      batch.revision !== this.cursor.revision + 1
    ) {
      console.debug('[Abele] node repository: rereading the files', {
        reason: 'reason' in batch ? batch.reason : 'revision gap',
        from: this.cursor,
        to: next,
      })
      this.reread(next)
      return
    }
    this.cursor = next
    this.recent.push(batch)
    if (this.recent.length > 32) this.recent.shift()
    // Reads after this one observe the files again; rows on screen are patched, not reread.
    this.aliases.delete(WORKING_TREE)
    if (batch.entries.length) {
      let paths: string[] | null = null
      for (const ref of this.liveTrees) {
        const root = ref.deref()
        if (root) paths = applyTreeChanges(root, batch.entries)
        else this.liveTrees.delete(ref)
      }
      if (!paths)
        paths = batch.entries.flatMap((e) =>
          e.change === 'deleted'
            ? [e.path]
            : e.change === 'renamed'
              ? [e.from, e.entry.path]
              : [e.entry.path]
        )
      this.emit({ kind: 'tree', paths: [...new Set(paths)] })
    }
    if (batch.git) this.emit({ kind: 'status', paths: batch.git.status.map((row) => row.path) })
  }
  private async renewWatch() {
    if (this.disposed || this.retired || !this.mutableWatch) return
    const previous = this.subscription
    try {
      if (this.client.connected) {
        const streaming = await this.supportsChanges()
        console.debug('[Abele] node repository: watch requested', {
          workspace: this.identity.workspace,
          previous,
          streaming,
          cursor: this.cursor,
        })
        const lease = await this.read(() =>
          this.client.repository.watch({
            ...this.target,
            ...(streaming ? { changes: this.cursor ?? null } : {}),
            ...(this.watchRenewal && previous ? { subscription_id: previous } : {}),
          })
        )
        if (!this.mutableWatch || this.disposed || this.retired) {
          void this.client.repository
            .unwatch({ ...this.target, subscription_id: lease.subscription_id })
            .catch(() => {})
          return
        }
        console.debug('[Abele] node repository: watch acquired', {
          workspace: this.identity.workspace,
          ...lease,
        })
        const firstLease = !this.subscription
        this.subscription = lease.subscription_id
        if (previous && previous !== lease.subscription_id)
          void this.client.repository
            .unwatch({ ...this.target, subscription_id: previous })
            .catch(() => {})
        if (streaming && lease.changes) {
          this.streaming = true
          const early = this.early.splice(0)
          if (lease.refresh_required) this.reread(lease.changes)
          // Behind the lease is fine: the node says every batch since is on its way here.
          else if (!this.cursor) this.cursor = lease.changes
          for (const batch of early) this.changed(batch)
        } else if (firstLease) {
          this.refresh()
          this.emit({ kind: 'workspace' })
        }
      }
    } catch (error) {
      console.debug('[Abele] node repository: watch failed', {
        workspace: this.identity.workspace,
        previous,
        code: (error as { code?: unknown })?.code,
      })
      // An expired or lost lease cannot be renewed; acquire a fresh one on the next retry.
      if (
        this.watchRenewal &&
        previous === this.subscription &&
        (error as { code?: unknown })?.code === 'unauthorized'
      )
        this.subscription = undefined
      /* Reconnection polling will retry the bounded lease. */
    }
    if (!this.disposed && !this.retired && this.mutableWatch)
      this.timer = window.setTimeout(() => {
        void this.renewWatch()
      }, 30000)
  }
  dispose() {
    this.disposed = true
    this.mutableWatch = false
    window.clearTimeout(this.timer)
    this.stopEvents?.()
    this.aliases.clear()
    this.textCache.clear()
    this.fileContents.clear()
    this.revisions.clear()
    this.forget('dispose')
    this.textBytes = 0
    if (this.subscription)
      void this.client.repository
        .unwatch({ ...this.target, subscription_id: this.subscription })
        .catch(() => {})
    this.listeners.clear()
  }
}

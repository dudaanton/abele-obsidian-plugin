import type {
  RepositorySource,
  RepositoryIdentity,
  RepositoryTree,
  RepositorySearch,
  RepositoryChange,
} from '@/repository/source'
import type { RepoHomeData } from '@/github/repoPage/repoHome'
import type { ComparisonIndex, PinnedFile } from '@/github/comparison/service'
import type { BlameRange } from '@/github/blame'
import { buildTree, findNode } from '@/github/tree/fileTree'
import { compareTrees } from '@/github/comparison/trees'
import { fullDiff } from '@/github/comparison/text'
import { RepoIndex } from '@/github/search/repoIndex'
import { findDefinitions } from '@/github/search/definitions'

/** A real source boundary without a GithubClient, HTTP routes, archives or credentials. */
export class InMemoryRepository implements RepositorySource {
  readonly identity: Extract<RepositoryIdentity, { provider: 'node' }> = {
    provider: 'node',
    installation: 'installation-1',
    node: 'node-1',
    project: 'project-1',
    workspace: 'workspace-1',
  }
  readonly cacheNamespace = 'memory-workspace-1'
  isCurrent = true
  readonly revisions = new Map<string, Record<string, string>>()
  readonly branches = new Map<string, string>()
  readonly blameRanges = new Map<string, BlameRange[]>()
  private readonly listeners = new Set<(event: RepositoryChange) => void>()
  readonly navigation = {
    home: (ref = 'main') => `memory:home/${encodeURIComponent(ref)}`,
    folder: (ref: string, path: string) => `memory:tree/${encodeURIComponent(ref)}/${path}`,
    file: (ref: string, path: string, line?: number) =>
      `memory:blob/${encodeURIComponent(ref)}/${path}${line ? `#L${line}` : ''}`,
    commit: (commit: string) => `memory:commit/${commit}`,
    comparison: (base: string, head: string) => `memory:compare/${base}..${head}`,
    blobLink: (ref: string, path: string, lines: { from: number; to: number }) => ({
      label: `${path}:${lines.from}–${lines.to}`,
      url: `memory:blob/${ref}/${path}#L${lines.from}-L${lines.to}`,
    }),
  }
  constructor(
    readonly head = 'b'.repeat(40),
    files: Record<string, string> = {}
  ) {
    this.revisions.set(head, files)
    this.branches.set('main', head)
  }
  assertCurrent() {
    if (!this.isCurrent) throw new Error('Source revoked')
  }
  subscribe(listener: (event: RepositoryChange) => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  invalidate(event: RepositoryChange) {
    for (const listener of this.listeners) listener(event)
  }
  retire() {
    this.isCurrent = false
    this.invalidate({ kind: 'authority' })
  }
  async resolve(ref = 'main') {
    this.assertCurrent()
    const commit = this.branches.get(ref) ?? ref
    if (!this.revisions.has(commit)) throw new Error(`Unknown revision: ${ref}`)
    return commit
  }
  private async files(ref: string) {
    return this.revisions.get(await this.resolve(ref))!
  }
  async defaultBranch() {
    this.assertCurrent()
    return 'main'
  }
  async refs(prefix = '') {
    this.assertCurrent()
    return {
      branches: [...this.branches.keys()].filter((ref) => ref.startsWith(prefix)),
      tags: [],
      more: false,
    }
  }
  async metadata(): Promise<RepoHomeData['meta']> {
    this.assertCurrent()
    return {
      owner: 'local',
      name: 'project',
      description: 'Local fixture',
      homepage: '',
      topics: [],
      stars: 0,
      forks: 0,
      watchers: 0,
      defaultBranch: 'main',
      license: null,
      visibility: 'local',
      archived: false,
      parent: null,
      hasIssues: false,
      url: this.navigation.home(),
    }
  }
  async home(ref = 'main'): Promise<RepoHomeData> {
    return { ...(await this.folder(ref, '')), meta: await this.metadata() }
  }
  async workspaces() {
    this.assertCurrent()
    return [
      {
        id: 'workspace-1',
        label: 'Main workspace',
        revision: { kind: 'commit' as const, commit: this.head },
        readOnly: true,
      },
    ]
  }
  async status() {
    this.assertCurrent()
    return { supported: true, files: [] }
  }
  async tree(ref: string): Promise<RepositoryTree> {
    const files = await this.files(ref)
    const root = buildTree(
      Object.entries(files).map(([path, text]) => ({
        path,
        sha: text || 'empty',
        type: 'blob',
        mode: '100644',
        size: text.length,
      }))
    )
    return {
      root,
      sha: await this.resolve(ref),
      truncated: false,
      expand: async () => {
        this.assertCurrent()
      },
      reveal: async () => {
        this.assertCurrent()
      },
    }
  }
  async folder(ref: string, path: string) {
    const node = findNode((await this.tree(ref)).root, path)
    if (!node || node.kind !== 'dir') throw new Error(`Unknown folder: ${path}`)
    return {
      ref,
      path,
      url: this.navigation.folder(ref, path),
      entries: (node.children ?? []).map((child) => ({
        name: child.name,
        path: child.path,
        kind: child.kind,
        size: child.size,
      })),
    }
  }
  async text(ref: string, path: string) {
    const text = (await this.files(ref))[path]
    if (text === undefined) throw new Error(`Unknown file: ${path}`)
    return text
  }
  async blob(ref: string, path: string) {
    return { ref, path, text: await this.text(ref, path), url: this.navigation.file(ref, path) }
  }
  async commit(commit: string) {
    return {
      sha: await this.resolve(commit),
      message: 'Fixture commit',
      author: 'Local author',
      date: '2026-10-09T10:00:00Z',
      url: this.navigation.commit(commit),
      files: [],
    }
  }
  async commits(ref: string) {
    return [await this.commit(ref)]
  }
  async blame(ref: string, path: string) {
    await this.text(ref, path)
    return this.blameRanges.get(path) ?? []
  }
  async comparison(base: string, head: string): Promise<ComparisonIndex> {
    const before = await this.tree(base),
      after = await this.tree(head)
    return {
      baseSha: before.sha,
      targetSha: after.sha,
      base: before,
      target: after,
      changes: await compareTrees(before, after),
      counts: new Map(),
    }
  }
  async comparisonFile(index: ComparisonIndex, path: string): Promise<PinnedFile> {
    this.assertCurrent()
    const change = index.changes.find((row) => row.path === path)
    if (!change) throw new Error('No changed file')
    const before = change.base ? await this.text(index.baseSha, change.base.path) : ''
    const after = change.target ? await this.text(index.targetSha, change.target.path) : ''
    const text = fullDiff(before, after)
    index.counts.set(path, { state: 'ready', additions: text.additions, deletions: text.deletions })
    return {
      baseSha: index.baseSha,
      targetSha: index.targetSha,
      path,
      index,
      change,
      before: { kind: 'text', text: before },
      after: { kind: 'text', text: after },
      text,
    }
  }
  async compare(base: string | undefined, head: string, direct = false) {
    const index = await this.comparison(base ?? 'main', head)
    return {
      base: base ?? 'main',
      head,
      direct,
      status: index.changes.length ? 'ahead' : 'identical',
      aheadBy: 0,
      behindBy: 0,
      totalCommits: 0,
      commits: [],
      commitsComplete: true,
      files: [],
      filesComplete: true,
      additions: 0,
      deletions: 0,
      headSha: index.targetSha,
      mergeBaseSha: index.baseSha,
      url: this.navigation.comparison(index.baseSha, index.targetSha),
    }
  }
  async search(request: RepositorySearch) {
    const files = Object.entries(await this.files(request.ref)).map(([path, text]) => ({
      path,
      text,
    }))
    if (request.signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
    if (request.scope === 'names') {
      const matches = files.filter((file) => file.path.includes(request.query.text))
      return {
        files: matches.map((file) => ({
          path: file.path,
          url: this.navigation.file(request.ref, file.path),
          lines: [],
        })),
        total: matches.length,
        capped: false,
      }
    }
    const index = new RepoIndex()
    index.files.push(...files)
    const result = await index.search(request.query, { glob: request.glob, signal: request.signal })
    return {
      ...result,
      files: result.files.map((file) => ({
        path: file.path,
        url: this.navigation.file(request.ref, file.path),
        lines: file.matches.map((match) => ({
          label: String(match.line),
          text: match.text,
          column: match.column,
          length: match.length,
          url: this.navigation.file(request.ref, file.path, match.line),
        })),
      })),
    }
  }
  async definitions(ref: string, name: string, fromPath: string) {
    return findDefinitions(
      Object.entries(await this.files(ref)).map(([path, text]) => ({ path, text })),
      name,
      fromPath
    )
  }
}

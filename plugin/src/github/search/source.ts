/**
 * Where searchable code comes from: the commit a tab stands on, the file list at that commit, the
 * whole repository at it as an in-memory index, and — for a repository too big to download —
 * GitHub's own code search, which only knows the default branch.
 */
import type { GithubClient } from '../client'
import { GithubError } from '../client'
import { commitSha } from '../api'
import { gunzip } from './tar'
import { IndexCache, RepoIndex, indexKey, type SearchResult } from './repoIndex'
import type { LineMatch } from './textSearch'

export interface RepoRef {
  host: string
  owner: string
  repo: string
}

const repoPath = (r: RepoRef) =>
  `/repos/${encodeURIComponent(r.owner)}/${encodeURIComponent(r.repo)}`

/** The branch a repository opens on, for a tab — an issue, a discussion — that names no commit. */
export async function defaultBranch(client: GithubClient, repo: RepoRef): Promise<string> {
  const data = await client.get<{ default_branch?: string }>(repoPath(repo), {
    what: 'the repository',
  })
  return data.default_branch ?? 'main'
}

/** The full SHA of a ref, or of the default branch when there is none. */
export async function resolveSha(
  client: GithubClient,
  repo: RepoRef,
  ref?: string
): Promise<string> {
  return commitSha(client, repo, ref || (await defaultBranch(client, repo)))
}

export interface TreeFile {
  path: string
  size: number
}

export interface TreeListing {
  files: TreeFile[]
  /** GitHub stopped listing — past 100,000 entries or 7 MB of answer. */
  truncated: boolean
  /** The files' sizes added up, uncompressed. */
  totalBytes: number
}

/** Every file at a commit, with its size, in one request. */
export async function loadTree(
  client: GithubClient,
  repo: RepoRef,
  sha: string
): Promise<TreeListing> {
  const data = await client.get<{
    tree?: Array<{ path: string; type: string; size?: number }>
    truncated?: boolean
  }>(`${repoPath(repo)}/git/trees/${encodeURIComponent(sha)}?recursive=1`, {
    what: "the repository's file list",
  })
  const files = (data.tree ?? [])
    .filter((e) => e.type === 'blob')
    .map((e) => ({ path: e.path, size: e.size ?? 0 }))
  return {
    files,
    truncated: !!data.truncated,
    totalBytes: files.reduce((n, f) => n + f.size, 0),
  }
}

/** File names that match: every word of the query somewhere in the path, or a glob. */
export function matchFileNames(files: TreeFile[], query: string, limit = 200): TreeFile[] {
  const q = query.trim().toLowerCase()
  if (!q) return files.slice(0, limit)
  const words = q.split(/\s+/)
  const scored: Array<{ file: TreeFile; score: number }> = []
  for (const file of files) {
    const path = file.path.toLowerCase()
    if (!words.every((w) => path.includes(w))) continue
    const name = path.slice(path.lastIndexOf('/') + 1)
    // The name itself matching beats a folder that happens to contain the word.
    const score = (words.every((w) => name.includes(w)) ? 0 : 1) * 1e6 + path.length
    scored.push({ file, score })
  }
  return scored
    .sort((a, b) => a.score - b.score)
    .slice(0, limit)
    .map((s) => s.file)
}

export class TooLargeError extends Error {
  constructor(
    readonly totalBytes: number,
    readonly limitBytes: number,
    readonly truncated: boolean
  ) {
    super(
      truncated
        ? 'GitHub would not list the whole repository — it is too big to download for a search.'
        : `The repository is ${mb(totalBytes)} at this commit, more than the ${mb(limitBytes)} set in Abele settings → GitHub.`
    )
    this.name = 'TooLargeError'
  }
}

export const mb = (bytes: number) =>
  `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`

export type Stage = 'listing' | 'downloading' | 'unpacking' | 'indexing'

export interface IndexRequest {
  limitBytes: number
  signal?: AbortSignal
  onStage?: (stage: Stage) => void
}

/** Every repository index built this session, shared by the tabs and the agent. */
export const indexes = new IndexCache()
const building = new Map<string, Promise<RepoIndex>>()

/**
 * The whole repository at a commit, searchable. Built once a session per commit — the archive is
 * downloaded, unpacked and kept as text — and refused, before anything is downloaded, when the
 * files at that commit add up to more than the limit.
 */
export async function repoIndex(
  client: GithubClient,
  repo: RepoRef,
  sha: string,
  request: IndexRequest
): Promise<RepoIndex> {
  const key = indexKey(repo.host, repo.owner, repo.repo, sha)
  const cached = indexes.get(key)
  if (cached) return cached
  // Two asks for the same commit — a search and a definition lookup — share one download.
  let pending = building.get(key)
  if (pending === undefined) {
    pending = build(client, repo, sha, request)
    building.set(key, pending)
    void pending.then(
      (index) => {
        building.delete(key)
        indexes.set(key, index)
      },
      () => building.delete(key)
    )
  }
  const index = await pending
  if (request.signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
  return index
}

async function build(
  client: GithubClient,
  repo: RepoRef,
  sha: string,
  { limitBytes, onStage }: IndexRequest
): Promise<RepoIndex> {
  onStage?.('listing')
  const tree = await loadTree(client, repo, sha)
  if (tree.truncated || tree.totalBytes > limitBytes) {
    throw new TooLargeError(tree.totalBytes, limitBytes, tree.truncated)
  }
  onStage?.('downloading')
  const t0 = performance.now()
  const { bytes: archive } = await client.bytes(
    `${repoPath(repo)}/tarball/${encodeURIComponent(sha)}`,
    { what: "the repository's archive" }
  )
  const t1 = performance.now()
  onStage?.('unpacking')
  const tar = await gunzip(new Uint8Array(archive))
  const t2 = performance.now()
  onStage?.('indexing')
  const index = RepoIndex.fromTar(tar)
  console.debug(
    '[Abele] GitHub code index built',
    `${repo.owner}/${repo.repo}@${sha.slice(0, 7)}`,
    {
      files: index.files.length,
      binary: index.binary,
      oversized: index.oversized,
      archiveMB: +(archive.byteLength / 1048576).toFixed(1),
      tarMB: +(tar.length / 1048576).toFixed(1),
      textMB: +(index.bytes / 1048576).toFixed(1),
      downloadMs: Math.round(t1 - t0),
      unpackMs: Math.round(t2 - t1),
      indexMs: Math.round(performance.now() - t2),
    }
  )
  return index
}

/** An index already built for this commit, if there is one; never downloads. */
export const cachedIndex = (repo: RepoRef, sha: string): RepoIndex | undefined =>
  indexes.get(indexKey(repo.host, repo.owner, repo.repo, sha))

/**
 * GitHub's own code search, for a repository too big to download. It searches only the default
 * branch, takes no regular expressions, needs a token and gives fragments rather than line
 * numbers — so each result is the file, with the fragment GitHub matched in it.
 */
export async function githubCodeSearch(
  client: GithubClient,
  repo: RepoRef,
  query: string,
  limit = 50
): Promise<SearchResult & { fragments: Record<string, string[]> }> {
  if (!client.hasToken) {
    throw new GithubError(
      'auth',
      "GitHub's code search needs a token. Add one in Abele settings → GitHub."
    )
  }
  const q = `${query} repo:${repo.owner}/${repo.repo}`
  const data = await client.get<{
    total_count?: number
    items?: Array<{ path: string; text_matches?: Array<{ fragment?: string }> }>
  }>(`/search/code?q=${encodeURIComponent(q)}&per_page=${Math.min(100, limit)}`, {
    accept: 'application/vnd.github.text-match+json',
    what: 'code search',
  })
  const items = data.items ?? []
  const fragments: Record<string, string[]> = {}
  for (const item of items) {
    fragments[item.path] = (item.text_matches ?? []).map((m) => m.fragment ?? '').filter(Boolean)
  }
  return {
    files: items.map((i) => ({ path: i.path, matches: [] as LineMatch[] })),
    total: data.total_count ?? items.length,
    capped: (data.total_count ?? 0) > items.length,
    searched: 0,
    fragments,
  }
}

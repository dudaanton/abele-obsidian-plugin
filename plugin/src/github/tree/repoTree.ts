/**
 * A repository's file tree at one commit, as the tree panel shows it.
 *
 * One request lists the whole tree — the same recursive listing the code search starts from — and
 * the answer is kept for the session per calling client, repository and commit. Tabs with the
 * same capability reuse it; independent callers never share its reader or lazy mutable state. GitHub stops a recursive listing past 100,000
 * entries or 7 MB; then the tree is read a folder at a time instead, each folder when it is
 * opened, by the git object its parent named.
 */
import { reactive } from 'vue'
import type { GithubClient } from '../client'
import { repoApiPath } from '../contents'
import {
  ancestors,
  buildTree,
  childrenFrom,
  findNode,
  type TreeEntry,
  type TreeNode,
} from './fileTree'

export interface RepoRef {
  origin?: string
  host: string
  owner: string
  repo: string
}

interface TreeAnswer {
  tree?: TreeEntry[]
  truncated?: boolean
}

export class RepoTree {
  /** Reactive: a folder read later appears in whatever shows the tree. */
  readonly root: TreeNode
  private readonly reading = new Map<string, Promise<void>>()

  constructor(
    private readonly client: GithubClient,
    private readonly repo: RepoRef,
    readonly sha: string,
    root: TreeNode,
    /** GitHub would not list it whole: folders are read as they are opened. */
    readonly truncated: boolean
  ) {
    this.root = reactive(root)
  }

  /** Reads a folder's entries, when they have not been read yet. */
  async expand(node: TreeNode): Promise<void> {
    this.client.assertCurrent?.()
    if (node.kind !== 'dir' || node.children) return Promise.resolve()
    const pending = this.reading.get(node.path)
    if (pending !== undefined) return pending
    const read = (async () => {
      if (!node.sha) throw new Error(`GitHub named no tree for ${node.path}.`)
      const answer = await this.client.get<TreeAnswer>(
        `${repoApiPath(this.repo)}/git/trees/${encodeURIComponent(node.sha)}`,
        { what: `the folder ${node.path}` }
      )
      if (answer.truncated || !Array.isArray(answer.tree))
        throw new Error(
          `GitHub did not send a complete tree for ${node.path}. Retry when it is available.`
        )
      this.client.assertCurrent?.()
      node.children = childrenFrom(node.path, answer.tree)
    })()
    this.reading.set(node.path, read)
    // A failure is not kept: opening the folder again asks again.
    read.catch(() => this.reading.delete(node.path))
    return read
  }

  /** Reads every folder on the way to a path, so that it can be shown open. */
  async reveal(path: string): Promise<void> {
    this.client.assertCurrent?.()
    for (const folder of ancestors(path)) {
      const node = findNode(this.root, folder)
      if (!node) return
      await this.expand(node)
    }
  }
}

/** The trees read this session, the oldest dropped past a few. */
const MAX_TREES = 8
// A tree carries a reader and mutable lazy children: neither may be borrowed by a
// different capability wrapper, even when both wrappers use the same credentials.
const trees = new Map<GithubClient, Map<string, Promise<RepoTree>>>()
const owners = new Map<Promise<RepoTree>, { client: GithubClient; key: string }>()

const keyOf = (repo: RepoRef, sha: string) =>
  `${repo.origin ?? `https://${repo.host}`}/${repo.owner}/${repo.repo}@${sha}`.toLowerCase()

async function read(client: GithubClient, repo: RepoRef, sha: string): Promise<RepoTree> {
  const base = `${repoApiPath(repo)}/git/trees/${encodeURIComponent(sha)}`
  const whole = await client.get<TreeAnswer>(`${base}?recursive=1`, {
    what: "the repository's file list",
  })
  if (!Array.isArray(whole.tree)) throw new Error('GitHub sent no repository tree.')
  if (!whole.truncated) {
    return new RepoTree(client, repo, sha, buildTree(whole.tree ?? []), false)
  }
  // Part of a tree cannot be told from the whole of it: the top level is read on its own, and
  // each folder below when it is opened.
  const top = await client.get<TreeAnswer>(base, { what: "the repository's file list" })
  if (top.truncated || !Array.isArray(top.tree))
    throw new Error('GitHub did not send a complete top-level tree.')
  const root: TreeNode = {
    name: '',
    path: '',
    kind: 'dir',
    children: childrenFrom('', top.tree ?? []),
  }
  return new RepoTree(client, repo, sha, root, true)
}

/** The tree of a repository at a commit, read once a session. */
export function repoTree(client: GithubClient, repo: RepoRef, sha: string): Promise<RepoTree> {
  client.assertCurrent?.()
  const checked = (pending: Promise<RepoTree>) =>
    pending.then((tree) => {
      client.assertCurrent?.()
      return tree
    })
  const key = `${client.cacheNamespace}:${keyOf(repo, sha)}`
  let cache = trees.get(client)
  if (!cache) {
    cache = new Map()
    trees.set(client, cache)
    const owned = cache
    client.onRetire?.(() => {
      for (const pending of owned.values()) owners.delete(pending)
      owned.clear()
      if (trees.get(client) === owned) trees.delete(client)
    })
  }
  const known = cache.get(key)
  if (known !== undefined) {
    owners.delete(known)
    owners.set(known, { client, key })
    return checked(known)
  }
  const pending = read(client, repo, sha)
  cache.set(key, pending)
  owners.set(pending, { client, key })
  pending.catch(() => {
    const current = trees.get(client)
    if (current?.get(key) === pending) current.delete(key)
    if (!current?.size) trees.delete(client)
    owners.delete(pending)
  })
  while (owners.size > MAX_TREES) {
    const oldest = owners.keys().next().value!
    const owner = owners.get(oldest)!
    owners.delete(oldest)
    const current = trees.get(owner.client)
    if (current?.get(owner.key) === oldest) current.delete(owner.key)
    if (!current?.size) trees.delete(owner.client)
  }
  return checked(pending)
}

/** Forgets every tree read — for the tests, and a token that was just replaced. */
export function forgetRepoTrees(): void {
  trees.clear()
  owners.clear()
}

/**
 * A repository's file tree at one commit, as the tree panel shows it.
 *
 * One request lists the whole tree — the same recursive listing the code search starts from — and
 * the answer is kept for the session per repository and commit, so every tab and every file
 * opened from the panel at that commit reuses it. GitHub stops a recursive listing past 100,000
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
  expand(node: TreeNode): Promise<void> {
    if (node.kind !== 'dir' || node.children) return Promise.resolve()
    const pending = this.reading.get(node.path)
    if (pending !== undefined) return pending
    const read = (async () => {
      if (!node.sha) throw new Error(`GitHub named no tree for ${node.path}.`)
      const answer = await this.client.get<TreeAnswer>(
        `${repoApiPath(this.repo)}/git/trees/${encodeURIComponent(node.sha)}`,
        { what: `the folder ${node.path}` }
      )
      node.children = childrenFrom(node.path, answer.tree ?? [])
    })()
    this.reading.set(node.path, read)
    // A failure is not kept: opening the folder again asks again.
    read.catch(() => this.reading.delete(node.path))
    return read
  }

  /** Reads every folder on the way to a path, so that it can be shown open. */
  async reveal(path: string): Promise<void> {
    for (const folder of ancestors(path)) {
      const node = findNode(this.root, folder)
      if (!node) return
      await this.expand(node)
    }
  }
}

/** The trees read this session, the oldest dropped past a few. */
const MAX_TREES = 8
const trees = new Map<string, Promise<RepoTree>>()

const keyOf = (repo: RepoRef, sha: string) =>
  `${repo.host}/${repo.owner}/${repo.repo}@${sha}`.toLowerCase()

async function read(client: GithubClient, repo: RepoRef, sha: string): Promise<RepoTree> {
  const base = `${repoApiPath(repo)}/git/trees/${encodeURIComponent(sha)}`
  const whole = await client.get<TreeAnswer>(`${base}?recursive=1`, {
    what: "the repository's file list",
  })
  if (!whole.truncated) {
    return new RepoTree(client, repo, sha, buildTree(whole.tree ?? []), false)
  }
  // Part of a tree cannot be told from the whole of it: the top level is read on its own, and
  // each folder below when it is opened.
  const top = await client.get<TreeAnswer>(base, { what: "the repository's file list" })
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
  const key = keyOf(repo, sha)
  const known = trees.get(key)
  if (known !== undefined) {
    // Most recently used goes to the end, so the oldest is the first dropped.
    trees.delete(key)
    trees.set(key, known)
    return known
  }
  const pending = read(client, repo, sha)
  trees.set(key, pending)
  pending.catch(() => {
    if (trees.get(key) === pending) trees.delete(key)
  })
  while (trees.size > MAX_TREES) trees.delete(trees.keys().next().value as string)
  return pending
}

/** Forgets every tree read — for the tests, and a token that was just replaced. */
export function forgetRepoTrees(): void {
  trees.clear()
}

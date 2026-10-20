import { UiError, uiMessage } from '@/i18n/streamBErrors'
import type { RepositoryRevision } from '@abele/node-protocol'
import type { PullRequestSummary } from '@/components/nodeWork/types'
import type { PathTarget } from './NodePathModel'

/** The node capability that carries git writes; absent, the panel offers none of them. */
export const GIT_WRITE_CAPABILITY = 'repository_git_write_v1'

/** Where a worktree's branch is, as the node reads it from git. */
export interface PathGitInfo {
  hasRemote?: boolean
  head: string | null
  /** `main`, not `refs/heads/main`; null when detached. */
  branch: string | null
  /** A rebase or merge that stopped, with the files still in conflict. */
  operation: null | { kind: 'rebase' | 'merge' | 'cherry-pick' | 'revert'; conflicts: string[] }
  upstream: null | {
    ref: string
    remote: string
    ahead: number | null
    behind: number | null
    /** The remote branch as last fetched: what the person saw, and the lease for replacing it. */
    commit: string | null
  }
  defaultBranch: string | null
  /** The git service of the remote the branch pushes to, when the node recognised it. */
  forge: null | { kind: 'github' | 'gitlab' | 'other'; host: string; owner: string; name: string }
  /** Who a commit made here is by, from the worktree's git configuration. */
  author: { name: string; email: string } | null
}

/**
 * Git writes on a node worktree. Each takes the revision the person was looking at, so the node
 * refuses when HEAD or the files moved meanwhile instead of acting on something unseen.
 */
export interface PathGit {
  info(target: PathTarget): Promise<PathGitInfo>
  stage(target: PathTarget, seen: RepositoryRevision, paths: string[] | 'all'): Promise<void>
  unstage(target: PathTarget, seen: RepositoryRevision, paths: string[] | 'all'): Promise<void>
  /** Only after the person confirmed: what changed in these files since the last commit goes. */
  discard(target: PathTarget, seen: RepositoryRevision, paths: string[]): Promise<void>
  commit(
    target: PathTarget,
    seen: RepositoryRevision,
    message: string
  ): Promise<{ commit: string; author: string }>
  /** Rebases onto the base; files left in conflict are returned, the rebase waiting on them. */
  update(
    target: PathTarget,
    seen: RepositoryRevision,
    base?: string
  ): Promise<{ conflicts: string[] }>
  continue(target: PathTarget, operation: 'rebase' | 'merge'): Promise<{ conflicts: string[] }>
  abort(target: PathTarget, operation: 'rebase' | 'merge'): Promise<void>
  /**
   * Pushes the branch; with `lease`, replaces the remote branch only if it is still the commit
   * the person saw (a branch rebased after it was pushed).
   */
  push(target: PathTarget, seen: RepositoryRevision, lease?: string): Promise<void>
  /** Reads what is new on the remote; never removes remote branches. */
  fetch(target: PathTarget): Promise<void>
  /** A branch at a commit, switched to when `seen` is given and the worktree is clean. */
  createBranch(
    target: PathTarget,
    name: string,
    startPoint: string,
    seen?: RepositoryRevision
  ): Promise<void>
}

/** A git action the node refused, with its reason as a code (`push_rejected`, …). */
export class GitRefusal extends Error {
  constructor(
    message: string,
    readonly code: string
  ) {
    super(message)
  }
}

type Failed = { state: 'failed'; code: string; message: string; output?: string }
type Unknown = { state: 'outcome_unknown' }
type Outcome<T> = T | Failed | Unknown
/** The node client's git methods, as the protocol describes them (`repository.v1.git.*`). */
export interface NodeGitClient {
  info(params: { worktree_id: string }): Promise<{
    head: string | null
    branch: string | null
    detached: boolean
    operation: null | {
      kind: 'rebase' | 'merge' | 'cherry-pick' | 'revert'
      conflicted_paths: string[]
    }
    upstream: null | {
      ref: string
      remote: string
      branch: string
      ahead: number | null
      behind: number | null
      commit?: string | null
    }
    default_branch: string | null
    remotes: {
      name: string
      url: string
      forge: null | {
        kind: 'github' | 'gitlab' | 'other'
        host: string
        owner: string
        name: string
      }
    }[]
    author: { name: string; email: string } | null
  }>
  stage(params: object): Promise<Outcome<{ state: 'applied' }>>
  unstage(params: object): Promise<Outcome<{ state: 'applied' }>>
  discard(params: object): Promise<Outcome<{ state: 'applied' }>>
  commit(
    params: object
  ): Promise<
    Outcome<{ state: 'committed'; commit: string; author: { name: string; email: string } }>
  >
  update(
    params: object
  ): Promise<Outcome<{ state: 'updated' } | { state: 'conflicts'; conflicted_paths: string[] }>>
  continue(
    params: object
  ): Promise<Outcome<{ state: 'continued' } | { state: 'conflicts'; conflicted_paths: string[] }>>
  abort(params: object): Promise<Outcome<{ state: 'aborted' } | { state: 'not_in_progress' }>>
  push(params: object): Promise<Outcome<{ state: 'pushed' }>>
  fetch?(params: object): Promise<Outcome<{ state: 'fetched' }>>
  createBranch?(params: object): Promise<Outcome<{ state: 'created' }>>
}

const head = (seen: RepositoryRevision) => (seen.kind === 'commit' ? seen.commit : seen.head)
/** A git refusal, said as the node says it, with the tail of git's own words under it. */
function settle<T extends { state: string }>(result: Outcome<T>): T {
  if (result.state === 'failed') {
    const failed = result as Failed
    throw new GitRefusal(
      failed.output ? `${failed.message}\n\n${failed.output}` : failed.message,
      failed.code
    )
  }
  if (result.state === 'outcome_unknown') throw new UiError(uiMessage('streamBError.576e97984e'))
  return result as T
}
const conflicts = (result: { state: string; conflicted_paths?: string[] }) =>
  result.state === 'conflicts' ? (result.conflicted_paths ?? []) : []

/** The port's git, over the node client's; one operation id per action, kept by the client. */
export function nodePathGit(git: NodeGitClient): PathGit {
  const paths = (list: string[] | 'all') => (list === 'all' ? { all: true } : { paths: list })
  return {
    async info(target) {
      const raw = await git.info({ worktree_id: target.id })
      const remote =
        raw.remotes.find((r) => r.name === raw.upstream?.remote) ??
        raw.remotes.find((r) => r.name === 'origin') ??
        (raw.remotes.length === 1 ? raw.remotes[0] : undefined)
      return {
        hasRemote: raw.remotes.length > 0,
        head: raw.head,
        branch: raw.branch?.replace(/^refs\/heads\//, '') ?? null,
        operation: raw.operation
          ? { kind: raw.operation.kind, conflicts: raw.operation.conflicted_paths }
          : null,
        upstream: raw.upstream
          ? {
              ref: raw.upstream.ref,
              remote: raw.upstream.remote,
              ahead: raw.upstream.ahead,
              behind: raw.upstream.behind,
              commit: raw.upstream.commit ?? null,
            }
          : null,
        defaultBranch: raw.default_branch,
        forge: remote?.forge ?? null,
        author: raw.author,
      }
    },
    async stage(target, seen, list) {
      settle(await git.stage({ worktree_id: target.id, expected_head: head(seen), ...paths(list) }))
    },
    async unstage(target, seen, list) {
      settle(
        await git.unstage({ worktree_id: target.id, expected_head: head(seen), ...paths(list) })
      )
    },
    async discard(target, seen, list) {
      if (seen.kind !== 'working') throw new UiError(uiMessage('streamBError.23563064bf'))
      settle(
        await git.discard({
          worktree_id: target.id,
          paths: list,
          expected_observation_id: seen.observation_id,
          confirmed: true,
        })
      )
    },
    async commit(target, seen, message) {
      const done = settle(
        await git.commit({ worktree_id: target.id, expected_head: head(seen), message })
      )
      return { commit: done.commit, author: done.author.name }
    },
    async update(target, seen, base) {
      const done = settle(
        await git.update({
          worktree_id: target.id,
          expected_head: head(seen),
          ...(base ? { base_ref: base } : {}),
        })
      )
      return { conflicts: conflicts(done) }
    },
    async continue(target, operation) {
      return {
        conflicts: conflicts(settle(await git.continue({ worktree_id: target.id, operation }))),
      }
    },
    async abort(target, operation) {
      settle(await git.abort({ worktree_id: target.id, operation }))
    },
    async push(target, seen, lease) {
      const at = head(seen)
      if (!at) throw new UiError(uiMessage('streamBError.1248b93aec'))
      settle(
        await git.push({
          worktree_id: target.id,
          expected_head: at,
          ...(lease ? { force_with_lease: lease } : {}),
        })
      )
    },
    async fetch(target) {
      if (!git.fetch) throw new UiError(uiMessage('streamBError.b2c46ecdf3'))
      settle(await git.fetch({ worktree_id: target.id }))
    },
    async createBranch(target, name, startPoint, seen) {
      if (!git.createBranch) throw new UiError(uiMessage('streamBError.5e20368923'))
      settle(
        await git.createBranch({
          worktree_id: target.id,
          name,
          start_point: startPoint,
          ...(seen ? { switch: true, expected_head: head(seen) } : {}),
        })
      )
    },
  }
}

/** What a git service's pull request list gives, as far as the panel shows it. */
export interface RawPull {
  number: number
  title: string
  draft?: boolean
  html_url?: string
  head?: { ref?: string }
}
export const pullSummary = (p: RawPull): PullRequestSummary & { branch: string } => ({
  number: p.number,
  title: p.title,
  state: p.draft ? 'draft' : 'open',
  ...(p.html_url ? { url: p.html_url } : {}),
  branch: p.head?.ref ?? '',
})

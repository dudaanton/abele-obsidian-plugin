/**
 * A comparison of two versions of a repository — `compare/base...head` — as a GitHub tab shows
 * it: how far head is ahead of base and behind it, the commits head has that base has not, and
 * the files those commits change, with their diffs.
 *
 * REST's `/compare/{base...head}` answers with at most 250 commits unpaged. Paged, each page holds
 * `per_page` commits and the first page alone holds the files — up to 300 of them, GitHub's own
 * limit for the whole comparison. So the first page is read for the files and the counts, and the
 * pages after it only for the rest of the commits.
 */
import type { GithubClient } from './client'
import { GithubError } from './client'
import type { GithubTarget } from './urls'
import { repoWeb } from './origin'
import { diffFiles, restCommit, type CommitSummary, type DiffFile } from './api'
import { commitsFromGraphql } from './graphql'
import { withFallback } from './sections'
import { defaultBranch } from './search/source'

type Of<K extends GithubTarget['kind']> = Extract<GithubTarget, { kind: K }>

type RepoLike = { host: string; owner: string; repo: string }

export interface CompareData {
  /** The base as compared: for `compare/<head>`, the default branch it was compared with. */
  base: string
  head: string
  direct: boolean
  /** `ahead`, `behind`, `diverged` or `identical`. */
  status: string
  aheadBy: number
  behindBy: number
  totalCommits: number
  /** Oldest first, as GitHub lists them. */
  commits: CommitSummary[]
  /** Not every commit was read: past `MAX_PAGES` pages, or a page was refused. */
  commitsComplete: boolean
  files: DiffFile[]
  /** GitHub sends at most 300 files for a comparison; more than that are on GitHub only. */
  filesComplete: boolean
  additions: number
  deletions: number
  /** Where head split from base: where a file the comparison deletes still exists. */
  mergeBaseSha?: string
  /** The commit head is at: what its files are opened and searched at. */
  headSha?: string
  /** The comparison's address on GitHub. */
  url: string
  /** Why part of it is missing or means something else than the link asked for. */
  note?: string
}

/** Commits per page asked for; GitHub's largest. */
const PER_PAGE = 100
/** Pages of commits read at most: a thousand commits is past anything worth scrolling. */
const MAX_PAGES = 10
/** The most files GitHub lists for one comparison. */
export const MAX_FILES = 300

/** A comparison's web address, the way GitHub writes it: slashes and colons in the refs as they are. */
export function compareUrl(repo: RepoLike, base: string, head: string, direct = false): string {
  return `${repoWeb(repo)}/compare/${rangeOf(base, head, direct)}`
}

/** One ref as a part of the path: every character encoded but the `/` and `:` GitHub reads. */
const side = (ref: string) =>
  ref
    .split(/([/:])/)
    .map((part) => (part === '/' || part === ':' ? part : encodeURIComponent(part)))
    .join('')

const rangeOf = (base: string, head: string, direct = false) =>
  `${side(base)}${direct ? '..' : '...'}${side(head)}`

const repoPath = (t: RepoLike) =>
  `/repos/${encodeURIComponent(t.owner)}/${encodeURIComponent(t.repo)}`

/** The SHA in a file's `contents_url` (`…?ref=<sha>`): the version of the file the diff ends at. */
function refOf(contentsUrl: unknown): string | undefined {
  if (typeof contentsUrl !== 'string') return undefined
  const m = /[?&]ref=([0-9a-f]{40})\b/i.exec(contentsUrl)
  return m?.[1]
}

/**
 * GitHub's API compares only from where the two split (three dots). A two-dot link asks for the
 * two versions side by side, which is the same thing only while base is where head started.
 */
const DIRECT_NOTE =
  "GitHub's API compares only from where the two branches split, so this shows what head changed since then — not the two versions side by side, which the two dots in the link ask for. Open it on GitHub for that."

const NO_DIFFS =
  'GitHub refused the comparison to this token. The commits came through its GraphQL API, which does not carry the changed files; open the comparison on GitHub to read them.'

// `any` below is the API's own JSON, read once here and never passed on.

export async function loadCompare(client: GithubClient, t: Of<'compare'>): Promise<CompareData> {
  const base = t.base ?? (await defaultBranch(client, t))
  const range = rangeOf(base, t.head)
  const what = `the comparison of ${base} and ${t.head}`
  return withFallback(
    client,
    () => restCompare(client, t, base, range, what),
    () => graphqlCompare(client, t, base, what)
  )
}

async function restCompare(
  client: GithubClient,
  t: Of<'compare'>,
  base: string,
  range: string,
  what: string
): Promise<CompareData> {
  const path = `${repoPath(t)}/compare/${range}`
  const first = await client.get<any>(`${path}?per_page=${PER_PAGE}&page=1`, { what })
  const total: number = first.total_commits ?? first.commits?.length ?? 0
  const pages = Math.min(MAX_PAGES, Math.ceil(total / PER_PAGE))

  let complete = true
  const rest = await Promise.all(
    Array.from({ length: Math.max(0, pages - 1) }, (_, i) =>
      client
        .get<any>(`${path}?per_page=${PER_PAGE}&page=${i + 2}`, { what })
        .then((page) => (page.commits ?? []) as any[])
        .catch((e: unknown) => {
          // The first page came; a later one refused is a shorter list, not a failed tab.
          console.debug('[Abele] A page of a comparison could not be read', e)
          complete = false
          return [] as any[]
        })
    )
  )
  const rawCommits: any[] = [...(first.commits ?? []), ...rest.flat()]
  const commits = rawCommits.map(restCommit)
  const raw: any[] = first.files ?? []
  const files = await diffFiles(raw)
  const status: string = first.status ?? ''

  // Head's commit: a file the comparison keeps says it; else the newest commit, which is head's
  // own once every commit is read; identical, head is base.
  const kept = raw.find((f) => f.status !== 'removed')
  const headSha =
    refOf(kept?.contents_url) ??
    (complete && commits.length >= total && commits.length
      ? commits[commits.length - 1].sha
      : status === 'identical'
        ? first.base_commit?.sha
        : undefined)

  return {
    base,
    head: t.head,
    direct: t.direct,
    status,
    aheadBy: first.ahead_by ?? 0,
    behindBy: first.behind_by ?? 0,
    totalCommits: total,
    commits,
    commitsComplete: complete && commits.length >= total,
    files,
    filesComplete: files.length < MAX_FILES,
    additions: files.reduce((n, f) => n + f.additions, 0),
    deletions: files.reduce((n, f) => n + f.deletions, 0),
    mergeBaseSha: first.merge_base_commit?.sha,
    headSha,
    url: compareUrl(t, base, t.head, t.direct),
    note: t.direct && (status === 'diverged' || status === 'behind') ? DIRECT_NOTE : undefined,
  }
}

const COMPARE_QUERY = `
query($owner: String!, $repo: String!, $base: String!, $head: String!) {
  repository(owner: $owner, name: $repo) {
    ref(qualifiedName: $base) {
      target { oid }
      compare(headRef: $head) {
        aheadBy behindBy status
        commits(first: 100) {
          totalCount
          nodes { oid message author { name date avatarUrl user { login avatarUrl } } }
        }
      }
    }
  }
}`

/**
 * The commits and counts through GraphQL, for a token REST refuses the comparison to. GraphQL
 * compares branches and tags of one repository only, and carries no diffs.
 */
async function graphqlCompare(
  client: GithubClient,
  t: Of<'compare'>,
  base: string,
  what: string
): Promise<CompareData> {
  const data = await client.graphql<any>(
    COMPARE_QUERY,
    { owner: t.owner, repo: t.repo, base, head: t.head },
    what
  )
  const c = data?.repository?.ref?.compare
  if (!c) throw new GithubError('not-found', `GitHub's GraphQL API found nothing for ${what}.`)
  const nodes: any[] = c.commits?.nodes ?? []
  const commits = commitsFromGraphql({ nodes: nodes.map((n) => ({ commit: n })) })
  const total: number = c.commits?.totalCount ?? commits.length
  const status = String(c.status ?? '').toLowerCase()
  return {
    base,
    head: t.head,
    direct: t.direct,
    status,
    aheadBy: c.aheadBy ?? 0,
    behindBy: c.behindBy ?? 0,
    totalCommits: total,
    commits,
    commitsComplete: commits.length >= total,
    files: [],
    filesComplete: false,
    additions: 0,
    deletions: 0,
    url: compareUrl(t, base, t.head, t.direct),
    note: NO_DIFFS,
  }
}

/** The same comparison the other way round: what base has that head has not. */
export const swappedUrl = (t: RepoLike, d: Pick<CompareData, 'base' | 'head' | 'direct'>) =>
  compareUrl(t, d.head, d.base, d.direct)

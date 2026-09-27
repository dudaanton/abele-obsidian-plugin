/**
 * A repository's front page, as a tab shows it: what the repository says of itself, its files at
 * the ref shown with their README, and — asked for once the page is up — its languages, the
 * freshest open pull requests and issues, the latest release and the branches and tags to switch
 * to.
 *
 * The page itself is one request for the repository and one for its root folder; everything else
 * is asked for separately, so a refusal of one part (issues turned off, no releases) leaves the
 * rest of the page standing.
 */
import { GithubError, type GithubClient } from '../client'
import { repoApiPath } from '../contents'
import { repoWeb } from '../origin'
import type { GithubTarget } from '../urls'
import { loadFolder, type FolderData } from '../tree/folder'

type Of<K extends GithubTarget['kind']> = Extract<GithubTarget, { kind: K }>

export interface RepoLike {
  host: string
  owner: string
  repo: string
}

export interface RepoMeta {
  /** As GitHub names it now: a renamed repository answers under its new name. */
  owner: string
  name: string
  description: string
  homepage: string
  topics: string[]
  stars: number
  forks: number
  watchers: number
  defaultBranch: string
  /** SPDX id where GitHub knows one (`MIT`), else the licence's name; null without one. */
  license: string | null
  visibility: string
  archived: boolean
  /** The repository this one is a fork of. */
  parent: string | null
  hasIssues: boolean
  url: string
}

/** The front page: the root folder at the ref shown, with the repository's own facts. */
export interface RepoHomeData extends FolderData {
  meta: RepoMeta
  /** The repository has no commits: nothing to list, no README. */
  empty?: boolean
}

interface RawRepo {
  name?: string
  owner?: { login?: string }
  description?: string | null
  homepage?: string | null
  topics?: string[]
  stargazers_count?: number
  forks_count?: number
  subscribers_count?: number
  watchers_count?: number
  default_branch?: string
  license?: { spdx_id?: string | null; name?: string | null } | null
  visibility?: string
  private?: boolean
  archived?: boolean
  parent?: { full_name?: string } | null
  has_issues?: boolean
  html_url?: string
}

export function repoMeta(r: RawRepo, asked: RepoLike): RepoMeta {
  const spdx = r.license?.spdx_id
  return {
    owner: r.owner?.login ?? asked.owner,
    name: r.name ?? asked.repo,
    description: (r.description ?? '').trim(),
    homepage: (r.homepage ?? '').trim(),
    topics: r.topics ?? [],
    stars: r.stargazers_count ?? 0,
    forks: r.forks_count ?? 0,
    // `watchers_count` is the stars again, for history's sake; the watchers are the subscribers.
    watchers: r.subscribers_count ?? 0,
    defaultBranch: r.default_branch ?? 'main',
    license: spdx && spdx !== 'NOASSERTION' ? spdx : (r.license?.name ?? null),
    visibility: r.visibility ?? (r.private ? 'private' : 'public'),
    archived: !!r.archived,
    parent: r.parent?.full_name ?? null,
    hasIssues: r.has_issues !== false,
    url: r.html_url ?? repoWeb(asked),
  }
}

const repoName = (r: RepoLike) => `${r.owner}/${r.repo}`

/**
 * The root folder at exactly `ref`. A branch may hold slashes, and here the ref is known whole,
 * so it goes as one part: `loadFolder` then has only the one split to try.
 */
async function rootAt(client: GithubClient, t: RepoLike, ref: string): Promise<FolderData> {
  const tree: Of<'tree'> = { kind: 'tree', host: t.host, owner: t.owner, repo: t.repo, rest: [ref] }
  return loadFolder(client, tree)
}

/** The front page's own address: the repository's, or its `tree/<ref>` at another ref. */
export function homeUrl(r: RepoLike, ref?: string, defaultBranch?: string): string {
  if (!ref || ref === defaultBranch) return repoWeb(r)
  return `${repoWeb(r)}/tree/${ref.split('/').map(encodeURIComponent).join('/')}`
}

/**
 * The page for a repository at `t.ref`, or at its default branch. `root` is the root folder when
 * it has been read already — a `tree/<ref>` link that turned out to name the root.
 */
export async function loadRepoHome(
  client: GithubClient,
  t: Of<'repo'>,
  root?: FolderData
): Promise<RepoHomeData> {
  const metaAsked = client.get<RawRepo>(repoApiPath(t), { what: repoName(t) })
  // With the ref known, both are asked at once; without it, the repository says which it is.
  const folderAsked = root ? Promise.resolve(root) : t.ref ? rootAt(client, t, t.ref) : null
  // Waited for together below; an early refusal of the folder is not left unhandled meanwhile.
  folderAsked?.catch(() => {})
  const meta = repoMeta(await metaAsked, t)
  const ref = t.ref ?? meta.defaultBranch
  let folder: FolderData
  try {
    folder = await (folderAsked ?? rootAt(client, t, ref))
  } catch (e) {
    // A repository with no commits has no root to list; GitHub says "This repository is empty".
    const none = e instanceof GithubError && (e.kind === 'empty' || e.kind === 'not-found')
    if (!none || t.ref) throw e
    return {
      meta,
      ref,
      path: '',
      entries: [],
      url: homeUrl(t, ref, meta.defaultBranch),
      empty: true,
    }
  }
  return { ...folder, meta, url: homeUrl(t, t.ref, meta.defaultBranch) }
}

// --- What is asked for once the page is up ---

export interface LanguageShare {
  name: string
  /** Of the whole, 0–100, one decimal. */
  percent: number
}

/** How many languages the bar names before the rest go under "Other". */
const LANGUAGES_SHOWN = 7

/** GitHub's bytes per language, as the bar shows them: the largest first, the smallest as one. */
export function languageShares(bytes: Record<string, number>): LanguageShare[] {
  const entries = Object.entries(bytes).filter(([, n]) => n > 0)
  const total = entries.reduce((sum, [, n]) => sum + n, 0)
  if (!total) return []
  const sorted = entries.sort((a, b) => b[1] - a[1])
  const shown = sorted.slice(0, LANGUAGES_SHOWN)
  const rest = sorted.slice(LANGUAGES_SHOWN).reduce((sum, [, n]) => sum + n, 0)
  const share = (n: number) => Math.round((n / total) * 1000) / 10
  const out = shown.map(([name, n]) => ({ name, percent: share(n) }))
  if (rest) out.push({ name: 'Other', percent: share(rest) })
  return out
}

export async function loadLanguages(client: GithubClient, r: RepoLike): Promise<LanguageShare[]> {
  const bytes = await client.get<Record<string, number>>(`${repoApiPath(r)}/languages`, {
    what: `the languages of ${repoName(r)}`,
  })
  return languageShares(bytes ?? {})
}

/** One open pull request or issue, as a row of the page. */
export interface ItemRow {
  number: number
  title: string
  author: string
  avatar?: string
  createdAt: string
  draft: boolean
  comments: number
  url: string
}

interface RawItem {
  number: number
  title: string
  user?: { login?: string; avatar_url?: string } | null
  created_at?: string
  draft?: boolean
  comments?: number
  html_url?: string
  pull_request?: unknown
}

const itemRow = (i: RawItem, url: string): ItemRow => ({
  number: i.number,
  title: i.title,
  author: i.user?.login ?? 'ghost',
  avatar: i.user?.avatar_url,
  createdAt: i.created_at ?? '',
  draft: !!i.draft,
  comments: i.comments ?? 0,
  url,
})

/** How many of each the page shows. */
export const FRESHEST = 5

export async function loadOpenPulls(client: GithubClient, r: RepoLike): Promise<ItemRow[]> {
  const list = await client.get<RawItem[]>(
    `${repoApiPath(r)}/pulls?state=open&sort=created&direction=desc&per_page=${FRESHEST}`,
    { what: `the pull requests of ${repoName(r)}` }
  )
  return list.slice(0, FRESHEST).map((p) => itemRow(p, `${repoWeb(r)}/pull/${p.number}`))
}

/**
 * The freshest open issues, asked of the search: the issues API lists pull requests among them,
 * and a repository whose last hundred items are all pull requests would seem to have no issues.
 */
export async function loadOpenIssues(client: GithubClient, r: RepoLike): Promise<ItemRow[]> {
  const q = `repo:${repoName(r)} is:issue is:open`
  const found = await client.get<{ items?: RawItem[] }>(
    `/search/issues?q=${encodeURIComponent(q)}&sort=created&order=desc&per_page=${FRESHEST}`,
    { what: `the issues of ${repoName(r)}` }
  )
  return (found.items ?? [])
    .filter((i) => !i.pull_request)
    .slice(0, FRESHEST)
    .map((i) => itemRow(i, `${repoWeb(r)}/issues/${i.number}`))
}

export interface ReleaseData {
  name: string
  tag: string
  publishedAt: string
  prerelease: boolean
  author: string
  url: string
}

/**
 * Repositories found to have no release, and when: GitHub says so with a 404, which the client
 * keeps no ETag for, so without this every opening of the page would ask again. Kept ten minutes.
 */
const noRelease = new Map<string, number>()
const NO_RELEASE_MS = 10 * 60 * 1000

/** The latest release, or null for a repository that has none. */
export async function loadLatestRelease(
  client: GithubClient,
  r: RepoLike,
  now = Date.now()
): Promise<ReleaseData | null> {
  const key = `${client.endpoints.api}\n${client.hasToken}\n${repoName(r)}`.toLowerCase()
  const none = noRelease.get(key)
  if (none !== undefined && now - none < NO_RELEASE_MS) return null
  try {
    const rel = await client.get<{
      name?: string | null
      tag_name: string
      published_at?: string | null
      created_at?: string
      prerelease?: boolean
      author?: { login?: string } | null
      html_url?: string
    }>(`${repoApiPath(r)}/releases/latest`, { what: `the releases of ${repoName(r)}` })
    return {
      name: rel.name?.trim() || rel.tag_name,
      tag: rel.tag_name,
      publishedAt: rel.published_at ?? rel.created_at ?? '',
      prerelease: !!rel.prerelease,
      author: rel.author?.login ?? '',
      url: rel.html_url ?? `${repoWeb(r)}/releases/tag/${encodeURIComponent(rel.tag_name)}`,
    }
  } catch (e) {
    // GitHub's way of saying there is no release yet.
    if (e instanceof GithubError && e.kind === 'not-found') {
      noRelease.set(key, now)
      return null
    }
    throw e
  }
}

export interface RefList {
  branches: string[]
  tags: string[]
  /** A list came back full: there are more, found by typing their start. */
  more: boolean
}

const REF_PAGE = 100

export async function loadRefs(client: GithubClient, r: RepoLike): Promise<RefList> {
  const [branches, tags] = await Promise.all([
    client.get<{ name: string }[]>(`${repoApiPath(r)}/branches?per_page=${REF_PAGE}`, {
      what: `the branches of ${repoName(r)}`,
    }),
    client.get<{ name: string }[]>(`${repoApiPath(r)}/tags?per_page=${REF_PAGE}`, {
      what: `the tags of ${repoName(r)}`,
    }),
  ])
  return {
    branches: branches.map((b) => b.name),
    tags: tags.map((t) => t.name),
    more: branches.length >= REF_PAGE || tags.length >= REF_PAGE,
  }
}

/** Branches and tags starting with `prefix`, for a repository with more than a page of either. */
export async function refsStarting(
  client: GithubClient,
  r: RepoLike,
  prefix: string
): Promise<RefList> {
  const ask = (kind: 'heads' | 'tags') =>
    client.get<{ ref: string }[]>(
      `${repoApiPath(r)}/git/matching-refs/${kind}/${prefix.split('/').map(encodeURIComponent).join('/')}`,
      { what: `the branches and tags of ${repoName(r)}` }
    )
  const [heads, tags] = await Promise.all([ask('heads'), ask('tags')])
  return {
    branches: heads.map((h) => h.ref.replace(/^refs\/heads\//, '')),
    tags: tags.map((t) => t.ref.replace(/^refs\/tags\//, '')),
    more: false,
  }
}

/** A count as GitHub writes one on a front page: 950, 1.2k, 34k, 1.1m. */
export function formatCount(n: number): string {
  if (n < 1000) return String(n)
  const [value, unit] = n < 1_000_000 ? [n / 1000, 'k'] : [n / 1_000_000, 'm']
  const rounded = value < 10 ? Math.floor(value * 10) / 10 : Math.floor(value)
  return `${rounded}${unit}`
}

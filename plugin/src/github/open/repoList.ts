/**
 * The repositories "Open GitHub repository…" offers: pinned ones (in the settings, so they travel
 * to other devices), the ones opened lately on this device, the person's own and those they
 * starred (asked of GitHub once an hour), and what GitHub's search finds for the typed text.
 *
 * Every entry is a repository on a server. Which connection reads it is the server's one token
 * today; a connection id can join `RepoRef` when there are several.
 */
import type { App } from 'obsidian'
import { AbeleConfig } from '@/services/AbeleConfig'
import type { GithubClient } from '../client'
import { repoWeb } from '../origin'
import { parseGithubUrl } from '../urls'
import { DEFAULT_GITHUB_SETTINGS, type PinnedRepo } from '../settings'
import { repoKey, type RepoRef } from './query'

export type RepoGroup = 'pinned' | 'recent' | 'own' | 'starred' | 'found'

export interface RepoEntry extends RepoRef {
  description?: string
  private?: boolean
  fork?: boolean
  archived?: boolean
  stars?: number
}

export interface RepoRow {
  group: RepoGroup | 'note'
  title: string
  note?: string
  repo?: RepoEntry
}

const GROUP_ORDER: RepoGroup[] = ['pinned', 'recent', 'own', 'starred', 'found']

/** A repository's own address, which is how it is stored: the server is part of it. */
export const repoUrlOf = (r: RepoRef): string => repoWeb(r)

/** A stored address read back as a repository; null for anything that is not one. */
export function repoFromUrl(url: string): RepoRef | null {
  let host: string
  try {
    host = new URL(url).hostname
  } catch {
    return null
  }
  const t = parseGithubUrl(url, [host])
  const origin=new URL(url).origin
  return t?.kind === 'repo' ? { host:t.host,owner:t.owner,repo:t.repo,
    ...(origin!==`https://${t.host}` ? {origin} : {}),
  } : null
}

// --- Pinned: in the settings ---

const githubConfig = () => AbeleConfig.getInstance().github ?? DEFAULT_GITHUB_SETTINGS

export function pinnedRepos(): RepoRef[] {
  return (githubConfig().pinnedRepos ?? [])
    .map((p) => repoFromUrl(p.url))
    .filter((r): r is RepoRef => !!r)
}

export const isPinned = (r: RepoRef): boolean =>
  pinnedRepos().some((p) => repoKey(p) === repoKey(r))

/** Pins or unpins a repository and saves the settings, which carries it to other devices. */
export async function setPinned(r: RepoRef, pinned: boolean): Promise<void> {
  const config = AbeleConfig.getInstance()
  const github = { ...DEFAULT_GITHUB_SETTINGS, ...(config.github ?? {}) }
  const others: PinnedRepo[] = (github.pinnedRepos ?? []).filter((p) => {
    const repo = repoFromUrl(p.url)
    return !repo || repoKey(repo) !== repoKey(r)
  })
  config.github = { ...github, pinnedRepos: pinned ? [...others, { url: repoUrlOf(r) }] : others }
  await config.saveSettings()
}

// --- Recent: on this device ---

export const RECENT_KEY = 'abele-github-recent-repos'
const RECENT_MAX = 20

type LocalStore = Pick<App, 'loadLocalStorage' | 'saveLocalStorage'>

export function recentRepos(app: LocalStore): RepoRef[] {
  const stored: unknown = app.loadLocalStorage(RECENT_KEY)
  if (!Array.isArray(stored)) return []
  return stored
    .filter((u): u is string => typeof u === 'string')
    .map(repoFromUrl)
    .filter((r): r is RepoRef => !!r)
}

/** The repository something was just opened in, first in the list; kept to the last twenty. */
export function rememberRepo(app: LocalStore, r: RepoRef): void {
  const rest = recentRepos(app).filter((x) => repoKey(x) !== repoKey(r))
  app.saveLocalStorage(RECENT_KEY, [r, ...rest].slice(0, RECENT_MAX).map(repoUrlOf))
}

// --- Own and starred: asked of GitHub ---

interface RawRepo {
  name: string
  owner: { login: string }
  description?: string | null
  private?: boolean
  fork?: boolean
  archived?: boolean
  stargazers_count?: number
}

export const entryOf = (host: string, r: RawRepo, origin?: string): RepoEntry => ({
  host,
  ...(origin && origin!==`https://${host}` ? {origin} : {}),
  owner: r.owner.login,
  repo: r.name,
  description: r.description?.trim() || undefined,
  private: r.private,
  fork: r.fork,
  archived: r.archived,
  stars: r.stargazers_count,
})

export interface AccountRepos {
  own: RepoEntry[]
  starred: RepoEntry[]
  /** Why one of the two could not be read, when only one could. */
  problem?: string
}

/** How long an account's lists are kept before GitHub is asked again. */
export const ACCOUNT_TTL_MS = 60 * 60 * 1000

const accounts = new WeakMap<GithubClient, { at: number; lists: Promise<AccountRepos> }>()

/**
 * The repositories the token's account owns or works in — up to a thousand, freshest pushed first
 * — and the ones it starred. Kept an hour per client, which is per server and token.
 */
export function accountRepos(client: GithubClient, now = Date.now()): Promise<AccountRepos> {
  const kept = accounts.get(client)
  if (kept && now - kept.at < ACCOUNT_TTL_MS) return kept.lists
  const host = client.endpoints.webHost
  // Each on its own: a token that may not read the stars still lists the repositories.
  const lists = Promise.allSettled([
    client.list<RawRepo>(
      '/user/repos?sort=pushed&affiliation=owner,collaborator,organization_member',
      { what: 'your repositories' }
    ),
    client.list<RawRepo>('/user/starred?sort=created', { what: 'your starred repositories' }),
  ]).then(([own, starred]): AccountRepos => {
    if (own.status === 'rejected' && starred.status === 'rejected') throw own.reason
    const failed = own.status === 'rejected' ? own : starred.status === 'rejected' ? starred : null
    return {
      own: own.status === 'fulfilled' ? own.value.items.map((r) => entryOf(host, r, client.endpoints.origin)) : [],
      starred:
        starred.status === 'fulfilled' ? starred.value.items.map((r) => entryOf(host, r, client.endpoints.origin)) : [],
      problem: failed
        ? failed.reason instanceof Error
          ? failed.reason.message.split('\n')[0]
          : 'GitHub could not be asked.'
        : undefined,
    }
  })
  // A failure is not kept: the next picker asks again.
  lists.catch(() => accounts.delete(client))
  accounts.set(client, { at: now, lists })
  return lists
}

export const forgetAccountRepos = (client: GithubClient) => accounts.delete(client)

/** GitHub's repository search for the typed words, by name. */
export async function searchRepos(client: GithubClient, text: string): Promise<RepoEntry[]> {
  const found = await client.get<{ items?: RawRepo[] }>(
    `/search/repositories?q=${encodeURIComponent(`${text} in:name`)}&per_page=10`,
    { what: 'repositories' }
  )
  return (found.items ?? []).map((r) => entryOf(client.endpoints.webHost, r, client.endpoints.origin))
}

// --- The rows ---

const GROUP_NOTE: Record<RepoGroup, string> = {
  pinned: 'Pinned',
  recent: 'Recent',
  own: 'Yours',
  starred: 'Starred',
  found: 'Found on GitHub',
}

export const groupName = (g: RepoGroup): string => GROUP_NOTE[g]

/** An entry's fields that say something, for laying over another's. */
const definedOf = (e: RepoEntry): Partial<RepoEntry> =>
  Object.fromEntries(Object.entries(e).filter(([, v]) => v !== undefined))

/** How well an entry matches the typed text; 0 is not at all. */
function score(e: RepoEntry, needle: string): number {
  if (!needle) return 1
  const full = `${e.owner}/${e.repo}`.toLowerCase()
  const name = e.repo.toLowerCase()
  if (full === needle || name === needle) return 5
  if (name.startsWith(needle)) return 4
  if (full.startsWith(needle)) return 3
  if (full.includes(needle)) return 2
  const words = needle.split(/\s+/).filter(Boolean)
  const hay = `${full} ${(e.description ?? '').toLowerCase()}`
  return words.every((w) => hay.includes(w)) ? 1 : 0
}

const noteOf = (e: RepoEntry, group: RepoGroup): string =>
  [
    GROUP_NOTE[group],
    e.private ? 'private' : '',
    e.archived ? 'archived' : '',
    e.fork ? 'fork' : '',
    e.description ?? '',
  ]
    .filter(Boolean)
    .join(' · ')

/**
 * Every repository known, once each — pinned before recent before yours before starred before
 * found — narrowed to what matches the typed text, the closest matches first. Empty text keeps
 * the groups in their order.
 */
export function repoRows(
  sources: Partial<Record<RepoGroup, RepoEntry[]>>,
  query: string,
  limit = 50
): RepoRow[] {
  const needle = query.trim().toLowerCase()
  // Each repository once, under the first list it is in, with what any list says of it: a pin
  // holds only the address, and the description the "Yours" list has is still searched.
  const known = new Map<string, { group: RepoGroup; entry: RepoEntry }>()
  for (const group of GROUP_ORDER) {
    for (const entry of sources[group] ?? []) {
      const key = repoKey(entry)
      const first = known.get(key)
      if (!first) known.set(key, { group, entry })
      else first.entry = { ...entry, ...definedOf(first.entry) }
    }
  }
  const scored: { row: RepoRow; score: number; order: number }[] = []
  for (const { group, entry } of known.values()) {
    const s = score(entry, needle)
    if (!s) continue
    scored.push({
      row: {
        group,
        title: `${entry.owner}/${entry.repo}`,
        note: noteOf(entry, group),
        repo: entry,
      },
      score: s,
      order: scored.length,
    })
  }
  return scored
    .sort((a, b) => (needle ? b.score - a.score : 0) || a.order - b.order)
    .slice(0, limit)
    .map((s) => s.row)
}

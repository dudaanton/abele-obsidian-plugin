/**
 * What a person typed into the "Open on GitHub" picker, read as what they could mean.
 *
 * One input can mean several things at once — `feat/login` is a repository or a branch,
 * `deadbeef1` a commit or words of a title — so the reading keeps every meaning it allows and
 * the search asks GitHub about each. Nothing here touches the network.
 */
import { parseRepoInput } from '../accessCheck'
import { normaliseHost, parseGithubUrl, type GithubTarget } from '../urls'

export interface RepoRef {
  host: string
  owner: string
  repo: string
}

export type OpenQuery =
  /** A link a GitHub tab can show as it is. */
  | { kind: 'link'; url: string; target: GithubTarget }
  /** A link to a repository's front page, or to a page of it no tab shows (`/pulls`). */
  | { kind: 'repo-link'; repo: RepoRef }
  /** A link to a host that is neither github.com nor the configured server. */
  | { kind: 'foreign'; host: string }
  /** A link to github.com or the server that names no repository — a user, an organisation. */
  | { kind: 'unreadable' }
  /** `#12`, `12`, `owner/repo#12`. */
  | { kind: 'number'; repo: RepoRef | null; number: number }
  /**
   * Anything else: words of a title, a branch, a SHA. `repo` is the repository the text was
   * given with (`owner/repo words`), else the picker's own; `named` is a whole `owner/repo`
   * typed on its own, which may also be the repository itself.
   */
  | { kind: 'text'; repo: RepoRef | null; text: string; named?: RepoRef }
  | { kind: 'empty' }

export interface QueryContext {
  /** The hosts a link may be on: github.com, and the configured server. */
  hosts: string[]
  /** Where `owner/repo` without a host lives: the configured server, else github.com. */
  defaultHost: string
  /** The repository a bare `#12` or a title means, when there is one. */
  repo: RepoRef | null
}

const NAME = '[A-Za-z0-9_.-]+'
const NUMBER = new RegExp(`^(?:(${NAME})/(${NAME}))?#(\\d+)$`)
const REPO = new RegExp(`^(${NAME})/(${NAME})$`)
const REPO_THEN_TEXT = new RegExp(`^(${NAME})/(${NAME})\\s+(.+)$`)
/** A commit's SHA, whole or shortened the way GitHub shortens it. */
export const SHA = /^[0-9a-f]{7,40}$/i

const positive = (text: string): number | null => {
  const n = Number(text)
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

/** A URL, or what is plainly one without its scheme: `github.com/owner/repo/…`. */
function asUrl(text: string, hosts: string[]): URL | null {
  if (/^https?:\/\//i.test(text)) {
    try {
      return new URL(text)
    } catch {
      return null
    }
  }
  const slash = text.indexOf('/')
  const first = normaliseHost(slash < 0 ? text : text.slice(0, slash))
  if (slash < 0 || !first.includes('.')) return null
  // `owner.name/repo` is a repository whose owner has a dot, unless the first part is a host.
  if (!hosts.map(normaliseHost).includes(first)) return null
  try {
    return new URL(`https://${text}`)
  } catch {
    return null
  }
}

export function parseOpenQuery(input: string, ctx: QueryContext): OpenQuery {
  const text = input.trim()
  if (!text) return { kind: 'empty' }

  const url = asUrl(text, ctx.hosts)
  if (url) {
    const host = normaliseHost(url.hostname)
    if (!ctx.hosts.map(normaliseHost).includes(host)) return { kind: 'foreign', host }
    const target = parseGithubUrl(url.href, ctx.hosts)
    if (target) return { kind: 'link', url: url.href, target }
    const repo = parseRepoInput(url.href, host)
    return repo ? { kind: 'repo-link', repo } : { kind: 'unreadable' }
  }

  const named = (owner: string, repo: string): RepoRef => ({
    host: ctx.defaultHost,
    owner,
    repo: repo.replace(/\.git$/, ''),
  })

  const numbered = NUMBER.exec(text)
  if (numbered) {
    const number = positive(numbered[3])
    const repo = numbered[1] && numbered[2] ? named(numbered[1], numbered[2]) : ctx.repo
    if (number) return { kind: 'number', repo, number }
  }
  const bare = /^\d+$/.test(text) ? positive(text) : null
  if (bare) return { kind: 'number', repo: ctx.repo, number: bare }

  const repoThenText = REPO_THEN_TEXT.exec(text)
  if (repoThenText) {
    const repo = named(repoThenText[1], repoThenText[2])
    const rest = repoThenText[3].trim()
    const digits = /^#?(\d+)$/.exec(rest)
    const number = digits ? positive(digits[1]) : null
    if (number) return { kind: 'number', repo, number }
    return { kind: 'text', repo, text: rest }
  }

  const whole = REPO.exec(text)
  if (whole) return { kind: 'text', repo: ctx.repo, text, named: named(whole[1], whole[2]) }
  return { kind: 'text', repo: ctx.repo, text }
}

export const repoKey = (r: RepoRef): string => `${r.host}/${r.owner}/${r.repo}`.toLowerCase()

export const repoName = (r: RepoRef): string => `${r.owner}/${r.repo}`

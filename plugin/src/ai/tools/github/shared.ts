/**
 * What the GitHub tools share: reading what an agent names — a link, `owner/repo#12`,
 * `owner/repo` — into a repository and a client, and keeping every answer small.
 *
 * The client is the GitHub tabs' own (`githubClient`), so the tools send the same token to the
 * same server, answer repeats from the same ETag cache, and are refused in the same words.
 */
import { repoWeb } from '@/github/origin'
import { parseRepoInput, type RepoRef } from '@/github/accessCheck'
import type { GithubClient } from '@/github/client'
import { githubClient, githubHosts, githubSettings, parseForSettings } from '@/github/GithubService'
import { endpoints, normaliseHost, type GithubTarget } from '@/github/urls'
import type { DiffFile } from '@/github/api'
import { parsePatch } from '@/github/patch'
import type { AgentToolResult } from '../../client'

export type { RepoRef }

/** The most text one call hands back. A pull request is read a part at a time, never whole. */
export const MAX_OUTPUT = 40_000

/** Rows of a diff or lines of a file shown when no window was asked for. */
export const DEFAULT_LINES = 400
/** The widest window one call may ask for. */
export const MAX_LINES = 1500

export interface Named {
  repo: RepoRef
  /** `#12` in `owner/repo#12`. */
  number?: number
  /** What a link points at, when it is a link a GitHub tab can show. */
  target?: GithubTarget
  /** The path segments of a link after `owner/repo`, for shapes no tab shows — `tree/…`, `compare/…`. */
  rest?: string[]
}

/** The host a bare `owner/repo` is read from: the configured server, github.com without one. */
const defaultHost = () => endpoints(githubSettings().server).webHost

/**
 * A link, `owner/repo#12` or `owner/repo`, read. Only github.com and the configured server are
 * GitHub: any other host is refused rather than sent a token it was never meant to see.
 */
export function parseNamed(input: unknown): Named {
  const text = typeof input === 'string' ? input.trim() : ''
  if (!text)
    throw new Error('Name a repository or item: a GitHub link, owner/repo or owner/repo#12.')

  const short = /^([\w.-]+)\/([\w.-]+?)#(\d+)$/.exec(text)
  if (short) {
    return {
      repo: { host: defaultHost(), owner: short[1], repo: short[2] },
      number: Number(short[3]),
    }
  }

  const target = parseForSettings(text)
  if (target) {
    const repo = { host: target.host, owner: target.owner, repo: target.repo }
    const number = 'number' in target ? target.number : undefined
    return { repo, number, target }
  }

  const repo = parseRepoInput(text, defaultHost())
  if (!repo) {
    throw new Error(
      `"${text}" is not a GitHub repository or item. Give a link, owner/repo or owner/repo#12.`
    )
  }
  if (!githubHosts().includes(normaliseHost(repo.host))) {
    throw new Error(
      `${repo.host} is neither github.com nor the GitHub server set in the settings, so it is not read.`
    )
  }
  let rest: string[] = []
  try {
    const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`)
    rest = url.pathname
      .split('/')
      .filter(Boolean)
      .slice(2)
      .map((s) => decodeURIComponent(s))
  } catch {
    rest = []
  }
  return { repo, rest }
}

export const clientFor = (repo: RepoRef): GithubClient => githubClient(repo.host)

export const repoPath = (r: RepoRef) =>
  `/repos/${encodeURIComponent(r.owner)}/${encodeURIComponent(r.repo)}`

export const repoName = (r: RepoRef) => `${r.owner}/${r.repo}`

export const webUrl = (r: RepoRef) => repoWeb(r)

/** A whole number from a parameter, or the fallback. */
export function whole(value: unknown, fallback: number, min = 1): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(n) ? Math.max(min, Math.floor(n)) : fallback
}

export const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

/** Text cut to `max`, saying how much was left out. */
export function clip(value: string, max: number): string {
  if (value.length <= max) return value
  return `${value.slice(0, max)}\n[… ${value.length - max} more characters cut]`
}

export const day = (iso: string | undefined) => (iso ? iso.slice(0, 10) : '')

/** One tool answer, held to `MAX_OUTPUT` whatever went into it. */
export function answer(body: string): AgentToolResult {
  const out =
    body.length > MAX_OUTPUT
      ? `${body.slice(0, MAX_OUTPUT)}\n\n[Truncated at ${MAX_OUTPUT} characters — ask for a smaller part: a page, one file, or a line range.]`
      : body
  return { content: [{ type: 'text', text: out }] }
}

/** Which of a list of files a path names: exactly, or the only one it ends. */
export function findFile<T extends { path: string }>(files: T[], path: string): T {
  const wanted = path.replace(/^\/+/, '')
  const exact = files.find((f) => f.path === wanted)
  if (exact) return exact
  const tail = files.filter((f) => f.path.endsWith(`/${wanted}`))
  if (tail.length === 1) return tail[0]
  const near = files.filter((f) => f.path.includes(wanted.split('/').pop() ?? wanted))
  const hint = (tail.length > 1 ? tail : near)
    .slice(0, 10)
    .map((f) => f.path)
    .join(', ')
  throw new Error(
    tail.length > 1
      ? `"${path}" matches several changed files: ${hint}. Give the full path.`
      : `No changed file is "${path}".${hint ? ` Close: ${hint}.` : ''} List the files without a path first.`
  )
}

/** One row per changed file: status, counts, path — the list an agent picks a file from. */
export function fileRows(files: DiffFile[]): string[] {
  return files.map((f) => {
    const moved = f.previousPath ? ` ← ${f.previousPath}` : ''
    const comments = f.reviewComments.length
      ? `  [${f.reviewComments.length} review comment${f.reviewComments.length === 1 ? '' : 's'}]`
      : ''
    return `${f.status.padEnd(9)} +${f.additions} −${f.deletions}  ${f.path}${moved}${comments}`
  })
}

/**
 * A window of one file's diff, numbered on both sides the way `#diff-…L3`/`R4` anchors count, with
 * where the rest is when the window does not reach the end.
 */
export function patchWindow(file: DiffFile, offset: number, limit: number, again: string): string {
  const head = `${file.path}${file.previousPath ? ` (was ${file.previousPath})` : ''} — ${file.status}, +${file.additions} −${file.deletions}`
  if (!file.patch) {
    const why =
      file.diffNote ??
      'GitHub sends no diff for this file: it is binary, or its diff is too large. Read the file itself with github_file instead.'
    return `${head}\n${why}`
  }
  const lines = parsePatch(file.patch)
  const from = Math.min(offset, Math.max(1, lines.length))
  const to = Math.min(lines.length, from + Math.min(limit, MAX_LINES) - 1)
  const sign: Record<string, string> = { add: '+', del: '-', ctx: ' ' }
  const rows = lines.slice(from - 1, to).map((l) => {
    if (l.type === 'hunk' || l.type === 'note') return l.text
    const old = l.old === undefined ? '' : String(l.old)
    const now = l.new === undefined ? '' : String(l.new)
    return `${old.padStart(5)} ${now.padStart(5)} ${sign[l.type]}${l.text}`
  })
  const out = [`${head} — diff rows ${from}–${to} of ${lines.length}`, '  old   new', ...rows]
  if (to < lines.length) {
    out.push(`[Rows ${to + 1}–${lines.length} not shown: ${again} offset=${to + 1}.]`)
  }
  return out.join('\n')
}

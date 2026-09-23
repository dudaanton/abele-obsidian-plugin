/**
 * GitHub web addresses, read as the things they point at.
 *
 * Only the shapes a GitHub view can show are recognised. Everything else returns `null`, and the
 * caller lets the link go to the browser the way it always did — a link this does not
 * understand must never become a link that does nothing.
 */

interface Repo {
  host: string
  owner: string
  repo: string
  /** What follows `#`, kept for scrolling to a comment. */
  anchor?: string
}

/** A file inside a diff, as GitHub's `#diff-<sha256(path)>` anchor names it. */
export interface DiffFileAnchor {
  hash: string
  /** `L` is the old side, `R` the new one. Absent when the anchor names only the file. */
  side?: 'L' | 'R'
  line?: number
  endLine?: number
}

export interface LineRange {
  start: number
  end: number
}

export type GithubTarget =
  | (Repo & { kind: 'issue'; number: number })
  | (Repo & {
      kind: 'pull'
      number: number
      tab: 'conversation' | 'files' | 'commits'
      file?: DiffFileAnchor
    })
  | (Repo & { kind: 'discussion'; number: number })
  | (Repo & { kind: 'commit'; sha: string; pull?: number; file?: DiffFileAnchor })
  | (Repo & {
      kind: 'blob'
      /**
       * Everything after `blob/`. Which part of it is the ref and which the path cannot be told
       * from the address — a branch may contain slashes — so `blobCandidates` offers every
       * split and the API settles it.
       */
      rest: string[]
      lines?: LineRange
    })

export type GithubTargetKind = GithubTarget['kind']

const DIFF_ANCHOR = /^diff-([0-9a-f]{64})(?:([LR])(\d+)(?:-[LR](\d+))?)?$/
const LINE_ANCHOR = /^L(\d+)(?:C\d+)?(?:-L(\d+)(?:C\d+)?)?$/

const positive = (text: string): number | null => {
  if (!/^\d+$/.test(text)) return null
  const n = Number(text)
  return n > 0 ? n : null
}

function diffAnchor(hash: string): DiffFileAnchor | undefined {
  const m = DIFF_ANCHOR.exec(hash)
  if (!m) return undefined
  const line = m[3] ? Number(m[3]) : undefined
  return {
    hash: m[1],
    side: m[2] as 'L' | 'R' | undefined,
    line,
    endLine: m[4] ? Number(m[4]) : line,
  }
}

function lineAnchor(hash: string): LineRange | undefined {
  const m = LINE_ANCHOR.exec(hash)
  if (!m) return undefined
  const start = Number(m[1])
  const end = m[2] ? Number(m[2]) : start
  return { start: Math.min(start, end), end: Math.max(start, end) }
}

const normaliseHost = (host: string) => host.toLowerCase().replace(/^www\./, '')

/**
 * @param hosts the web hosts treated as GitHub: `github.com`, plus an Enterprise host when one is
 *   configured. A link to any other host is not ours, whatever its path looks like.
 */
export function parseGithubUrl(url: string, hosts: string[]): GithubTarget | null {
  let parsed: URL
  try {
    parsed = new URL(url.trim())
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null

  const host = normaliseHost(parsed.hostname)
  if (!hosts.map(normaliseHost).includes(host)) return null

  let segments: string[]
  try {
    segments = parsed.pathname
      .split('/')
      .filter(Boolean)
      .map((s) => decodeURIComponent(s))
  } catch {
    return null
  }

  const [owner, repo, section, id, ...more] = segments
  if (!owner || !repo || !section || !id) return null
  if (owner === 'orgs' || owner === 'enterprises') return null

  const hash = parsed.hash.replace(/^#/, '')
  const base: Repo = { host, owner, repo, anchor: hash || undefined }

  switch (section) {
    case 'issues': {
      const number = positive(id)
      if (number === null || more.length > 0) return null
      return { kind: 'issue', ...base, number }
    }
    case 'discussions': {
      const number = positive(id)
      if (number === null || more.length > 0) return null
      return { kind: 'discussion', ...base, number }
    }
    case 'pull': {
      const number = positive(id)
      if (number === null) return null
      const [tab, sha] = more
      if (tab === 'commits' && sha) {
        return { kind: 'commit', ...base, sha, pull: number, file: diffAnchor(hash) }
      }
      if (!tab) return { kind: 'pull', ...base, number, tab: 'conversation' }
      if (tab === 'files' || tab === 'changes') {
        return { kind: 'pull', ...base, number, tab: 'files', file: diffAnchor(hash) }
      }
      if (tab === 'commits') return { kind: 'pull', ...base, number, tab: 'commits' }
      return null
    }
    case 'commit': {
      if (!/^[0-9a-f]{7,40}$/i.test(id) || more.length > 0) return null
      return { kind: 'commit', ...base, sha: id, pull: undefined, file: diffAnchor(hash) }
    }
    case 'blob': {
      // A ref alone is a tree, not a file.
      if (more.length === 0) return null
      return {
        kind: 'blob',
        ...base,
        rest: [id, ...more],
        lines: lineAnchor(hash),
        anchor: lineAnchor(hash) ? undefined : base.anchor,
      }
    }
    default:
      return null
  }
}

/** Every way `rest` can be split into a ref and a path, the shortest ref first. */
export function blobCandidates(rest: string[]): { ref: string; path: string }[] {
  const out: { ref: string; path: string }[] = []
  for (let i = 1; i < rest.length; i++) {
    out.push({ ref: rest.slice(0, i).join('/'), path: rest.slice(i).join('/') })
  }
  return out
}

export interface Endpoints {
  /** The host a link in a note carries. */
  webHost: string
  /** REST base, without a trailing slash. */
  api: string
  graphql: string
}

/**
 * Where the API lives for a configured server address.
 *
 * Empty is github.com. An Enterprise Server keeps its API under `/api/v3` on its own host, and
 * GitHub Enterprise Cloud with data residency (`<name>.ghe.com`) under an `api.` subdomain. The
 * API address itself is accepted too, since that is what some people will paste.
 */
export function endpoints(server: string): Endpoints {
  const trimmed = server.trim()
  if (!trimmed) {
    return {
      webHost: 'github.com',
      api: 'https://api.github.com',
      graphql: 'https://api.github.com/graphql',
    }
  }

  let url: URL
  try {
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`)
  } catch {
    return endpoints('')
  }

  let host = normaliseHost(url.hostname)
  if (host === 'github.com' || host === 'api.github.com') return endpoints('')

  if (host.endsWith('.ghe.com')) {
    if (host.startsWith('api.')) host = host.slice(4)
    return { webHost: host, api: `https://api.${host}`, graphql: `https://api.${host}/graphql` }
  }

  const origin = `${url.protocol}//${url.host}`
  return { webHost: host, api: `${origin}/api/v3`, graphql: `${origin}/api/graphql` }
}

/** The hex SHA-256 of a file path: the part of `#diff-…` that says which file. */
export async function diffAnchorHash(path: string): Promise<string> {
  const bytes = new TextEncoder().encode(path)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** A stable key for "the same item", ignoring which tab or line the link pointed at. */
export function targetKey(t: GithubTarget): string {
  const repo = `${t.host}/${t.owner}/${t.repo}`.toLowerCase()
  switch (t.kind) {
    case 'issue':
    case 'pull':
    case 'discussion':
      return `${t.kind}:${repo}#${t.number}`
    case 'commit':
      return `commit:${repo}@${t.sha.toLowerCase()}`
    case 'blob':
      return `blob:${repo}/${t.rest.join('/')}`
  }
}

/** How the tab is named before anything has loaded, and the start of its name after. */
export function shortName(t: GithubTarget): string {
  const repo = `${t.owner}/${t.repo}`
  switch (t.kind) {
    case 'issue':
    case 'pull':
      return `${repo}#${t.number}`
    case 'discussion':
      return `${repo} discussion #${t.number}`
    case 'commit':
      return `${repo}@${t.sha.slice(0, 7)}`
    case 'blob':
      return `${repo}: ${t.rest[t.rest.length - 1]}`
  }
}

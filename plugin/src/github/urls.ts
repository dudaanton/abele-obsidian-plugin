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
      /** `?plain=1`: the source of a markdown file rather than its rendering. */
      plain?: boolean
    })
  | (Repo & {
      kind: 'compare'
      /** Unset for `compare/<head>`, which GitHub compares with the default branch. */
      base?: string
      /** A branch, tag or SHA; another fork's as `owner:branch` or `owner:repo:branch`. */
      head: string
      /**
       * Two dots: the two versions against each other, rather than what head has that base has not
       * (three dots, GitHub's default).
       */
      direct: boolean
      file?: DiffFileAnchor
    })
  | (Repo & {
      kind: 'tree'
      /** Everything after `tree/`: a ref and a folder in it, split as for a file — `treeCandidates`. */
      rest: string[]
    })

export type GithubTargetKind = GithubTarget['kind']

const DIFF_ANCHOR = /^diff-([0-9a-f]{64})(?:([LR])(\d+)(?:-[LR](\d+))?)?$/
/** A review comment: `#discussion_r12` on the conversation, `#r12` on the files. */
const REVIEW_COMMENT_ANCHOR = /^(?:discussion_)?r(\d+)$/
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

/**
 * A host as it is compared: letter case, a leading `www.` and the trailing dot of a fully
 * qualified name are all ways of writing the same server. The link's host and the configured
 * server's pass through this one function, so the two can never be compared in different shapes —
 * a mismatch would send the request to github.com without the Enterprise token.
 */
export const normaliseHost = (host: string) =>
  host
    .trim()
    .toLowerCase()
    .replace(/\.$/, '')
    .replace(/^www\./, '')

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
      // Review comments are shown beside their file, so a link to one opens the files.
      const reviewComment = REVIEW_COMMENT_ANCHOR.exec(hash)
      if (reviewComment && (!tab || tab === 'files' || tab === 'changes')) {
        const anchor = `discussion_r${reviewComment[1]}`
        return { kind: 'pull', ...base, anchor, number, tab: 'files' }
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
        plain: parsed.searchParams.get('plain') === '1' || undefined,
        anchor: lineAnchor(hash) ? undefined : base.anchor,
      }
    }
    case 'tree':
      return { kind: 'tree', ...base, rest: [id, ...more] }
    case 'compare': {
      const sides = compareSides([id, ...more].join('/'))
      return sides && { kind: 'compare', ...base, ...sides, file: diffAnchor(hash) }
    }
    default:
      return null
  }
}

/**
 * `base...head`, `base..head` or a lone `head`. Git refuses `..` inside a ref name, so the first
 * run of dots is the separator; any other count of dots, or a side left empty, is not a comparison.
 */
function compareSides(range: string): { base?: string; head: string; direct: boolean } | null {
  const m = /^(.*?)(\.{2,})(.*)$/.exec(range)
  if (!m) return range ? { base: undefined, head: range, direct: false } : null
  const [, base, dots, head] = m
  if (!base || !head || dots.length > 3 || head.includes('..')) return null
  return { base, head, direct: dots.length === 2 }
}

/** Every way `rest` can be split into a ref and a path, the shortest ref first. */
export function blobCandidates(rest: string[]): { ref: string; path: string }[] {
  const out: { ref: string; path: string }[] = []
  for (let i = 1; i < rest.length; i++) {
    out.push({ ref: rest.slice(0, i).join('/'), path: rest.slice(i).join('/') })
  }
  return out
}

/**
 * The same for a folder, which may also be the repository's root: the whole of `rest` as the ref
 * is the last guess.
 */
export function treeCandidates(rest: string[]): { ref: string; path: string }[] {
  return [...blobCandidates(rest), { ref: rest.join('/'), path: '' }]
}

export interface Endpoints {
  /** The host a link in a note carries. */
  webHost: string
  /** REST base, without a trailing slash. */
  api: string
  graphql: string
  /** Where its web addresses start: scheme, host and port, no trailing slash. */
  origin: string
  /** A GitHub Enterprise Server, whose REST API lives under `/api/v3` on its own host. */
  server?: boolean
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
      origin: 'https://github.com',
    }
  }

  let url: URL
  try {
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`)
  } catch {
    return endpoints('')
  }

  let host = normaliseHost(url.hostname)
  // Every github.com subdomain is GitHub's own; none of them is an Enterprise Server.
  if (host === 'github.com' || host.endsWith('.github.com')) return endpoints('')

  if (host.endsWith('.ghe.com')) {
    if (host.startsWith('api.')) host = host.slice(4)
    return {
      webHost: host,
      api: `https://api.${host}`,
      graphql: `https://api.${host}/graphql`,
      origin: `https://${host}`,
    }
  }

  const port = url.port ? `:${url.port}` : ''
  const origin = `${url.protocol}//${url.hostname.toLowerCase().replace(/\.$/, '')}${port}`
  return {
    webHost: host,
    api: `${origin}/api/v3`,
    graphql: `${origin}/api/graphql`,
    origin,
    server: true,
  }
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
    case 'tree':
      return `tree:${repo}/${t.rest.join('/')}`
    case 'compare':
      return `compare:${repo}/${t.base ?? ''}${t.direct ? '..' : '...'}${t.head}`
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
    case 'tree':
      return t.rest.length > 1 ? `${repo}: ${t.rest[t.rest.length - 1]}/` : repo
    case 'compare':
      return t.base
        ? `${repo} ${t.base}${t.direct ? '..' : '...'}${t.head}`
        : `${repo} compare ${t.head}`
  }
}

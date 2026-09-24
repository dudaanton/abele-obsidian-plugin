/**
 * `github_file` and `github_commits`: the repository's code at a ref — a file a window of lines at
 * a time, a folder, a whole tree — and its history: a pull request's or branch's commits, one
 * commit's diff, a comparison of two refs.
 */
import type { AgentTool } from '../../client'
import { loadCommit, loadPullCommits, type DiffFile } from '@/github/api'
import { GithubError, type GithubClient } from '@/github/client'
import { blobCandidates, diffAnchorHash } from '@/github/urls'
import { splitMessage } from '@/github/format'
import {
  answer,
  clientFor,
  clip,
  day,
  DEFAULT_LINES,
  fileRows,
  findFile,
  MAX_LINES,
  parseNamed,
  patchWindow,
  repoName,
  repoPath,
  text,
  whole,
  type Named,
  type RepoRef,
} from './shared'

const TREE_MAX = 500
const DIR_MAX = 1000
/** A whole file comes back unasked only when it is this short. */
const WHOLE_FILE_LINES = 600
const COMMITS_PER_PAGE = 30
/** How much of a commit's diff is shown before the rest is left to be asked for by path. */
const PATCH_BUDGET = 20_000

// `any` below is the API's own JSON, read here and never passed on.

const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/')

function decodeBase64(content: string): string {
  const bytes = Uint8Array.from(atob(content.replace(/\s/g, '')), (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

interface Located {
  ref: string
  path: string
  /** The contents API's answer: an array for a folder, an object for anything else. */
  body: any
}

/** Asks for `path` at `ref` — the default branch without one. */
async function contents(client: GithubClient, repo: RepoRef, path: string, ref: string) {
  const query = ref ? `?ref=${encodeURIComponent(ref)}` : ''
  return client.get<any>(`${repoPath(repo)}/contents/${encodePath(path)}${query}`, {
    what: path ? `${path} in ${repoName(repo)}` : `the files of ${repoName(repo)}`,
  })
}

/**
 * The ref and path a link's `blob/…` or `tree/…` names. A branch may hold slashes, so each split
 * is asked in turn, the shortest ref first, as the file tab does.
 */
async function locate(client: GithubClient, repo: RepoRef, rest: string[]): Promise<Located> {
  if (rest.length === 1)
    return { ref: rest[0], path: '', body: await contents(client, repo, '', rest[0]) }
  let last: unknown = null
  for (const { ref, path } of blobCandidates(rest).slice(0, 6)) {
    try {
      return { ref, path, body: await contents(client, repo, path, ref) }
    } catch (e) {
      if (!(e instanceof GithubError) || e.kind !== 'not-found') throw e
      last = e
    }
  }
  throw last ?? new GithubError('not-found', 'GitHub has no such file.')
}

/** What the link or the parameters name: a ref, a path and the lines a link marked. */
function wanted(named: Named, params: Record<string, unknown>) {
  const t = named.target
  let rest: string[] | null = null
  let lines: { start: number; end: number } | undefined
  if (t?.kind === 'blob') {
    rest = t.rest
    lines = t.lines
  } else if (
    named.rest &&
    (named.rest[0] === 'tree' || named.rest[0] === 'blob') &&
    named.rest.length > 1
  ) {
    rest = named.rest.slice(1)
  }
  return { rest, lines, ref: text(params.ref), path: text(params.path).replace(/^\/+|\/+$/g, '') }
}

async function defaultBranch(client: GithubClient, repo: RepoRef): Promise<string> {
  const r = await client.get<any>(repoPath(repo), { what: `the repository ${repoName(repo)}` })
  return r.default_branch ?? 'main'
}

async function tree(
  client: GithubClient,
  repo: RepoRef,
  ref: string,
  path: string
): Promise<string> {
  const at = ref || (await defaultBranch(client, repo))
  const t = await client.get<any>(
    `${repoPath(repo)}/git/trees/${encodeURIComponent(at)}?recursive=1`,
    { what: `the file tree of ${repoName(repo)}` }
  )
  const prefix = path ? `${path}/` : ''
  const entries = ((t.tree ?? []) as any[]).filter((e) => !prefix || e.path.startsWith(prefix))
  const rows = entries
    .slice(0, TREE_MAX)
    .map((e) => (e.type === 'tree' ? `${e.path}/` : e.path) as string)
  const out = [
    `${repoName(repo)}@${at}${path ? ` · ${path}/` : ''} — ${entries.length} entries${entries.length > TREE_MAX ? `, first ${TREE_MAX} shown` : ''}`,
    ...rows,
  ]
  if (entries.length > TREE_MAX) out.push('[Narrow it: give a deeper `path`.]')
  if (t.truncated)
    out.push(
      'GitHub cut the tree short: the repository is too large to list whole. List a folder instead.'
    )
  return out.join('\n')
}

function folder(repo: RepoRef, ref: string, path: string, body: any[]): string {
  const sorted = [...body].sort((a, b) =>
    a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1
  )
  const rows = sorted.slice(0, DIR_MAX).map((e) => {
    if (e.type === 'dir') return `${e.name}/`
    if (e.type === 'file') return `${e.name}  (${e.size ?? 0} bytes)`
    return `${e.name}  (${e.type})`
  })
  const out = [
    `${repoName(repo)}${ref ? `@${ref}` : ''} · ${path || '/'} — ${body.length} entries`,
    ...rows,
  ]
  if (body.length > DIR_MAX) out.push(`[Only the first ${DIR_MAX} are listed.]`)
  return out.join('\n')
}

async function fileText(client: GithubClient, repo: RepoRef, ref: string, path: string, body: any) {
  if (body.encoding === 'base64' && body.content) return decodeBase64(body.content)
  // Over a megabyte the contents API sends no content; the raw media type still does.
  const query = ref ? `?ref=${encodeURIComponent(ref)}` : ''
  return client.get<string>(`${repoPath(repo)}/contents/${encodePath(path)}${query}`, {
    accept: 'application/vnd.github.raw+json',
    text: true,
    what: `${path} in ${repoName(repo)}`,
  })
}

function numbered(
  repo: RepoRef,
  ref: string,
  path: string,
  content: string,
  start?: number,
  end?: number
) {
  if (content.includes('\u0000'))
    return `${repoName(repo)}@${ref} · ${path} — a binary file; nothing to show as text.`
  const lines = content.split('\n')
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  const total = lines.length
  let from = start ?? 1
  let to =
    end ?? (start ? start + DEFAULT_LINES - 1 : total <= WHOLE_FILE_LINES ? total : DEFAULT_LINES)
  from = Math.min(Math.max(1, from), Math.max(1, total))
  to = Math.min(total, Math.max(from, to), from + MAX_LINES - 1)
  const width = String(to).length
  const rows = lines.slice(from - 1, to).map((l, i) => `${String(from + i).padStart(width)}  ${l}`)
  const out = [
    `${repoName(repo)}@${ref || 'default branch'} · ${path} — ${total} lines, showing ${from}–${to}`,
    ...rows,
  ]
  if (to < total)
    out.push(`[Lines ${to + 1}–${total} not shown: call again with start_line=${to + 1}.]`)
  if (from > 1) out.push(`[Lines 1–${from - 1} are before this window.]`)
  return out.join('\n')
}

export function createGithubFileTool(): AgentTool {
  return {
    name: 'github_file',
    label: 'Read GitHub file',
    description:
      "A repository's code at a branch, tag or commit: a file's lines, numbered, or a folder's entries. " +
      '`repo` takes owner/repo or a link — a `blob/…` link names the file, ref and lines by itself, a `tree/…` link a folder. ' +
      'A file longer than 600 lines comes back 400 lines at a time: use start_line/end_line (at most 1500 lines a call). ' +
      '`recursive: true` lists the whole tree under `path` (500 entries at most) — the way to get a map of an unknown codebase. Without `ref`, the default branch. Read-only.',
    parameters: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: 'owner/repo, or a GitHub link into the repository' },
        path: { type: 'string', description: 'File or folder path; empty for the root' },
        ref: {
          type: 'string',
          description: 'Branch, tag or commit SHA; the default branch without one',
        },
        start_line: { type: 'number', description: 'First line to show, 1-based' },
        end_line: { type: 'number', description: 'Last line to show' },
        recursive: {
          type: 'boolean',
          description: 'List every file under path, not only its direct entries',
        },
      },
      required: ['repo'],
    },
    execute: async (_id, params) => {
      const named = parseNamed(params.repo)
      const { repo } = named
      const client = clientFor(repo)
      const w = wanted(named, params)

      if (params.recursive === true) {
        let ref = w.ref
        let path = w.path
        if (w.rest && !ref) {
          const at = await locate(client, repo, w.rest)
          ref = at.ref
          path = path || at.path
        }
        return answer(await tree(client, repo, ref, path))
      }

      const at: Located =
        w.rest && !w.ref && !w.path
          ? await locate(client, repo, w.rest)
          : { ref: w.ref, path: w.path, body: await contents(client, repo, w.path, w.ref) }

      if (Array.isArray(at.body)) return answer(folder(repo, at.ref, at.path, at.body))
      const body = at.body
      if (body.type === 'symlink') return answer(`${at.path} is a link to ${body.target}.`)
      if (body.type === 'submodule') {
        return answer(
          `${at.path} is a submodule: ${body.submodule_git_url ?? 'another repository'} at ${body.sha}.`
        )
      }
      const content = await fileText(client, repo, at.ref, at.path, body)
      const start = params.start_line !== undefined ? whole(params.start_line, 1) : w.lines?.start
      const end = params.end_line !== undefined ? whole(params.end_line, 1) : w.lines?.end
      return answer(numbered(repo, at.ref, at.path, content, start, end))
    },
  }
}

// ── Commits ────────────────────────────────────────────────────

interface CommitRow {
  sha: string
  message: string
  author: string
  date: string
}

const commitRow = (c: CommitRow) =>
  `${c.sha.slice(0, 7)}  ${day(c.date)}  ${c.author}  ${splitMessage(c.message).title}`

const restCommit = (c: any): CommitRow => ({
  sha: c.sha,
  message: c.commit?.message ?? '',
  author: c.author?.login ?? c.commit?.author?.name ?? 'unknown',
  date: c.commit?.author?.date ?? '',
})

/** A diff's files with their patches, as far as the budget reaches; the rest by path. */
function filesWithPatches(files: DiffFile[], again: string): string[] {
  const out: string[] = ['## Files', ...fileRows(files), '']
  let used = 0
  const left: string[] = []
  for (const f of files) {
    const block = patchWindow(f, 1, DEFAULT_LINES, `${again} path="${f.path}" and`)
    if (used + block.length > PATCH_BUDGET) {
      left.push(f.path)
      continue
    }
    used += block.length
    out.push(block, '')
  }
  if (left.length) {
    out.push(
      `[Diffs not shown, to keep this short: ${left.join(', ')}. Ask for one with ${again} path.]`
    )
  }
  return out
}

interface CommitsWanted {
  pull?: number
  sha?: string
  base?: string
  head?: string
}

/** Which of the four the link and parameters ask for. */
function commitsWanted(named: Named, params: Record<string, unknown>): CommitsWanted {
  const t = named.target
  const w: CommitsWanted = {
    sha: text(params.sha) || undefined,
    base: text(params.base) || undefined,
    head: text(params.head) || undefined,
    pull: params.pull !== undefined ? whole(params.pull, 0) || undefined : undefined,
  }
  if (t?.kind === 'commit') w.sha ??= t.sha
  if (t?.kind === 'pull' || t?.kind === 'issue') w.pull ??= t.number
  if (!t && named.number) w.pull ??= named.number
  const compare = named.rest?.[0] === 'compare' ? named.rest.slice(1).join('/') : ''
  const m = /^(.+?)\.{2,3}(.+)$/.exec(compare)
  if (m) {
    w.base ??= m[1]
    w.head ??= m[2]
  }
  return w
}

async function oneCommit(repo: RepoRef, sha: string, path: string, offset: number, limit: number) {
  const c = await loadCommit(clientFor(repo), { ...repo, kind: 'commit', sha })
  const again = `call github_commits again with sha="${c.sha.slice(0, 12)}",`
  const out = [
    `Commit ${repoName(repo)}@${c.sha.slice(0, 7)} — ${c.author}, ${day(c.date)}`,
    `URL: ${c.url}`,
    '',
    clip(c.message.trim(), 5_000),
    '',
  ]
  if (path) out.push(patchWindow(findFile(c.files, path), offset, limit, `${again} path=…,`))
  else out.push(...filesWithPatches(c.files, again))
  return out.join('\n')
}

async function compare(
  repo: RepoRef,
  base: string,
  head: string,
  path: string,
  offset: number,
  limit: number
) {
  const client = clientFor(repo)
  const range = `${encodeURIComponent(base)}...${encodeURIComponent(head)}`
  const c = await client.get<any>(`${repoPath(repo)}/compare/${range}`, {
    what: `the comparison of ${base} and ${head}`,
  })
  const files: DiffFile[] = await Promise.all(
    ((c.files ?? []) as any[]).map(async (f) => ({
      path: f.filename,
      previousPath: f.previous_filename,
      status: f.status,
      additions: f.additions ?? 0,
      deletions: f.deletions ?? 0,
      patch: f.patch,
      hash: await diffAnchorHash(f.filename),
      reviewComments: [] as DiffFile['reviewComments'],
    }))
  )
  const commits = ((c.commits ?? []) as any[]).map(restCommit)
  const again = `call github_commits again with base="${base}", head="${head}",`
  const out = [
    `Compare ${repoName(repo)} ${base}...${head} — ${c.status}: ${c.ahead_by} ahead, ${c.behind_by} behind`,
    `URL: ${c.html_url ?? ''}`,
    '',
  ]
  if (path) {
    out.push(patchWindow(findFile(files, path), offset, limit, `${again} path=…,`))
    return out.join('\n')
  }
  out.push(
    `## Commits (${c.total_commits ?? commits.length})`,
    ...commits.slice(0, 50).map(commitRow)
  )
  if (commits.length > 50) out.push(`[${commits.length - 50} more commits not listed.]`)
  out.push('', ...filesWithPatches(files, again))
  return out.join('\n')
}

export function createGithubCommitsTool(): AgentTool {
  return {
    name: 'github_commits',
    label: 'GitHub commits',
    description:
      "Commits, four ways. `pull` (or a pull request link / owner/repo#12): the pull request's commits. `sha` (or a commit link): that commit's message, files and diffs. " +
      '`base` and `head` (or a compare link): what head has that base has not — commits, files and diffs. Otherwise the history of `ref` (the default branch without one), 30 a page, of `path` alone when given. ' +
      "A commit's or comparison's diffs are shown until they get long; ask for one file's diff with `path`, `offset` and `limit`. Read-only.",
    parameters: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: 'owner/repo, owner/repo#12, or a GitHub link' },
        pull: { type: 'number', description: 'Pull request number' },
        sha: { type: 'string', description: 'A commit SHA' },
        base: { type: 'string', description: 'Base ref of a comparison' },
        head: { type: 'string', description: 'Head ref of a comparison' },
        ref: { type: 'string', description: 'Branch or tag whose history to list' },
        path: {
          type: 'string',
          description:
            'With sha or base/head: the file whose diff to show. Otherwise: list only commits touching it',
        },
        offset: { type: 'number', description: 'First diff row, with path' },
        limit: { type: 'number', description: 'Diff rows, with path; 400 by default' },
        page: { type: 'number', description: 'Page of a commit list' },
      },
      required: ['repo'],
    },
    execute: async (_id, params) => {
      const named = parseNamed(params.repo)
      const { repo } = named
      const w = commitsWanted(named, params)
      const path = text(params.path)
      const offset = whole(params.offset, 1)
      const limit = whole(params.limit, DEFAULT_LINES)
      const page = whole(params.page, 1)

      if (w.sha) return answer(await oneCommit(repo, w.sha, path, offset, limit))
      if (w.base && w.head) return answer(await compare(repo, w.base, w.head, path, offset, limit))
      if (w.base || w.head) throw new Error('A comparison needs both base and head.')

      if (w.pull) {
        const all = await loadPullCommits(clientFor(repo), {
          ...repo,
          kind: 'pull',
          number: w.pull,
          tab: 'commits',
        })
        const first = (page - 1) * 100
        const shown = all.slice(first, first + 100)
        const out = [
          `Pull request ${repoName(repo)}#${w.pull} — ${all.length} commits${shown.length ? ` (${first + 1}–${first + shown.length})` : ''}`,
          ...shown.map(commitRow),
        ]
        if (first + shown.length < all.length) out.push(`[More: page=${page + 1}.]`)
        out.push('', "One commit's diff: call again with its sha.")
        return answer(out.join('\n'))
      }

      const ref = text(params.ref)
      const query = [
        ref ? `sha=${encodeURIComponent(ref)}` : '',
        path ? `path=${encodeURIComponent(path)}` : '',
        `per_page=${COMMITS_PER_PAGE}`,
        `page=${page}`,
      ].filter(Boolean)
      const list = await clientFor(repo).get<any[]>(
        `${repoPath(repo)}/commits?${query.join('&')}`,
        {
          what: `the commits of ${repoName(repo)}`,
        }
      )
      const out = [
        `${repoName(repo)} — commits on ${ref || 'the default branch'}${path ? ` touching ${path}` : ''}, page ${page}`,
        ...list.map(restCommit).map(commitRow),
      ]
      if (list.length === 0) out.push('(none)')
      if (list.length === COMMITS_PER_PAGE) out.push(`[Older: page=${page + 1}.]`)
      return answer(out.join('\n'))
    },
  }
}

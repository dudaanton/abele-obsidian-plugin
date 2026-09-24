/**
 * `github_grep`: a repository's code at one exact version, searched like grep — the same
 * in-memory index a GitHub tab's code search and go to definition build, so a search one of them
 * started the others get for free.
 *
 * Read only. The repository at that commit is downloaded once a session, up to the size set in
 * the GitHub settings; past it GitHub's own code search answers instead — default branch only —
 * and the answer says so.
 */
import type { AgentTool } from '../../client'
import { githubSettings } from '@/github/GithubService'
import {
  TooLargeError,
  defaultBranch,
  githubCodeSearch,
  loadTree,
  matchFileNames,
  repoIndex,
  resolveSha,
} from '@/github/search/source'
import { globMatcher } from '@/github/search/textSearch'
import {
  answer,
  clientFor,
  parseNamed,
  repoName,
  repoPath,
  text,
  whole,
  type RepoRef,
} from './shared'

const MAX_LIMIT = 500
const DEFAULT_LIMIT = 100

/** The repository and the ref a `repo` argument names — a pull request means its head. */
async function locate(input: unknown, ref: string): Promise<{ repo: RepoRef; ref?: string }> {
  const named = parseNamed(input)
  const repo = named.repo
  if (ref) return { repo, ref }
  const t = named.target
  if (t?.kind === 'commit') return { repo, ref: t.sha }
  if (t?.kind === 'blob' || t?.kind === 'tree') return { repo, ref: t.rest[0] }
  // A pull request's link, or `owner/repo#12` that turns out to be one.
  const number = t?.kind === 'pull' ? t.number : t ? undefined : named.number
  if (number !== undefined) {
    try {
      const pull = await clientFor(repo).get<{ head?: { sha?: string } }>(
        `${repoPath(repo)}/pulls/${number}`,
        { what: 'the pull request' }
      )
      if (pull.head?.sha) return { repo, ref: pull.head.sha }
    } catch (e) {
      // `#12` named on its own may be an issue: then the default branch is what there is.
      if (t?.kind === 'pull') throw e
    }
  }
  return { repo }
}

export async function runGithubGrep(params: Record<string, unknown>): Promise<string> {
  const settings = githubSettings()
  const mode = params.mode === 'names' ? 'names' : 'content'
  const query = typeof params.query === 'string' ? params.query : ''
  if (!query && mode === 'content') throw new Error('Give a query.')
  const offset = whole(params.offset, 0, 0)
  const limit = Math.min(MAX_LIMIT, whole(params.limit, DEFAULT_LIMIT))

  const located = await locate(params.repo, text(params.ref))
  const repo = located.repo
  const client = clientFor(repo)
  // Named even when it was not asked for, so the answer says which branch it searched.
  const ref = located.ref || (await defaultBranch(client, repo))
  const sha = await resolveSha(client, repo, ref)
  const name = `${repoName(repo)}@${sha.slice(0, 7)}${ref && ref !== sha ? ` (${ref})` : ''}`
  const glob = text(params.path)

  if (mode === 'names') {
    const tree = await loadTree(client, repo, sha)
    const admits = globMatcher(glob)
    const all = matchFileNames(
      tree.files.filter((f) => admits(f.path)),
      query,
      offset + limit
    )
    const page = all.slice(offset, offset + limit)
    const range = page.length ? `files ${offset + 1}–${offset + page.length}` : 'no files'
    const more = all.length >= offset + limit ? ' (more: raise offset)' : ''
    const cut = tree.truncated ? '; GitHub listed only part of this repository' : ''
    return [`${name} — ${range} matching "${query}"${more}${cut}`, ...page.map((f) => f.path)].join(
      '\n'
    )
  }

  const limitBytes = (settings.searchLimitMb || 100) * 1024 * 1024
  try {
    const index = await repoIndex(client, repo, sha, { limitBytes })
    const result = await index.search(
      { text: query, regex: params.regex === true, caseSensitive: params.case_sensitive === true },
      { glob, limit: offset + limit, perFile: 100 }
    )
    const lines: string[] = []
    let n = 0
    for (const file of result.files) {
      const inPage: string[] = []
      for (const m of file.matches) {
        if (n >= offset && n < offset + limit) inPage.push(`  ${m.line}: ${m.text}`)
        n++
      }
      if (inPage.length) lines.push(file.path, ...inPage)
    }
    const shown = Math.max(0, Math.min(n, offset + limit) - offset)
    const head = shown
      ? `${name} — matching lines ${offset + 1}–${offset + shown} of ${result.capped ? `more than ${n}` : n}, in ${result.files.length} files (${result.searched} searched)`
      : `${name} — no matching lines${offset ? ` past ${offset}` : ''} in ${result.searched} files`
    const more = result.capped
      ? '\nThere are more: call again with a higher offset, or narrow with path.'
      : ''
    const skipped =
      index.binary || index.oversized
        ? `\n(${index.binary} binary and ${index.oversized} files over 1 MB are not searched.)`
        : ''
    return `${head}${skipped}\n${lines.join('\n')}${more}`.trimEnd()
  } catch (e) {
    if (!(e instanceof TooLargeError)) throw e
    if (params.regex === true) {
      throw new Error(
        `${e.message} GitHub's own code search, the fallback, takes no regular expressions: search a plain word instead.`
      )
    }
    const found = await githubCodeSearch(client, repo, query, limit)
    return [
      `${e.message} Results below are from GitHub's code search: the default branch only, fragments rather than line numbers, ${found.total} files in all.`,
      ...found.files.flatMap((f) => [
        f.path,
        ...(found.fragments[f.path] ?? []).map((t) => `  … ${t.replace(/\s+/g, ' ').trim()}`),
      ]),
    ].join('\n')
  }
}

export function createGithubGrepTool(): AgentTool {
  return {
    name: 'github_grep',
    label: 'Grep code at a version',
    description:
      'Search the code of a GitHub repository at one exact version — a branch, a tag, a commit, or the head of a pull request — like grep: plain text or a regular expression, any branch, line numbers. ' +
      'Unlike github_search it is not limited to the default branch and needs no token for a public repository. Mode "names" lists file paths instead. ' +
      'The first search of a version downloads that repository once for the session (up to the size set in GitHub settings); a bigger one falls back to GitHub code search on the default branch, which the answer says. Page with offset. Read-only.',
    parameters: {
      type: 'object',
      properties: {
        repo: {
          type: 'string',
          description:
            'owner/repo, owner/repo#12, or any GitHub link into the repository. A pull request searches its head; a commit or a file link, that commit or ref.',
        },
        ref: {
          type: 'string',
          description:
            'Branch, tag or commit SHA. Default: what the link names, else the default branch.',
        },
        query: {
          type: 'string',
          description:
            'Text to find (plain unless regex is true). For mode "names", words in the path.',
        },
        regex: { type: 'boolean', description: 'Read query as a JavaScript regular expression.' },
        case_sensitive: { type: 'boolean', description: 'Match letter case. Default false.' },
        path: {
          type: 'string',
          description:
            'Only files matching this glob, like "src/**/*.ts" or "*.py". Several: comma-separated.',
        },
        mode: {
          type: 'string',
          enum: ['content', 'names'],
          description: '"content" (default) searches inside files; "names" lists matching paths.',
        },
        offset: { type: 'number', description: 'Skip this many results, for the next page.' },
        limit: {
          type: 'number',
          description: `Results per page, up to ${MAX_LIMIT}. Default ${DEFAULT_LIMIT}.`,
        },
      },
      required: ['repo'],
    },
    execute: async (_id, params) => answer(await runGithubGrep(params)),
  }
}

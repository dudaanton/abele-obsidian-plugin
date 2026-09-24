/**
 * `github_search`: code, and issues with pull requests, through GitHub's REST search — the one
 * that exists on an Enterprise Server as well as on github.com.
 */
import type { AgentTool } from '../../client'
import { GithubError } from '@/github/client'
import { githubSettings } from '@/github/GithubService'
import { endpoints } from '@/github/urls'
import { answer, clientFor, clip, day, parseNamed, repoName, text, whole } from './shared'

const PER_PAGE = 20
/** GitHub answers no further than the thousandth result, whatever the total says. */
const REACHABLE = 1000

// `any` below is the API's own JSON, read here and never passed on.

const CODE_SEARCH_NOTE =
  "Code search through the API needs a token on github.com and searches only each repository's default branch. " +
  'Without one, look through the code with github_file instead (recursive: true for the tree).'

function codeRows(items: any[]): string[] {
  return items.flatMap((i) => {
    const repo = i.repository?.full_name ?? ''
    const fragments = ((i.text_matches ?? []) as any[])
      .slice(0, 2)
      .map((m) => clip(String(m.fragment ?? '').trim(), 400))
      .filter(Boolean)
      .map((f) =>
        f
          .split('\n')
          .map((l: string) => `    ${l}`)
          .join('\n')
      )
    return [`${repo} · ${i.path} — ${i.html_url}`, ...fragments, '']
  })
}

function issueRows(items: any[]): string[] {
  return items.map((i) => {
    const repo = String(i.repository_url ?? '')
      .split('/')
      .slice(-2)
      .join('/')
    const kind = i.pull_request ? 'PR' : 'issue'
    const state = i.pull_request?.merged_at ? 'merged' : i.state
    return `${repo}#${i.number} [${kind}, ${state}] ${i.title} — by ${i.user?.login ?? 'unknown'}, updated ${day(i.updated_at)} — ${i.html_url}`
  })
}

export function createGithubSearchTool(): AgentTool {
  return {
    name: 'github_search',
    label: 'Search GitHub',
    description:
      'Search GitHub. `type: "code"` finds files by their content (GitHub code-search syntax: `useState language:ts path:src/`); it needs a token on github.com and searches default branches only. ' +
      '`type: "issues"` finds issues and pull requests (`is:pr is:open author:alice label:bug` and the rest of GitHub\'s syntax). ' +
      '`repo` narrows either to one repository. 20 results a page. Read-only.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to search for, in GitHub search syntax' },
        type: {
          type: 'string',
          enum: ['code', 'issues'],
          description: 'code, or issues (which includes pull requests)',
        },
        repo: { type: 'string', description: 'owner/repo or a link, to search one repository' },
        page: { type: 'number', description: 'Page of results, 1 by default' },
      },
      required: ['query', 'type'],
    },
    execute: async (_id, params) => {
      const query = text(params.query)
      if (!query) throw new Error('Give a query.')
      const type = params.type === 'code' ? 'code' : 'issues'
      const named = text(params.repo) ? parseNamed(params.repo) : null
      const host = named?.repo.host ?? endpoints(githubSettings().server).webHost
      const q = named ? `${query} repo:${repoName(named.repo)}` : query
      const page = whole(params.page, 1)
      if (page * PER_PAGE > REACHABLE + PER_PAGE) {
        throw new Error(
          `GitHub serves only the first ${REACHABLE} results; narrow the query instead.`
        )
      }

      const client = clientFor(named?.repo ?? { host, owner: '', repo: '' })
      let body: any
      try {
        body = await client.get<any>(
          `/search/${type}?q=${encodeURIComponent(q)}&per_page=${PER_PAGE}&page=${page}`,
          {
            accept: type === 'code' ? 'application/vnd.github.text-match+json' : undefined,
            what: type === 'code' ? 'code search' : 'the issue search',
          }
        )
      } catch (e) {
        if (type === 'code' && e instanceof GithubError && e.kind !== 'network') {
          throw new Error(`${e.message}\n${CODE_SEARCH_NOTE}`)
        }
        throw e
      }

      const items = (body.items ?? []) as any[]
      const total = body.total_count ?? items.length
      const first = (page - 1) * PER_PAGE
      const out = [
        `${type === 'code' ? 'Code' : 'Issues and pull requests'} matching ${q} — ${total} found` +
          (items.length ? `, showing ${first + 1}–${first + items.length}` : ''),
        '',
        ...(type === 'code' ? codeRows(items) : issueRows(items)),
      ]
      if (body.incomplete_results)
        out.push('GitHub stopped searching early: the results may be incomplete.')
      if (first + items.length < Math.min(total, REACHABLE)) out.push(`[More: page=${page + 1}.]`)
      return answer(out.join('\n'))
    },
  }
}

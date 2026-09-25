/**
 * What the "Open on GitHub" picker offers for an input: the rows it can show at once, and the
 * questions to GitHub that fill in the rest.
 *
 * Each question has a key, and its answer is kept under it for as long as the picker is open —
 * typing a word, deleting it and typing it again asks nothing twice. The search API allows ten
 * requests a minute without a token and thirty with one, so the picker only asks once the typing
 * has paused (see `OpenPicker`), and an answer that arrives for an input no longer on screen is
 * kept and shown only if that input comes back. Obsidian's `requestUrl` cannot be aborted; a
 * question typed past before the pause is simply never sent.
 */
import { GithubError, type GithubClient } from '../client'
import { repoApiPath } from '../contents'
import { repoWeb } from '../origin'
import { shortName, type GithubTarget } from '../urls'
import { compareUrl } from '../compare'
import { SHA, repoKey, repoName, type OpenQuery, type RepoRef } from './query'

export type RowKind =
  | 'pull'
  | 'issue'
  | 'discussion'
  | 'commit'
  | 'compare'
  | 'branch'
  | 'repo'
  | 'file'
  | 'folder'
  | 'note'

export interface OpenRow {
  kind: RowKind
  title: string
  /** Under the title: where it is and what state it is in. */
  note?: string
  /** Where it opens. */
  url?: string
  /** For a row whose address needs GitHub first — a bare number, a repository's default branch. */
  resolve?: () => Promise<string>
  /** The repository it belongs to, remembered as the next picker's default. */
  repo?: RepoRef
}

interface Lookup {
  key: string
  run: () => Promise<OpenRow[]>
  /** Narrows a kept answer to this input — a repository's branches to those matching. */
  filter?: (rows: OpenRow[]) => OpenRow[]
  /** Shown in the answer's place until it arrives. */
  placeholder?: OpenRow
}

interface Settled {
  rows: OpenRow[]
  error?: string
}

export interface OpenView {
  rows: OpenRow[]
  /** Some question for this input has not been answered yet. */
  pending: boolean
  /** Why there is nothing to show, when there is nothing — or what to type. */
  message?: string
}

/** Shortest input the title and repository searches are asked about. */
export const MIN_SEARCH = 2
const SEARCH_RESULTS = 8
const BRANCH_RESULTS = 5
const BRANCH_PAGE = 100

const KIND_OF_TARGET: Record<GithubTarget['kind'], RowKind> = {
  issue: 'issue',
  pull: 'pull',
  discussion: 'discussion',
  commit: 'commit',
  compare: 'compare',
  blob: 'file',
  tree: 'folder',
}

const KIND_NAME: Record<RowKind, string> = {
  pull: 'Pull request',
  issue: 'Issue',
  discussion: 'Discussion',
  commit: 'Commit',
  compare: 'Comparison',
  branch: 'Branch',
  repo: 'Repository',
  file: 'File',
  folder: 'Folder',
  note: '',
}

export const kindName = (kind: RowKind): string => KIND_NAME[kind]

const encodeRef = (ref: string) => ref.split('/').map(encodeURIComponent).join('/')

export const itemUrl = (repo: RepoRef, kind: 'pull' | 'issue' | 'discussion', n: number) =>
  `${repoWeb(repo)}/${kind === 'pull' ? 'pull' : kind === 'issue' ? 'issues' : 'discussions'}/${n}`

export const branchUrl = (repo: RepoRef, branch: string) =>
  `${repoWeb(repo)}/tree/${encodeRef(branch)}`

export const commitUrl = (repo: RepoRef, sha: string) => `${repoWeb(repo)}/commit/${sha}`

const firstLine = (text: string | undefined) => (text ?? '').split('\n')[0].trim()

/** GitHub's own words for why it refused, said for this picker rather than for a tab. */
function problem(e: unknown, search: boolean): string {
  if (e instanceof GithubError) {
    if (e.kind === 'rate-limit' && search) {
      return 'GitHub takes only a few searches a minute (10 without a token, 30 with one). Pause a moment, then type again.'
    }
    return [e.reason, e.fix].filter(Boolean).join(' ')
  }
  return e instanceof Error ? e.message : typeof e === 'string' ? e : 'GitHub could not be asked.'
}

const isGone = (e: unknown) => e instanceof GithubError && (e.status === 404 || e.status === 410)

interface RawIssue {
  number: number
  title: string
  state: string
  draft?: boolean
  pull_request?: { merged_at?: string | null }
}

export class OpenSearch {
  private readonly started = new Map<string, Promise<void>>()
  private readonly settled = new Map<string, Settled>()

  constructor(private readonly clientFor: (host: string) => GithubClient) {}

  /** Opens a number the way GitHub has it: a pull request, an issue or a discussion. */
  private async number(repo: RepoRef, n: number): Promise<OpenRow[]> {
    const client = this.clientFor(repo.host)
    const where = `${repoName(repo)}#${n}`
    try {
      const issue = await client.get<RawIssue>(`${repoApiPath(repo)}/issues/${n}`, {
        what: `${where}`,
      })
      const kind = issue.pull_request ? 'pull' : 'issue'
      const state = issue.pull_request?.merged_at
        ? 'merged'
        : issue.draft && issue.state === 'open'
          ? 'draft'
          : issue.state
      return [
        {
          kind,
          title: issue.title,
          note: `${where} · ${KIND_NAME[kind]} · ${state}`,
          url: itemUrl(repo, kind, n),
          repo,
        },
      ]
    } catch (e) {
      if (!isGone(e)) throw e
    }

    // Issues and pull requests share their numbers with discussions; the issues API does not
    // know a discussion's, and only a signed-in GraphQL request can confirm one.
    if (!client.hasToken) {
      return [
        {
          kind: 'discussion',
          title: `Discussion #${n}`,
          note: `${repoName(repo)} has no issue or pull request #${n}; it may be a discussion, which GitHub shows only with a token`,
          url: itemUrl(repo, 'discussion', n),
          repo,
        },
      ]
    }
    const data = await client.graphql<{
      repository?: { discussion?: { title: string; closed?: boolean; isAnswered?: boolean } | null }
    }>(
      'query($owner:String!,$repo:String!,$number:Int!){repository(owner:$owner,name:$repo){discussion(number:$number){title closed isAnswered}}}',
      { owner: repo.owner, repo: repo.repo, number: n },
      where
    )
    const d = data.repository?.discussion
    if (!d) throw new GithubError('not-found', `${repoName(repo)} has nothing numbered #${n}.`, 404)
    return [
      {
        kind: 'discussion',
        title: d.title,
        note: `${where} · Discussion · ${d.isAnswered ? 'answered' : d.closed ? 'closed' : 'open'}`,
        url: itemUrl(repo, 'discussion', n),
        repo,
      },
    ]
  }

  private async issues(repo: RepoRef, text: string): Promise<OpenRow[]> {
    const q = `repo:${repoName(repo)} ${text} in:title`
    const found = await this.clientFor(repo.host).get<{ items?: RawIssue[] }>(
      `/search/issues?q=${encodeURIComponent(q)}&per_page=${SEARCH_RESULTS}`,
      { what: `the issues of ${repoName(repo)}` }
    )
    return (found.items ?? []).map((issue) => {
      const kind = issue.pull_request ? 'pull' : 'issue'
      const state = issue.pull_request?.merged_at ? 'merged' : issue.state
      return {
        kind,
        title: issue.title,
        note: `${repoName(repo)}#${issue.number} · ${KIND_NAME[kind]} · ${state}`,
        url: itemUrl(repo, kind, issue.number),
        repo,
      }
    })
  }

  private async discussions(repo: RepoRef, text: string): Promise<OpenRow[]> {
    const data = await this.clientFor(repo.host).graphql<{
      search?: {
        nodes?: ({
          number?: number
          title?: string
          closed?: boolean
          isAnswered?: boolean
        } | null)[]
      }
    }>(
      'query($q:String!){search(query:$q,type:DISCUSSION,first:5){nodes{... on Discussion{number title closed isAnswered}}}}',
      { q: `repo:${repoName(repo)} ${text} in:title` },
      `the discussions of ${repoName(repo)}`
    )
    return (data.search?.nodes ?? [])
      .filter((d): d is { number: number; title: string } => !!d?.number && !!d.title)
      .map((d) => ({
        kind: 'discussion' as const,
        title: d.title,
        note: `${repoName(repo)}#${d.number} · Discussion`,
        url: itemUrl(repo, 'discussion', d.number),
        repo,
      }))
  }

  private branchRow(repo: RepoRef, name: string): OpenRow {
    return {
      kind: 'branch',
      title: name,
      note: `${repoName(repo)} · Branch`,
      url: branchUrl(repo, name),
      repo,
    }
  }

  /** The first hundred branches, once per repository; typing narrows them here. */
  private async branches(repo: RepoRef): Promise<OpenRow[]> {
    const page = await this.clientFor(repo.host).get<{ name: string }[]>(
      `${repoApiPath(repo)}/branches?per_page=${BRANCH_PAGE}`,
      { what: `the branches of ${repoName(repo)}` }
    )
    const rows = page.map((b) => this.branchRow(repo, b.name))
    // A full page means there are more: say so to `view`, which then asks by prefix as well.
    if (page.length >= BRANCH_PAGE) rows.push({ kind: 'note', title: 'more' })
    return rows
  }

  private async branchesStarting(repo: RepoRef, prefix: string): Promise<OpenRow[]> {
    const refs = await this.clientFor(repo.host).get<{ ref: string }[]>(
      `${repoApiPath(repo)}/git/matching-refs/heads/${encodeRef(prefix)}`,
      { what: `the branches of ${repoName(repo)}` }
    )
    return refs
      .slice(0, BRANCH_RESULTS)
      .map((r) => this.branchRow(repo, r.ref.replace(/^refs\/heads\//, '')))
  }

  private async commit(repo: RepoRef, sha: string): Promise<OpenRow[]> {
    try {
      const c = await this.clientFor(repo.host).get<{
        sha: string
        commit?: { message?: string; author?: { name?: string } }
      }>(`${repoApiPath(repo)}/commits/${encodeURIComponent(sha)}`, { what: 'the commit' })
      return [
        {
          kind: 'commit',
          title: firstLine(c.commit?.message) || c.sha.slice(0, 7),
          note: `${repoName(repo)}@${c.sha.slice(0, 7)} · Commit${c.commit?.author?.name ? ` by ${c.commit.author.name}` : ''}`,
          url: commitUrl(repo, c.sha),
          repo,
        },
      ]
    } catch (e) {
      // Not a commit after all: some hex is only a word. 422 is how GitHub says "no such SHA".
      if (isGone(e) || (e instanceof GithubError && e.status === 422)) return []
      throw e
    }
  }

  private repoRow(repo: RepoRef, defaultBranch: string, description?: string | null): OpenRow {
    return {
      kind: 'repo',
      title: repoName(repo),
      note: ['Repository', description?.trim()].filter(Boolean).join(' · '),
      url: branchUrl(repo, defaultBranch),
      repo,
    }
  }

  private async repository(repo: RepoRef): Promise<OpenRow[]> {
    try {
      const r = await this.clientFor(repo.host).get<{
        default_branch: string
        description?: string | null
        name?: string
        owner?: { login?: string }
      }>(repoApiPath(repo), { what: repoName(repo) })
      // GitHub answers a renamed repository under its new name.
      const named = { ...repo, owner: r.owner?.login ?? repo.owner, repo: r.name ?? repo.repo }
      return [this.repoRow(named, r.default_branch, r.description)]
    } catch (e) {
      if (isGone(e)) return []
      throw e
    }
  }

  private async repositories(host: string, text: string): Promise<OpenRow[]> {
    const found = await this.clientFor(host).get<{
      items?: {
        name: string
        owner: { login: string }
        default_branch: string
        description?: string | null
      }[]
    }>(`/search/repositories?q=${encodeURIComponent(`${text} in:name`)}&per_page=6`, {
      what: 'repositories',
    })
    return (found.items ?? []).map((r) =>
      this.repoRow({ host, owner: r.owner.login, repo: r.name }, r.default_branch, r.description)
    )
  }

  /** The address a row without one opens: after asking GitHub, as its lookup does. */
  private resolver(lookup: Lookup): () => Promise<string> {
    return async () => {
      await this.start(lookup)
      const settled = this.settled.get(lookup.key)
      const url = settled?.rows.find((r) => r.url)?.url
      if (url) return url
      throw new Error(settled?.error ?? 'GitHub has nothing under that.')
    }
  }

  private lookups(q: OpenQuery, defaultHost: string): Lookup[] {
    switch (q.kind) {
      case 'repo-link': {
        const lookup: Lookup = {
          key: `repo:${repoKey(q.repo)}`,
          run: () => this.repository(q.repo),
        }
        lookup.placeholder = {
          kind: 'repo',
          title: repoName(q.repo),
          note: 'Repository · its files on the default branch',
          resolve: this.resolver(lookup),
          repo: q.repo,
        }
        return [lookup]
      }
      case 'number': {
        if (!q.repo) return []
        const repo = q.repo
        const lookup: Lookup = {
          key: `number:${repoKey(repo)}#${q.number}`,
          run: () => this.number(repo, q.number),
        }
        lookup.placeholder = {
          kind: 'issue',
          title: `#${q.number}`,
          note: `${repoName(repo)} · looking it up…`,
          resolve: this.resolver(lookup),
          repo,
        }
        return [lookup]
      }
      case 'text': {
        const out: Lookup[] = []
        const text = q.text
        const words = text.length >= MIN_SEARCH
        if (q.named) {
          const named = q.named
          out.push({ key: `repo:${repoKey(named)}`, run: () => this.repository(named) })
        }
        const repo = q.repo
        if (repo) {
          const key = repoKey(repo)
          if (SHA.test(text)) {
            out.push({
              key: `sha:${key}@${text.toLowerCase()}`,
              run: () => this.commit(repo, text),
            })
          }
          if (words) {
            out.push({
              key: `issues:${key}:${text.toLowerCase()}`,
              run: () => this.issues(repo, text),
            })
            if (this.clientFor(repo.host).hasToken) {
              out.push({
                key: `discussions:${key}:${text.toLowerCase()}`,
                run: () => this.discussions(repo, text),
              })
            }
          }
          const needle = text.toLowerCase()
          out.push({
            key: `branches:${key}`,
            run: () => this.branches(repo),
            filter: (rows) =>
              rows
                .filter((r) => r.kind === 'branch' && r.title.toLowerCase().includes(needle))
                .sort(
                  (a, b) =>
                    Number(!a.title.toLowerCase().startsWith(needle)) -
                    Number(!b.title.toLowerCase().startsWith(needle))
                )
                .slice(0, BRANCH_RESULTS),
          })
          if (this.settled.get(`branches:${key}`)?.rows.some((r) => r.kind === 'note') && words) {
            out.push({
              key: `refs:${key}:${text}`,
              run: () => this.branchesStarting(repo, text),
            })
          }
        } else if (words && !q.named) {
          out.push({
            key: `repos:${defaultHost}:${text.toLowerCase()}`,
            run: () => this.repositories(defaultHost, text),
          })
        }
        return out
      }
      default:
        return []
    }
  }

  private start(lookup: Lookup): Promise<void> {
    let running = this.started.get(lookup.key)
    if (running === undefined) {
      const search = /^(issues|discussions|repos):/.test(lookup.key)
      running = lookup.run().then(
        (rows): void => {
          this.settled.set(lookup.key, { rows })
        },
        (e: unknown): void => {
          this.settled.set(lookup.key, { rows: [], error: problem(e, search) })
        }
      )
      this.started.set(lookup.key, running)
    }
    return running
  }

  /** Whether an input still has questions nobody has asked GitHub yet. */
  unasked(q: OpenQuery, defaultHost: string): boolean {
    return this.lookups(q, defaultHost).some((l) => !this.started.has(l.key))
  }

  /**
   * Asks GitHub every question an input raises that has not been asked, and settles when all
   * of them are answered — the branches first, since whether there are more than a page of them
   * decides one more question.
   */
  async fetch(q: OpenQuery, defaultHost: string): Promise<void> {
    await Promise.all(this.lookups(q, defaultHost).map((l) => this.start(l)))
    // The branch list may have just said there are more; ask by prefix then.
    const more = this.lookups(q, defaultHost).filter((l) => !this.started.has(l.key))
    await Promise.all(more.map((l) => this.start(l)))
  }

  /** What to show for an input right now, from what is known. */
  view(q: OpenQuery, defaultHost: string, contextRepo: RepoRef | null): OpenView {
    switch (q.kind) {
      case 'empty':
        return {
          rows: [],
          pending: false,
          message: contextRepo
            ? `Type a number, words of a title, a branch or a commit in ${repoName(contextRepo)} — or paste a link.`
            : 'Paste a GitHub link, or type owner/repo, owner/repo#123, or owner/repo and words of a title.',
        }
      case 'foreign':
        return {
          rows: [],
          pending: false,
          message: `${q.host} is neither github.com nor the server set in Abele settings → GitHub.`,
        }
      case 'unreadable':
        return {
          rows: [],
          pending: false,
          message:
            'That link names no repository. Paste a link to an issue, pull request, discussion, commit, branch or file.',
        }
      case 'link':
        return {
          rows: [
            {
              kind: KIND_OF_TARGET[q.target.kind],
              title: shortName(q.target),
              note: `${KIND_NAME[KIND_OF_TARGET[q.target.kind]]} · open this link`,
              url: q.url,
              repo: { host: q.target.host, owner: q.target.owner, repo: q.target.repo },
            },
          ],
          pending: false,
        }
      case 'compare': {
        const range = `${q.base}${q.direct ? '..' : '...'}${q.head}`
        if (!q.repo) {
          return {
            rows: [],
            pending: false,
            message: `${range} in which repository? Type owner/repo ${range}, or open a GitHub tab first.`,
          }
        }
        return {
          rows: [
            {
              kind: 'compare',
              title: range,
              note: `${repoName(q.repo)} · Comparison · ${
                q.direct
                  ? `${q.base} and ${q.head} side by side`
                  : `what ${q.head} has that ${q.base} has not`
              }`,
              url: compareUrl(q.repo, q.base, q.head, q.direct),
              repo: q.repo,
            },
          ],
          pending: false,
        }
      }
      case 'number':
        if (!q.repo) {
          return {
            rows: [],
            pending: false,
            message: `#${q.number} in which repository? Type owner/repo#${q.number}, open a GitHub tab first, or set a default repository in Abele settings → GitHub.`,
          }
        }
        break
    }

    const rows: OpenRow[] = []
    const errors: string[] = []
    let pending = false
    for (const lookup of this.lookups(q, defaultHost)) {
      const settled = this.settled.get(lookup.key)
      if (!settled) {
        pending = true
        if (lookup.placeholder) rows.push(lookup.placeholder)
        continue
      }
      const shown = (lookup.filter ?? ((r: OpenRow[]) => r))(settled.rows)
      rows.push(...shown.filter((r) => r.kind !== 'note'))
      if (settled.error && !errors.includes(settled.error)) errors.push(settled.error)
    }

    const seen = new Set<string>()
    const unique = rows.filter((r) => {
      const key = r.url ?? `${r.kind}:${r.title}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

    if (unique.length > 0) {
      return {
        rows: [
          ...unique,
          ...errors.map((e) => ({ kind: 'note' as const, title: e })),
          ...(pending ? [{ kind: 'note' as const, title: 'Asking GitHub…' }] : []),
        ],
        pending,
      }
    }
    if (pending) return { rows: [], pending, message: 'Asking GitHub…' }
    if (errors.length > 0) return { rows: [], pending, message: errors.join(' ') }
    if (q.kind === 'text' && !q.repo && !q.named && q.text.length < MIN_SEARCH) {
      return { rows: [], pending, message: 'Keep typing…' }
    }
    return {
      rows: [],
      pending,
      message:
        q.kind === 'text' && q.repo
          ? `Nothing in ${repoName(q.repo)} has a title or branch like that.`
          : 'GitHub has nothing like that.',
    }
  }
}

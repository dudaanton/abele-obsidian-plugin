/**
 * A repository's list of pull requests, issues or discussions for a query, a page at a time, as a
 * list tab shows it: how many there are open and closed, and the rows.
 *
 * Pull requests and issues come from GitHub's issue search, which takes the query as it is typed on
 * github.com and serves at most a thousand results; discussions from GraphQL's search, which needs
 * a token. The filters' choices — the labels, milestones and categories there are — are asked for
 * apart, once per tab.
 */
import { GithubError, type GithubClient } from '../client'
import { repoApiPath } from '../contents'
import { repoWeb } from '../origin'
import { discussionState, issueState, pullState } from '../itemState'
import type { GithubTarget } from '../urls'
import type { Label } from '../api'
import { searchQuery, sortOf, withState, type ListKind } from './listQuery'

type Of<K extends GithubTarget['kind']> = Extract<GithubTarget, { kind: K }>
type ListTarget = Of<'list'>

export interface ListItem {
  kind: 'pull' | 'issue' | 'discussion'
  number: number
  title: string
  /** `open`, `closed`, `merged`, `draft`; a discussion's `answered` too. */
  state: string
  author: string
  avatar?: string
  createdAt: string
  updatedAt: string
  comments: number
  labels: Label[]
  url: string
  /** A discussion's category. */
  category?: string
  milestone?: string
}

export interface ListPage {
  items: ListItem[]
  /** How many there are in all for the query. */
  total: number
  /** The page after this one — a number, or a GraphQL cursor — or null at the end. */
  next: number | string | null
}

export interface ListData extends ListPage {
  kind: ListKind
  query: string
  /** How many open and how many closed; null where GitHub was not asked or refused. */
  counts: { open: number | null; closed: number | null }
  /** GitHub's own address for the list. */
  url: string
}

export const PAGE_SIZE = 25
/** The search API's limit: past a thousand results it serves nothing. */
const SEARCH_CAP = 1000

const name = (t: ListTarget) => `${t.owner}/${t.repo}`
const what = (t: ListTarget) => `the ${t.list === 'pulls' ? 'pull requests' : t.list} of ${name(t)}`

/** GitHub's address of the list for this query. */
export const listUrl = (t: ListTarget, query = t.query): string =>
  `${repoWeb(t)}/${t.list}${query ? `?q=${encodeURIComponent(query)}` : ''}`

interface RawIssue {
  number: number
  title: string
  state: string
  state_reason?: string
  draft?: boolean
  user?: { login?: string; avatar_url?: string } | null
  created_at?: string
  updated_at?: string
  comments?: number
  labels?: ({ name?: string; color?: string } | string)[]
  html_url?: string
  pull_request?: { merged_at?: string | null } | null
  milestone?: { title?: string } | null
}

const labelsOf = (raw: RawIssue['labels']): Label[] =>
  (raw ?? [])
    .map((l) =>
      typeof l === 'string' ? { name: l, color: '' } : { name: l.name ?? '', color: l.color ?? '' }
    )
    .filter((l) => l.name)

export function issueItem(t: ListTarget, i: RawIssue): ListItem {
  const pull = !!i.pull_request
  const state = pull ? pullState({ ...i, merged_at: i.pull_request?.merged_at }) : issueState(i)
  return {
    kind: pull ? 'pull' : 'issue',
    number: i.number,
    title: i.title,
    state,
    author: i.user?.login ?? 'ghost',
    avatar: i.user?.avatar_url,
    createdAt: i.created_at ?? '',
    updatedAt: i.updated_at ?? '',
    comments: i.comments ?? 0,
    labels: labelsOf(i.labels),
    url: `${repoWeb(t)}/${pull ? 'pull' : 'issues'}/${i.number}`,
    milestone: i.milestone?.title || undefined,
  }
}

async function searchPage(
  client: GithubClient,
  t: ListTarget,
  query: string,
  page: number,
  perPage = PAGE_SIZE
): Promise<ListPage> {
  const { sort, order } = sortOf(query)
  const q = searchQuery(t.list, name(t), query)
  const found = await client.get<{ total_count?: number; items?: RawIssue[] }>(
    `/search/issues?q=${encodeURIComponent(q)}&sort=${sort}&order=${order}&per_page=${perPage}&page=${page}`,
    { what: what(t) }
  )
  const total = found.total_count ?? 0
  const items = (found.items ?? []).map((i) => issueItem(t, i))
  const more = page * perPage < Math.min(total, SEARCH_CAP) && items.length === perPage
  return { items, total, next: more ? page + 1 : null }
}

interface RawDiscussion {
  number?: number
  title?: string
  url?: string
  createdAt?: string
  updatedAt?: string
  closed?: boolean
  isAnswered?: boolean
  author?: { login?: string; avatarUrl?: string } | null
  category?: { name?: string } | null
  comments?: { totalCount?: number }
  labels?: { nodes?: ({ name?: string; color?: string } | null)[] } | null
}

const DISCUSSIONS = `query($q:String!,$n:Int!,$after:String){search(query:$q,type:DISCUSSION,first:$n,after:$after){discussionCount pageInfo{hasNextPage endCursor} nodes{... on Discussion{number title url createdAt updatedAt closed isAnswered author{login avatarUrl} category{name} comments{totalCount} labels(first:10){nodes{name color}}}}}}`

function discussionItem(t: ListTarget, d: RawDiscussion): ListItem {
  return {
    kind: 'discussion',
    number: d.number ?? 0,
    title: d.title ?? '',
    state: discussionState(d),
    author: d.author?.login ?? 'ghost',
    avatar: d.author?.avatarUrl,
    createdAt: d.createdAt ?? '',
    updatedAt: d.updatedAt ?? '',
    comments: d.comments?.totalCount ?? 0,
    labels: (d.labels?.nodes ?? [])
      .filter((l): l is { name: string; color?: string } => !!l?.name)
      .map((l) => ({ name: l.name, color: l.color ?? '' })),
    url: d.url ?? `${repoWeb(t)}/discussions/${d.number}`,
    category: d.category?.name ?? undefined,
  }
}

async function discussionPage(
  client: GithubClient,
  t: ListTarget,
  query: string,
  after: string | null,
  perPage = PAGE_SIZE
): Promise<ListPage> {
  const data = await client.graphql<{
    search?: {
      discussionCount?: number
      pageInfo?: { hasNextPage?: boolean; endCursor?: string | null }
      nodes?: (RawDiscussion | null)[]
    }
  }>(DISCUSSIONS, { q: `repo:${name(t)} ${query}`.trim(), n: perPage, after }, what(t))
  const s = data.search
  return {
    items: (s?.nodes ?? [])
      .filter((d): d is RawDiscussion => !!d?.number)
      .map((d) => discussionItem(t, d)),
    total: s?.discussionCount ?? 0,
    next: s?.pageInfo?.hasNextPage ? (s.pageInfo.endCursor ?? null) : null,
  }
}

/** The page after `next` of the list. */
export function loadMore(
  client: GithubClient,
  t: ListTarget,
  next: number | string
): Promise<ListPage> {
  return t.list === 'discussions'
    ? discussionPage(client, t, t.query, String(next))
    : searchPage(client, t, t.query, Number(next))
}

/** How many there are in a state, or null when GitHub would not say. */
async function countOf(client: GithubClient, t: ListTarget, state: 'open' | 'closed') {
  const query = withState(t.query, state)
  try {
    const page =
      t.list === 'discussions'
        ? await discussionPage(client, t, query, null, 1)
        : await searchPage(client, t, query, 1, 1)
    return page.total
  } catch (e) {
    if (e instanceof GithubError) return null
    throw e
  }
}

/** The first page of the list, with how many there are open and closed. */
export async function loadList(client: GithubClient, t: ListTarget): Promise<ListData> {
  const [first, open, closed] = await Promise.all([
    t.list === 'discussions'
      ? discussionPage(client, t, t.query, null)
      : searchPage(client, t, t.query, 1),
    countOf(client, t, 'open'),
    countOf(client, t, 'closed'),
  ])
  return { ...first, kind: t.list, query: t.query, counts: { open, closed }, url: listUrl(t) }
}

export interface ListChoices {
  labels: string[]
  milestones: string[]
  categories: string[]
}

/**
 * What the filters offer: the repository's labels and open milestones, and for discussions their
 * categories. A refusal of any leaves that filter to typing in the query.
 */
export async function loadChoices(client: GithubClient, t: ListTarget): Promise<ListChoices> {
  const quietly = <T>(p: Promise<T>, none: T) => p.catch(() => none)
  const [labels, milestones, categories] = await Promise.all([
    quietly(
      client.get<{ name: string }[]>(`${repoApiPath(t)}/labels?per_page=100`, { what: what(t) }),
      []
    ),
    t.list === 'discussions'
      ? Promise.resolve([])
      : quietly(
          client.get<{ title: string }[]>(`${repoApiPath(t)}/milestones?state=open&per_page=100`, {
            what: what(t),
          }),
          []
        ),
    t.list === 'discussions' && client.hasToken
      ? quietly(
          client
            .graphql<{
              repository?: { discussionCategories?: { nodes?: ({ name?: string } | null)[] } }
            }>(
              'query($owner:String!,$repo:String!){repository(owner:$owner,name:$repo){discussionCategories(first:50){nodes{name}}}}',
              { owner: t.owner, repo: t.repo },
              what(t)
            )
            .then((d) =>
              (d.repository?.discussionCategories?.nodes ?? [])
                .map((c) => c?.name ?? '')
                .filter(Boolean)
            ),
          [] as string[]
        )
      : Promise.resolve([]),
  ])
  return {
    labels: labels.map((l) => l.name),
    milestones: milestones.map((m) => m.title),
    categories,
  }
}

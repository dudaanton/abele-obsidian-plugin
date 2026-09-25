/**
 * The secondary sections of an issue or pull request, read through GraphQL.
 *
 * REST can refuse one endpoint to a fine-grained token that reads the same data through GraphQL
 * without complaint — an Enterprise server has been seen refusing a pull request's comments on
 * `/issues/N/comments` to a token holding both permissions that endpoint accepts, while `gh`,
 * which speaks GraphQL, read them. So a refused section is asked again here, and the answer is
 * put in the shape the REST answer would have had.
 *
 * The mapping functions take GraphQL's JSON and nothing else, so tests build them from fixtures.
 */
import type { GithubClient } from './client'
import { GithubError } from './client'
import type { Comment, CommitSummary } from './api'

// `any` below is the API's own JSON, read once here and never passed on.

export interface Listed<T> {
  items: T[]
  complete: boolean
}

/** A review comment and the file it is about. */
export interface PathComment {
  path: string
  comment: Comment
}

/** A changed file in REST's field names, without the diff GraphQL does not carry. */
export interface RawFile {
  filename: string
  status: string
  additions: number
  deletions: number
}

export const login = (user: any): string => user?.login ?? 'ghost'

/** A person's picture, from REST's `avatar_url` or GraphQL's `avatarUrl`. */
export const avatarOf = (user: any): string | undefined =>
  user?.avatar_url || user?.avatarUrl || undefined

export const REVIEW_STATES: Record<string, string> = {
  APPROVED: 'Approved',
  CHANGES_REQUESTED: 'Changes requested',
  COMMENTED: 'Reviewed',
  DISMISSED: 'Dismissed',
}

/**
 * Whether a review belongs on the timeline. One with nothing to say and no verdict is the wrapper
 * of inline comments, which show on the files they are about; a pending one is not submitted.
 */
export const reviewShown = (state: string | undefined, body: string | undefined): boolean =>
  state !== 'PENDING' && (!!body || (!!state && state !== 'COMMENTED'))

/** "line 4", "old line 4", "line 9 (outdated)" — where on the diff a review comment sits. */
export function reviewLocation(
  side: string | undefined,
  line: number | null | undefined,
  originalLine: number | null | undefined
): string | undefined {
  if (!line && !originalLine) return undefined
  return `${side === 'LEFT' ? 'old ' : ''}line ${line ?? originalLine}${line ? '' : ' (outdated)'}`
}

const complete = (connection: any): boolean =>
  (connection?.totalCount ?? 0) <= (connection?.nodes?.length ?? 0)

const id = (node: any): string => String(node?.databaseId ?? node?.id ?? '')

export function commentsFromGraphql(connection: any): Listed<Comment> {
  const items = (connection?.nodes ?? []).map(
    (c: any): Comment => ({
      id: id(c),
      author: login(c.author),
      avatar: avatarOf(c.author),
      body: c.body ?? '',
      createdAt: c.createdAt ?? '',
      anchor: c.databaseId ? `issuecomment-${c.databaseId}` : undefined,
      url: c.url,
    })
  )
  return { items, complete: complete(connection) }
}

export function reviewsFromGraphql(connection: any): Listed<Comment> {
  const items = (connection?.nodes ?? [])
    .filter((r: any) => reviewShown(r.state, r.body))
    .map(
      (r: any): Comment => ({
        id: `review-${id(r)}`,
        author: login(r.author),
        avatar: avatarOf(r.author),
        body: r.body ?? '',
        createdAt: r.submittedAt ?? r.createdAt ?? '',
        anchor: r.databaseId ? `pullrequestreview-${r.databaseId}` : undefined,
        badge: REVIEW_STATES[r.state] ?? undefined,
        url: r.url,
      })
    )
  return { items, complete: complete(connection) }
}

export function reviewCommentsFromGraphql(connection: any): Listed<PathComment> {
  const items = (connection?.nodes ?? []).flatMap((thread: any) =>
    (thread.comments?.nodes ?? []).map(
      (c: any): PathComment => ({
        path: c.path ?? thread.path,
        comment: {
          id: `rc-${id(c)}`,
          author: login(c.author),
          avatar: avatarOf(c.author),
          body: c.body ?? '',
          createdAt: c.createdAt ?? '',
          anchor: c.databaseId ? `discussion_r${c.databaseId}` : undefined,
          location: reviewLocation(
            thread.diffSide,
            c.line ?? null,
            c.originalLine ?? thread.originalLine
          ),
          url: c.url,
        },
      })
    )
  )
  return { items, complete: complete(connection) }
}

export function commitsFromGraphql(connection: any): CommitSummary[] {
  return (connection?.nodes ?? []).map((n: any) => ({
    sha: n.commit?.oid ?? '',
    message: n.commit?.message ?? '',
    author: n.commit?.author?.user?.login ?? n.commit?.author?.name ?? 'unknown',
    login: n.commit?.author?.user?.login || undefined,
    avatar: avatarOf(n.commit?.author?.user) ?? avatarOf(n.commit?.author),
    date: n.commit?.author?.date ?? '',
  }))
}

/** GraphQL's `changeType` in REST's `status` words. */
const CHANGE_TYPES: Record<string, string> = {
  ADDED: 'added',
  DELETED: 'removed',
  MODIFIED: 'modified',
  RENAMED: 'renamed',
  COPIED: 'copied',
  CHANGED: 'changed',
}

export function filesFromGraphql(connection: any): { files: RawFile[]; complete: boolean } {
  const files = (connection?.nodes ?? []).map((f: any) => ({
    filename: f.path,
    status: CHANGE_TYPES[f.changeType] ?? String(f.changeType ?? '').toLowerCase(),
    additions: f.additions ?? 0,
    deletions: f.deletions ?? 0,
  }))
  return { files, complete: complete(connection) }
}

interface Item {
  owner: string
  repo: string
  number: number
}

/** Asks for one field of an issue or pull request and hands back that field's value. */
async function ask(
  client: GithubClient,
  t: Item,
  item: 'issue' | 'pullRequest',
  selection: string,
  what: string
): Promise<any> {
  const query = `
query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    ${item}(number: $number) {
      ${selection}
    }
  }
}`
  const data = await client.graphql<any>(
    query,
    { owner: t.owner, repo: t.repo, number: t.number },
    what
  )
  const node = data?.repository?.[item]
  if (!node) throw new GithubError('not-found', `GitHub's GraphQL API found nothing for ${what}.`)
  return node
}

const AUTHOR = 'author { login avatarUrl }'

export async function graphqlComments(
  client: GithubClient,
  t: Item,
  item: 'issue' | 'pullRequest',
  what: string
): Promise<Listed<Comment>> {
  const node = await ask(
    client,
    t,
    item,
    `comments(first: 100) { totalCount nodes { id databaseId body createdAt url ${AUTHOR} } }`,
    what
  )
  return commentsFromGraphql(node.comments)
}

export async function graphqlReviews(client: GithubClient, t: Item): Promise<Listed<Comment>> {
  const node = await ask(
    client,
    t,
    'pullRequest',
    `reviews(first: 100) { totalCount nodes { id databaseId state body submittedAt createdAt url ${AUTHOR} } }`,
    "the pull request's reviews"
  )
  return reviewsFromGraphql(node.reviews)
}

export async function graphqlReviewComments(
  client: GithubClient,
  t: Item
): Promise<Listed<PathComment>> {
  const node = await ask(
    client,
    t,
    'pullRequest',
    `reviewThreads(first: 100) { totalCount nodes { path diffSide line originalLine
      comments(first: 50) { nodes { id databaseId body createdAt url path line originalLine ${AUTHOR} } } } }`,
    "the pull request's review comments"
  )
  return reviewCommentsFromGraphql(node.reviewThreads)
}

export async function graphqlCommits(client: GithubClient, t: Item): Promise<CommitSummary[]> {
  const node = await ask(
    client,
    t,
    'pullRequest',
    'commits(first: 100) { totalCount nodes { commit { oid message author { name date avatarUrl user { login avatarUrl } } } } }',
    "the pull request's commits"
  )
  return commitsFromGraphql(node.commits)
}

export async function graphqlFiles(
  client: GithubClient,
  t: Item
): Promise<{ files: RawFile[]; complete: boolean }> {
  const node = await ask(
    client,
    t,
    'pullRequest',
    'files(first: 100) { totalCount nodes { path additions deletions changeType } }',
    "the pull request's changed files"
  )
  return filesFromGraphql(node.files)
}

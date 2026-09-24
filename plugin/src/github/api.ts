/**
 * What the GitHub views show, fetched and put in one shape.
 *
 * The raw API objects are large and differ between REST and GraphQL; the views get these plain
 * records instead, which also makes them easy to build from fixtures in tests.
 */
import { GithubClient, GithubError } from './client'
import { blobCandidates, diffAnchorHash, type GithubTarget } from './urls'
import {
  graphqlComments,
  graphqlCommits,
  graphqlFiles,
  graphqlReviewComments,
  graphqlReviews,
  login,
  REVIEW_STATES,
  reviewLocation,
  reviewShown,
  type Listed,
  type PathComment,
  type RawFile,
} from './graphql'
import { problems, secondary, withFallback } from './sections'

type Of<K extends GithubTarget['kind']> = Extract<GithubTarget, { kind: K }>

export interface Label {
  name: string
  color: string
}

export interface Comment {
  id: string
  author: string
  body: string
  createdAt: string
  /** The `#…` a link uses for this comment, to scroll to it. */
  anchor?: string
  /** A review's verdict, or "Answer" on a discussion. */
  badge?: string
  /** Where in the code a review comment sits. */
  location?: string
  replies?: Comment[]
  /** More replies exist than were fetched. */
  moreReplies?: number
  url?: string
}

export interface ItemHead {
  title: string
  number: number
  url: string
  author: string
  createdAt: string
  /** `open`, `closed`, `merged`, `draft`, `answered`. */
  state: string
  labels: Label[]
  body: string
}

export interface IssueData extends ItemHead {
  /**
   * The number is a pull request's. GitHub numbers issues and pull requests from one sequence
   * and redirects `issues/N` to `pull/N`, so a link can name either.
   */
  isPull?: boolean
  comments: Comment[]
  /** Not every comment could be fetched; the rest are on GitHub. */
  commentsComplete: boolean
  /** Why some of the comments could not be read at all, shown in their place. */
  commentsProblem?: string
}

/** The comments of an issue or pull request, read apart from it so they can be asked again. */
export interface Conversation {
  comments: Comment[]
  complete: boolean
  problem?: string
}

export interface PullData extends IssueData {
  base: string
  head: string
  /** The commit the pull request's branch is at: what its code is searched and linked at. */
  headSha?: string
  /** The commit of the base branch it is compared with: where a file it deletes still exists. */
  baseSha?: string
  additions: number
  deletions: number
  changedFiles: number
  commitsCount: number
}

export interface DiffFile {
  path: string
  previousPath?: string
  status: string
  additions: number
  deletions: number
  /** Absent for binary files and for a file whose diff GitHub will not send whole. */
  patch?: string
  /** SHA-256 of the path, as in `#diff-<hash>`. */
  hash: string
  blobUrl?: string
  reviewComments: Comment[]
  /** Why there is no diff, when it is not the file's doing. */
  diffNote?: string
}

export interface FilesData {
  files: DiffFile[]
  complete: boolean
  /** Why the review comments could not be read; the files are shown without them. */
  reviewCommentsProblem?: string
}

export interface CommitSummary {
  sha: string
  message: string
  author: string
  date: string
}

export interface CommitData {
  sha: string
  /** The first parent: where a file the commit deletes still exists. */
  parentSha?: string
  message: string
  author: string
  date: string
  url: string
  files: DiffFile[]
}

export interface DiscussionData extends ItemHead {
  category: string
  comments: Comment[]
  totalComments: number
}

export interface BlobData {
  ref: string
  path: string
  text: string
  url: string
}

// `any` below is the API's own JSON, read once here and never passed on.

type RepoLike = { owner: string; repo: string }

const repoPath = (t: RepoLike) =>
  `/repos/${encodeURIComponent(t.owner)}/${encodeURIComponent(t.repo)}`

const labels = (raw: any[] | undefined): Label[] =>
  (raw ?? [])
    .map((l: any) => (typeof l === 'string' ? { name: l, color: '' } : l))
    .map((l) => ({
      name: l.name,
      color: l.color ?? '',
    }))

const issueComment = (c: any): Comment => ({
  id: String(c.id),
  author: login(c.user),
  body: c.body ?? '',
  createdAt: c.created_at,
  anchor: `issuecomment-${c.id}`,
  url: c.html_url,
})

const EMPTY: Listed<Comment> = { items: [], complete: true }

/** An item's conversation comments: `/issues/N/comments`, for an issue and a pull request alike. */
const conversationComments = (client: GithubClient, t: Of<'issue'> | Of<'pull'>, what: string) =>
  secondary(
    client,
    EMPTY,
    async () => {
      const { items, complete } = await client.list<any>(
        `${repoPath(t)}/issues/${t.number}/comments`,
        { what }
      )
      return { items: items.map(issueComment), complete }
    },
    () => graphqlComments(client, t, t.kind === 'pull' ? 'pullRequest' : 'issue', what)
  )

/**
 * An issue's comments. They are only ever shown under the issue, read with the same token, so a
 * refusal of them is said as a refusal of this one request, not of the token (see `problemText`).
 */
export async function loadIssueConversation(
  client: GithubClient,
  t: Of<'issue'>
): Promise<Conversation> {
  const comments = await conversationComments(client, t, "the issue's comments")
  return {
    comments: comments.value.items,
    complete: comments.value.complete,
    problem: problems([comments.error], 'Issues'),
  }
}

export async function loadPullConversation(
  client: GithubClient,
  t: Of<'pull'>
): Promise<Conversation> {
  const [comments, reviews] = await Promise.all([
    conversationComments(client, t, "the pull request's comments"),
    secondary(
      client,
      EMPTY,
      async () => {
        const { items, complete } = await client.list<any>(
          `${repoPath(t)}/pulls/${t.number}/reviews`,
          { what: "the pull request's reviews" }
        )
        return {
          items: items.filter((r: any) => reviewShown(r.state, r.body)).map(review),
          complete,
        }
      },
      () => graphqlReviews(client, t)
    ),
  ])
  return {
    comments: [...comments.value.items, ...reviews.value.items].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt)
    ),
    complete: comments.value.complete && reviews.value.complete,
    problem: problems([comments.error, reviews.error], 'Pull requests'),
  }
}

const review = (r: any): Comment => ({
  id: `review-${r.id}`,
  author: login(r.user),
  body: r.body ?? '',
  createdAt: r.submitted_at,
  anchor: `pullrequestreview-${r.id}`,
  badge: REVIEW_STATES[r.state] ?? undefined,
  url: r.html_url,
})

/** The issue itself decides whether there is a tab; its comments only whether they are shown. */
export async function loadIssue(client: GithubClient, t: Of<'issue'>): Promise<IssueData> {
  const [issue, conversation] = await Promise.all([
    client.get<any>(`${repoPath(t)}/issues/${t.number}`, { what: 'the issue' }),
    loadIssueConversation(client, t),
  ])
  return {
    title: issue.title,
    number: issue.number,
    url: issue.html_url,
    author: login(issue.user),
    createdAt: issue.created_at,
    state: issue.state_reason === 'not_planned' ? 'not planned' : issue.state,
    labels: labels(issue.labels),
    body: issue.body ?? '',
    comments: conversation.comments,
    commentsComplete: conversation.complete,
    commentsProblem: conversation.problem,
    isPull: !!issue.pull_request,
  }
}

/** The pull request itself decides whether there is a tab; each of its sections only itself. */
export async function loadPull(client: GithubClient, t: Of<'pull'>): Promise<PullData> {
  const [pull, conversation] = await Promise.all([
    client.get<any>(`${repoPath(t)}/pulls/${t.number}`, { what: 'the pull request' }),
    loadPullConversation(client, t),
  ])

  return {
    title: pull.title,
    number: pull.number,
    url: pull.html_url,
    author: login(pull.user),
    createdAt: pull.created_at,
    state: pull.merged_at ? 'merged' : pull.draft && pull.state === 'open' ? 'draft' : pull.state,
    labels: labels(pull.labels),
    body: pull.body ?? '',
    comments: conversation.comments,
    commentsComplete: conversation.complete,
    commentsProblem: conversation.problem,
    base: pull.base?.ref ?? '',
    head: pull.head?.label ?? pull.head?.ref ?? '',
    headSha: pull.head?.sha,
    baseSha: pull.base?.sha,
    additions: pull.additions ?? 0,
    deletions: pull.deletions ?? 0,
    changedFiles: pull.changed_files ?? 0,
    commitsCount: pull.commits ?? 0,
  }
}

async function diffFiles(
  raw: any[],
  reviewComments: PathComment[] = [],
  diffNote?: string
): Promise<DiffFile[]> {
  return Promise.all(
    raw.map(async (f: any) => ({
      path: f.filename,
      previousPath: f.previous_filename,
      status: f.status,
      additions: f.additions ?? 0,
      deletions: f.deletions ?? 0,
      patch: f.patch,
      hash: await diffAnchorHash(f.filename),
      blobUrl: f.blob_url,
      reviewComments: reviewComments.filter((c) => c.path === f.filename).map((c) => c.comment),
      diffNote,
    }))
  )
}

const restReviewComment = (c: any): PathComment => ({
  path: c.path,
  comment: {
    id: `rc-${c.id}`,
    author: login(c.user),
    body: c.body ?? '',
    createdAt: c.created_at,
    anchor: `discussion_r${c.id}`,
    location: reviewLocation(c.side, c.line, c.original_line),
    url: c.html_url,
  },
})

const NO_DIFFS =
  'GitHub refused the diffs to this token. The list of files came through its GraphQL API, which does not carry diffs; open the pull request on GitHub to read them.'

/**
 * The changed files, and their review comments beside them. The files are this section's own
 * item — refused both ways, the section says so — while refused review comments leave the
 * files shown without them.
 */
export async function loadPullFiles(client: GithubClient, t: Of<'pull'>): Promise<FilesData> {
  const base = `${repoPath(t)}/pulls/${t.number}`
  const [files, reviewComments] = await Promise.all([
    withFallback<{ files: RawFile[]; complete: boolean; diffNote?: string }>(
      client,
      async () => {
        const { items, complete } = await client.list<any>(`${base}/files`, {
          what: "the pull request's changed files",
        })
        return { files: items, complete }
      },
      async () => ({ ...(await graphqlFiles(client, t)), diffNote: NO_DIFFS })
    ),
    secondary<Listed<PathComment>>(
      client,
      { items: [], complete: true },
      async () => {
        const { items, complete } = await client.list<any>(`${base}/comments`, {
          what: "the pull request's review comments",
        })
        return { items: items.map(restReviewComment), complete }
      },
      () => graphqlReviewComments(client, t)
    ),
  ])
  return {
    files: await diffFiles(files.files, reviewComments.value.items, files.diffNote),
    complete: files.complete,
    reviewCommentsProblem: problems([reviewComments.error], 'Pull requests'),
  }
}

export async function loadPullCommits(
  client: GithubClient,
  t: Of<'pull'>
): Promise<CommitSummary[]> {
  return withFallback(
    client,
    async () => {
      const { items } = await client.list<any>(`${repoPath(t)}/pulls/${t.number}/commits`, {
        what: "the pull request's commits",
      })
      return items.map((c: any) => ({
        sha: c.sha,
        message: c.commit?.message ?? '',
        author: c.author?.login ?? c.commit?.author?.name ?? 'unknown',
        date: c.commit?.author?.date ?? '',
      }))
    },
    () => graphqlCommits(client, t)
  )
}

export async function loadCommit(client: GithubClient, t: Of<'commit'>): Promise<CommitData> {
  const c = await client.get<any>(`${repoPath(t)}/commits/${encodeURIComponent(t.sha)}`, {
    what: 'the commit',
  })
  return {
    sha: c.sha,
    parentSha: c.parents?.[0]?.sha,
    message: c.commit?.message ?? '',
    author: c.author?.login ?? c.commit?.author?.name ?? 'unknown',
    date: c.commit?.author?.date ?? '',
    url: c.html_url,
    files: await diffFiles(c.files ?? []),
  }
}

const DISCUSSION_QUERY = `
query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    discussion(number: $number) {
      title number url body createdAt closed isAnswered
      author { login }
      category { name }
      labels(first: 20) { nodes { name color } }
      comments(first: 100) {
        totalCount
        nodes {
          id databaseId body createdAt isAnswer url
          author { login }
          replies(first: 50) {
            totalCount
            nodes { id databaseId body createdAt url author { login } }
          }
        }
      }
    }
  }
}`

export async function loadDiscussion(
  client: GithubClient,
  t: Of<'discussion'>
): Promise<DiscussionData> {
  const data = await client.graphql<any>(
    DISCUSSION_QUERY,
    { owner: t.owner, repo: t.repo, number: t.number },
    'the discussion'
  )
  const d = data.repository?.discussion
  if (!d) throw new GithubError('not-found', 'GitHub has no such discussion in this repository.')

  const reply = (r: any): Comment => ({
    id: r.id,
    author: login(r.author),
    body: r.body ?? '',
    createdAt: r.createdAt,
    anchor: r.databaseId ? `discussioncomment-${r.databaseId}` : undefined,
    url: r.url,
  })

  const comments: Comment[] = (d.comments?.nodes ?? []).map((c: any) => ({
    ...reply(c),
    badge: c.isAnswer ? 'Answer' : undefined,
    replies: (c.replies?.nodes ?? []).map(reply),
    moreReplies: Math.max(0, (c.replies?.totalCount ?? 0) - (c.replies?.nodes?.length ?? 0)),
  }))

  return {
    title: d.title,
    number: d.number,
    url: d.url,
    author: login(d.author),
    createdAt: d.createdAt,
    state: d.isAnswered ? 'answered' : d.closed ? 'closed' : 'open',
    labels: labels(d.labels?.nodes),
    body: d.body ?? '',
    category: d.category?.name ?? '',
    comments,
    totalComments: d.comments?.totalCount ?? comments.length,
  }
}

/**
 * A file at a ref. The address does not say where the ref ends and the path begins, so each split
 * is asked in turn, the shortest ref first — branch names are usually one segment — and the first
 * one GitHub has an answer for wins.
 */
/**
 * The full SHA of the commit a branch, tag or short SHA points at now, for a link that must not
 * move when the branch does. A full SHA is its own answer and costs no request.
 */
export async function commitSha(
  client: GithubClient,
  repo: RepoLike,
  ref: string
): Promise<string> {
  if (/^[0-9a-f]{40}$/i.test(ref)) return ref.toLowerCase()
  const sha = await client.get<string>(`${repoPath(repo)}/commits/${encodeURIComponent(ref)}`, {
    accept: 'application/vnd.github.sha',
    text: true,
    what: 'the commit the file was read at',
  })
  return sha.trim()
}

const isFolderListing = (text: string): boolean => {
  if (!text.trimStart().startsWith('[')) return false
  try {
    const parsed: unknown = JSON.parse(text)
    return (
      Array.isArray(parsed) &&
      parsed.every((e) => typeof e === 'object' && e !== null && 'type' in e && '_links' in e)
    )
  } catch {
    return false
  }
}

export async function loadBlob(client: GithubClient, t: Of<'blob'>): Promise<BlobData> {
  let lastError: unknown = null
  // Capped: a deep path with no match would otherwise cost one request per segment.
  for (const { ref, path } of blobCandidates(t.rest).slice(0, 6)) {
    const encodedPath = path.split('/').map(encodeURIComponent).join('/')
    try {
      const text = await client.get<string>(
        `${repoPath(t)}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`,
        { accept: 'application/vnd.github.raw+json', text: true, what: 'the file' }
      )
      // A folder answers with its listing — a README's link to `packages/core` is one.
      if (isFolderListing(text)) {
        throw new GithubError(
          'other',
          `${path} is a folder; a tab here shows files. Open it on GitHub.`
        )
      }
      return {
        ref,
        path,
        text,
        url: `https://${t.host}/${t.owner}/${t.repo}/blob/${t.rest.join('/')}`,
      }
    } catch (e) {
      // Only "no such ref or path" means try the next split; anything else is the answer.
      if (!(e instanceof GithubError) || e.kind !== 'not-found') throw e
      lastError = e
    }
  }
  throw lastError ?? new GithubError('not-found', 'GitHub has no such file.')
}

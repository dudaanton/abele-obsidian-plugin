/**
 * What the GitHub views show, fetched and put in one shape.
 *
 * The raw API objects are large and differ between REST and GraphQL; the views get these plain
 * records instead, which also makes them easy to build from fixtures in tests.
 */
import { GithubClient, GithubError } from './client'
import { blobCandidates, diffAnchorHash, type GithubTarget } from './urls'

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
}

export interface PullData extends IssueData {
  base: string
  head: string
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
}

export interface FilesData {
  files: DiffFile[]
  complete: boolean
}

export interface CommitSummary {
  sha: string
  message: string
  author: string
  date: string
}

export interface CommitData {
  sha: string
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

const login = (user: any): string => user?.login ?? 'ghost'

const repoPath = (t: { owner: string; repo: string }) =>
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

const REVIEW_STATES: Record<string, string> = {
  APPROVED: 'Approved',
  CHANGES_REQUESTED: 'Changes requested',
  COMMENTED: 'Reviewed',
  DISMISSED: 'Dismissed',
}

export async function loadIssue(client: GithubClient, t: Of<'issue'>): Promise<IssueData> {
  const base = `${repoPath(t)}/issues/${t.number}`
  const [issue, comments] = await Promise.all([
    client.get<any>(base, { what: 'issues in this repository' }),
    client.list<any>(`${base}/comments`, { what: 'issue comments' }),
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
    comments: comments.items.map(issueComment),
    commentsComplete: comments.complete,
    isPull: !!issue.pull_request,
  }
}

export async function loadPull(client: GithubClient, t: Of<'pull'>): Promise<PullData> {
  const base = `${repoPath(t)}/pulls/${t.number}`
  const [pull, comments, reviews] = await Promise.all([
    client.get<any>(base, { what: 'pull requests in this repository' }),
    client.list<any>(`${repoPath(t)}/issues/${t.number}/comments`, { what: 'comments' }),
    client.list<any>(`${base}/reviews`, { what: 'pull request reviews' }),
  ])

  // A review with nothing to say and no verdict is the wrapper of inline comments, which show
  // on the files they are about.
  const reviewItems: Comment[] = reviews.items
    .filter((r: any) => r.body || (r.state && r.state !== 'COMMENTED' && r.state !== 'PENDING'))
    .map((r: any) => ({
      id: `review-${r.id}`,
      author: login(r.user),
      body: r.body ?? '',
      createdAt: r.submitted_at,
      anchor: `pullrequestreview-${r.id}`,
      badge: REVIEW_STATES[r.state] ?? undefined,
      url: r.html_url,
    }))

  const timeline = [...comments.items.map(issueComment), ...reviewItems].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt)
  )

  return {
    title: pull.title,
    number: pull.number,
    url: pull.html_url,
    author: login(pull.user),
    createdAt: pull.created_at,
    state: pull.merged_at ? 'merged' : pull.draft && pull.state === 'open' ? 'draft' : pull.state,
    labels: labels(pull.labels),
    body: pull.body ?? '',
    comments: timeline,
    commentsComplete: comments.complete && reviews.complete,
    base: pull.base?.ref ?? '',
    head: pull.head?.label ?? pull.head?.ref ?? '',
    additions: pull.additions ?? 0,
    deletions: pull.deletions ?? 0,
    changedFiles: pull.changed_files ?? 0,
    commitsCount: pull.commits ?? 0,
  }
}

async function diffFiles(raw: any[], reviewComments: any[] = []): Promise<DiffFile[]> {
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
      reviewComments: reviewComments
        .filter((c: any) => c.path === f.filename)
        .map((c: any) => ({
          id: `rc-${c.id}`,
          author: login(c.user),
          body: c.body ?? '',
          createdAt: c.created_at,
          anchor: `discussion_r${c.id}`,
          location:
            c.line || c.original_line
              ? `${c.side === 'LEFT' ? 'old ' : ''}line ${c.line ?? c.original_line}${c.line ? '' : ' (outdated)'}`
              : undefined,
          url: c.html_url,
        })),
    }))
  )
}

export async function loadPullFiles(client: GithubClient, t: Of<'pull'>): Promise<FilesData> {
  const base = `${repoPath(t)}/pulls/${t.number}`
  const [files, reviewComments] = await Promise.all([
    client.list<any>(`${base}/files`, { what: 'the changed files' }),
    client.list<any>(`${base}/comments`, { what: 'review comments' }),
  ])
  return {
    files: await diffFiles(files.items, reviewComments.items),
    complete: files.complete,
  }
}

export async function loadPullCommits(
  client: GithubClient,
  t: Of<'pull'>
): Promise<CommitSummary[]> {
  const { items } = await client.list<any>(`${repoPath(t)}/pulls/${t.number}/commits`, {
    what: 'the commits',
  })
  return items.map((c: any) => ({
    sha: c.sha,
    message: c.commit?.message ?? '',
    author: c.author?.login ?? c.commit?.author?.name ?? 'unknown',
    date: c.commit?.author?.date ?? '',
  }))
}

export async function loadCommit(client: GithubClient, t: Of<'commit'>): Promise<CommitData> {
  const c = await client.get<any>(`${repoPath(t)}/commits/${encodeURIComponent(t.sha)}`, {
    what: 'the contents of this repository',
  })
  return {
    sha: c.sha,
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
    'discussions in this repository'
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
export async function loadBlob(client: GithubClient, t: Of<'blob'>): Promise<BlobData> {
  let lastError: unknown = null
  // Capped: a deep path with no match would otherwise cost one request per segment.
  for (const { ref, path } of blobCandidates(t.rest).slice(0, 6)) {
    const encodedPath = path.split('/').map(encodeURIComponent).join('/')
    try {
      const text = await client.get<string>(
        `${repoPath(t)}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`,
        { accept: 'application/vnd.github.raw+json', text: true, what: 'the contents' }
      )
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

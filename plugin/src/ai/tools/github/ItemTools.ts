/**
 * `github_read` and `github_pr_files`: an issue, pull request or discussion with its
 * conversation a page at a time, and a pull request's changed files — the list first, then one
 * file's diff a window at a time.
 */
import type { AgentTool } from '../../client'
import {
  loadDiscussion,
  loadIssue,
  loadPull,
  loadPullFiles,
  type Comment,
  type DiscussionData,
  type IssueData,
  type PullData,
} from '@/github/api'
import { GithubError } from '@/github/client'
import {
  answer,
  clientFor,
  clip,
  day,
  DEFAULT_LINES,
  fileRows,
  findFile,
  parseNamed,
  patchWindow,
  repoName,
  text,
  whole,
  type Named,
  type RepoRef,
} from './shared'

const COMMENTS_PER_PAGE = 20
const BODY_MAX = 12_000
const COMMENT_MAX = 3_000
const FILES_PER_PAGE = 200

/** An item's number, from `owner/repo#12` or a link to an issue, pull request or discussion. */
function itemOf(named: Named): { repo: RepoRef; number: number; kind?: string } {
  const t = named.target
  if (t && t.kind !== 'issue' && t.kind !== 'pull' && t.kind !== 'discussion') {
    const tool = t.kind === 'commit' ? 'github_commits' : 'github_file'
    throw new Error(`That link is a ${t.kind === 'blob' ? 'file' : t.kind}; read it with ${tool}.`)
  }
  if (!named.number) {
    throw new Error('Name one item: a link to it, or owner/repo#12.')
  }
  return { repo: named.repo, number: named.number, kind: t?.kind }
}

function commentBlock(c: Comment, indent = ''): string[] {
  const what = c.badge ? `${c.badge} · ` : ''
  const where = c.location ? ` · ${c.location}` : ''
  const head = `${indent}### ${what}${c.author} · ${day(c.createdAt)}${where}${c.url ? ` · ${c.url}` : ''}`
  const body = clip(c.body.trim() || '(no text)', COMMENT_MAX)
  const out = [head, ...body.split('\n').map((l) => `${indent}${l}`)]
  for (const r of c.replies ?? []) out.push('', ...commentBlock(r, `${indent}  `))
  if (c.moreReplies) out.push(`${indent}  (${c.moreReplies} more replies on GitHub)`)
  return out
}

type Read = { kind: 'issue' | 'pull' | 'discussion'; data: IssueData | PullData | DiscussionData }

async function load(repo: RepoRef, number: number, kind?: string): Promise<Read> {
  const client = clientFor(repo)
  const t = { host: repo.host, owner: repo.owner, repo: repo.repo, number }
  if (kind === 'discussion') {
    return { kind, data: await loadDiscussion(client, { ...t, kind: 'discussion' }) }
  }
  if (kind === 'pull') {
    return { kind, data: await loadPull(client, { ...t, kind: 'pull', tab: 'conversation' }) }
  }
  try {
    const issue = await loadIssue(client, { ...t, kind: 'issue' })
    if (!issue.isPull) return { kind: 'issue', data: issue }
    return {
      kind: 'pull',
      data: await loadPull(client, { ...t, kind: 'pull', tab: 'conversation' }),
    }
  } catch (e) {
    // `owner/repo#3` may be a discussion: they are numbered with issues and pull requests.
    if (kind || !(e instanceof GithubError) || e.kind !== 'not-found' || !client.hasToken) throw e
    return { kind: 'discussion', data: await loadDiscussion(client, { ...t, kind: 'discussion' }) }
  }
}

const KIND_NAME = { issue: 'Issue', pull: 'Pull request', discussion: 'Discussion' }

export function formatItem(repo: RepoRef, read: Read, page: number): string {
  const d = read.data
  const facts = [`State: ${d.state}`, `by ${d.author}`, `opened ${day(d.createdAt)}`]
  if (read.kind === 'pull') {
    const p = d as PullData
    facts.push(
      `${p.head} → ${p.base}`,
      `+${p.additions} −${p.deletions}`,
      `${p.changedFiles} files`,
      `${p.commitsCount} commit${p.commitsCount === 1 ? '' : 's'}`
    )
  }
  if (read.kind === 'discussion') facts.push(`category ${(d as DiscussionData).category}`)

  const out = [
    `${KIND_NAME[read.kind]} ${repoName(repo)}#${d.number} — ${d.title}`,
    facts.join(' · '),
  ]
  if (d.labels.length) out.push(`Labels: ${d.labels.map((l) => l.name).join(', ')}`)
  out.push(`URL: ${d.url}`, '')

  if (page === 1)
    out.push('## Description', clip(d.body.trim() || '(no description)', BODY_MAX), '')

  const comments = d.comments
  const first = (page - 1) * COMMENTS_PER_PAGE
  const shown = comments.slice(first, first + COMMENTS_PER_PAGE)
  const what = read.kind === 'pull' ? 'comments and reviews' : 'comments'
  if (comments.length === 0) {
    out.push(`## Conversation — no ${what}`)
  } else if (shown.length === 0) {
    out.push(
      `## Conversation — page ${page} is past the end: there are ${comments.length} ${what}.`
    )
  } else {
    out.push(
      `## Conversation — ${what} ${first + 1}–${first + shown.length} of ${comments.length}`,
      ''
    )
    for (const c of shown) out.push(...commentBlock(c), '')
    if (first + shown.length < comments.length) {
      out.push(`[More: call again with page=${page + 1}.]`)
    }
  }

  const issue = d as IssueData
  if (issue.commentsProblem)
    out.push('', `Some of the conversation could not be read: ${issue.commentsProblem}`)
  if (issue.commentsComplete === false)
    out.push('', 'GitHub listed only part of the conversation; the rest is on GitHub.')
  const missing =
    read.kind === 'discussion' ? (d as DiscussionData).totalComments - comments.length : 0
  if (missing > 0) out.push('', `${missing} more comments are on GitHub.`)
  if (read.kind === 'pull') {
    out.push(
      '',
      'The changed files and review comments on code: github_pr_files. Commits: github_commits.'
    )
  }
  return out.join('\n')
}

export function createGithubReadTool(): AgentTool {
  return {
    name: 'github_read',
    label: 'Read GitHub item',
    description:
      'Read a GitHub issue, pull request or discussion: title, state, description and its conversation (comments, reviews, discussion replies), 20 comments a page. ' +
      'Give a link or owner/repo#12. Page 1 has the description; ask page=2 and on for later comments. ' +
      "For a pull request's code use github_pr_files; for commits github_commits. Read-only.",
    parameters: {
      type: 'object',
      properties: {
        item: { type: 'string', description: 'A link to the item, or owner/repo#12' },
        page: { type: 'number', description: 'Page of the conversation, 1 by default' },
      },
      required: ['item'],
    },
    execute: async (_id, params) => {
      const { repo, number, kind } = itemOf(parseNamed(params.item))
      const read = await load(repo, number, kind)
      return answer(formatItem(repo, read, whole(params.page, 1)))
    },
  }
}

export function createGithubPrFilesTool(): AgentTool {
  return {
    name: 'github_pr_files',
    label: 'Pull request files',
    description:
      "A pull request's changed files. Without `path`: the list, with +/- counts and review-comment counts, 200 a page. " +
      "With `path`: that file's diff, numbered on the old and new side, 400 rows by default — `offset` and `limit` read further — followed by the review comments on it. " +
      'List first, then read the files that matter; never every diff at once. Read-only.',
    parameters: {
      type: 'object',
      properties: {
        item: { type: 'string', description: 'A link to the pull request, or owner/repo#12' },
        path: { type: 'string', description: "A changed file's path (a unique ending is enough)" },
        offset: { type: 'number', description: 'First diff row to show, 1-based' },
        limit: { type: 'number', description: 'How many diff rows, 400 by default, 1500 at most' },
        page: { type: 'number', description: 'Page of the file list, 1 by default' },
      },
      required: ['item'],
    },
    execute: async (_id, params) => {
      const named = parseNamed(params.item)
      const { repo, number, kind } = itemOf(named)
      if (kind && kind !== 'pull' && kind !== 'issue') {
        throw new Error('That is not a pull request.')
      }
      const t = { ...repo, kind: 'pull' as const, number, tab: 'files' as const }
      const data = await loadPullFiles(clientFor(repo), t)
      const name = `${repoName(repo)}#${number}`
      const path = text(params.path)

      if (path) {
        const file = findFile(data.files, path)
        const out = [
          `Pull request ${name}`,
          patchWindow(
            file,
            whole(params.offset, 1),
            whole(params.limit, DEFAULT_LINES),
            `call github_pr_files again with path="${file.path}" and`
          ),
        ]
        if (file.reviewComments.length) {
          out.push('', `## Review comments on ${file.path}`, '')
          for (const c of file.reviewComments) out.push(...commentBlock(c), '')
        }
        if (data.reviewCommentsProblem) out.push('', data.reviewCommentsProblem)
        return answer(out.join('\n'))
      }

      const page = whole(params.page, 1)
      const first = (page - 1) * FILES_PER_PAGE
      const rows = fileRows(data.files).slice(first, first + FILES_PER_PAGE)
      const added = data.files.reduce((n, f) => n + f.additions, 0)
      const removed = data.files.reduce((n, f) => n + f.deletions, 0)
      const out = [
        `Pull request ${name} — ${data.files.length} files changed, +${added} −${removed}` +
          (rows.length ? ` (files ${first + 1}–${first + rows.length})` : ''),
        ...rows,
      ]
      if (first + rows.length < data.files.length) out.push(`[More: page=${page + 1}.]`)
      if (!data.complete) out.push('GitHub listed only these files; the rest are on GitHub.')
      if (data.reviewCommentsProblem) out.push('', data.reviewCommentsProblem)
      out.push('', "Read one file's diff: call again with its path.")
      return answer(out.join('\n'))
    },
  }
}

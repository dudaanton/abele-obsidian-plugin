/**
 * Links to a place inside a GitHub item — lines of code, a comment — written the way GitHub
 * writes them, so they open the same place on GitHub and, through `parseGithubUrl`, in a tab here.
 *
 * Each comes with a label a person can read in a note: `acme/widgets#42 · src/app.ts:10–20`.
 */
import type { DiffLine } from './patch'

export interface RepoRef {
  host: string
  owner: string
  repo: string
}

/** The item a link starts from: its own address, and how it is named in a label. */
export type LinkItem = RepoRef &
  (
    | { kind: 'issue' | 'pull' | 'discussion'; number: number }
    | { kind: 'commit'; sha: string; pull?: number }
  )

export interface GithubLink {
  label: string
  url: string
}

/** A run of lines on one side of a diff: `L` the old file, `R` the new. */
export interface DiffSpan {
  side: 'L' | 'R'
  start: number
  end: number
}

/** Lines of the document a selection covers, 1-based and inclusive. */
export interface LineSpan {
  from: number
  to: number
}

const web = (r: RepoRef) =>
  `https://${r.host}/${encodeURIComponent(r.owner)}/${encodeURIComponent(r.repo)}`

const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/')

/** The item's own address: an issue, a pull request, a discussion, a commit. */
export function itemUrl(item: LinkItem): string {
  switch (item.kind) {
    case 'issue':
      return `${web(item)}/issues/${item.number}`
    case 'pull':
      return `${web(item)}/pull/${item.number}`
    case 'discussion':
      return `${web(item)}/discussions/${item.number}`
    case 'commit':
      return item.pull
        ? `${web(item)}/pull/${item.pull}/commits/${item.sha}`
        : `${web(item)}/commit/${item.sha}`
  }
}

/** How the item is named at the start of a label: `acme/widgets#42`, `acme/widgets@1a2b3c4`. */
export function itemName(item: LinkItem): string {
  const repo = `${item.owner}/${item.repo}`
  return item.kind === 'commit' ? `${repo}@${item.sha.slice(0, 7)}` : `${repo}#${item.number}`
}

const lineText = (start: number, end: number) => (start === end ? `${start}` : `${start}–${end}`)

/**
 * The side and numbers a selection of diff lines (indexes into `lines`) is linked by. The new side
 * when both ends have a number there — an added or unchanged line — and the old side when they
 * only have one there, as removed lines do; a selection mixing the two is narrowed to the lines
 * that carry the side its ends agree on. Null for a selection of hunk headers alone.
 */
export function diffSpan(lines: DiffLine[], from: number, to: number): DiffSpan | null {
  const picked = lines.slice(Math.min(from, to), Math.max(from, to) + 1)
  if (picked.length === 0) return null
  const ends = [picked[0], picked[picked.length - 1]]
  const numbers = (key: 'old' | 'new') =>
    picked.map((l) => l[key]).filter((n): n is number => n !== undefined)
  const span = (side: 'L' | 'R', ns: number[]): DiffSpan => ({
    side,
    start: Math.min(...ns),
    end: Math.max(...ns),
  })

  if (ends.every((l) => l.new !== undefined)) return span('R', numbers('new'))
  if (ends.every((l) => l.old !== undefined)) return span('L', numbers('old'))
  if (numbers('new').length) return span('R', numbers('new'))
  if (numbers('old').length) return span('L', numbers('old'))
  return null
}

/**
 * A link to lines in one file of a pull request's or a commit's diff:
 * `…/pull/42/files#diff-<sha256(path)>R10-R20`.
 */
export function diffLink(
  item: LinkItem,
  file: { path: string; hash: string },
  span: DiffSpan
): GithubLink {
  const { side, start, end } = span
  const lines = start === end ? `${side}${start}` : `${side}${start}-${side}${end}`
  const base = item.kind === 'pull' ? `${itemUrl(item)}/files` : itemUrl(item)
  const old = side === 'L' ? ' (before)' : ''
  return {
    label: `${itemName(item)} · ${file.path}:${lineText(start, end)}${old}`,
    url: `${base}#diff-${file.hash}${lines}`,
  }
}

/**
 * A link to lines of a file, pinned to the commit it was read at so it does not drift as the
 * branch moves on: `…/blob/<sha>/src/app.ts#L10-L20`.
 */
export function blobLink(repo: RepoRef, sha: string, path: string, span: LineSpan): GithubLink {
  const { from, to } = span
  const lines = from === to ? `L${from}` : `L${from}-L${to}`
  return {
    label: `${repo.owner}/${repo.repo}@${sha.slice(0, 7)} · ${path}:${lineText(from, to)}`,
    url: `${web(repo)}/blob/${sha}/${encodePath(path)}#${lines}`,
  }
}

/** What a comment is called in a label, by the anchor GitHub gives it. */
function commentKind(anchor: string, reply: boolean): string {
  if (anchor.startsWith('pullrequestreview-')) return 'review'
  if (anchor.startsWith('discussion_r')) return 'review comment'
  return reply ? 'reply' : 'comment'
}

/** A link to one comment, review, review comment or reply, by its anchor. */
export function commentLink(
  item: LinkItem,
  comment: { anchor: string; author: string },
  reply = false
): GithubLink {
  return {
    label: `${itemName(item)} · ${commentKind(comment.anchor, reply)} by ${comment.author}`,
    url: `${itemUrl(item)}#${comment.anchor}`,
  }
}

/** A link to the item itself, labelled with its title. */
export function bodyLink(item: LinkItem, title: string): GithubLink {
  return {
    label: title ? `${itemName(item)} · ${title}` : itemName(item),
    url: itemUrl(item),
  }
}

/** `[label](url)`, with the brackets and backslashes of the label escaped. */
export function markdownLink(link: GithubLink): string {
  const label = link.label.replace(/[\\[\]]/g, (c) => `\\${c}`)
  const url = link.url.replace(
    /[()\s]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`
  )
  return `[${label}](${url})`
}

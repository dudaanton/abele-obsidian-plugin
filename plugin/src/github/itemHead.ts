/**
 * How a GitHub tab names what it shows: the title and the details under it, the tab's own name,
 * and — for a file or a folder — the link to it at the ref it was read at.
 */
import type { GithubTarget } from './urls'
import { shortName } from './urls'
import { formatDate, splitMessage } from './format'
import { repoWeb } from './origin'
import type { GithubLink } from './permalinks'
import type { ItemData } from './loadItem'
import type { BlobData, CommitData, DiscussionData, IssueData, Label, PullData } from './api'
import type { FolderData } from './tree/folder'
import type { CompareData } from './compare'
import { treeUrl } from './tree/fileTree'

/** A commit SHA as GitHub shows one; a branch or a tag as it is. */
export const shortRef = (ref: string) => (/^[0-9a-f]{40}$/i.test(ref) ? ref.slice(0, 7) : ref)

/** A person in the details under the title, drawn with their name and picture. */
export interface MetaPerson {
  login: string
  avatar?: string
  /** Words after them: `opened 1 Sep 2026, 10:00`. */
  after?: string
}

export type MetaPart = string | MetaPerson

export interface ItemHead {
  title: string
  number?: number
  state?: string
  labels: Label[]
  meta: MetaPart[]
}

export function itemHead(t: GithubTarget | null, data: ItemData | null): ItemHead {
  const fallback: ItemHead = { title: t ? shortName(t) : '', labels: [], meta: [] }
  if (!t || !data) return fallback

  if (t.kind === 'commit') {
    const c = data as CommitData
    return {
      ...fallback,
      title: splitMessage(c.message).title,
      meta: [
        c.sha.slice(0, 7),
        c.login ? { login: c.login, avatar: c.avatar } : c.author,
        formatDate(c.date),
        ...(t.pull ? [`in #${t.pull}`] : []),
      ],
    }
  }
  if (t.kind === 'compare') {
    const c = data as CompareData
    const commits = `${c.aheadBy} commit${c.aheadBy === 1 ? '' : 's'} ahead`
    return {
      ...fallback,
      title: `${c.base}${c.direct ? '..' : '...'}${c.head}`,
      state: c.status || undefined,
      meta: [
        commits,
        `${c.behindBy} behind`,
        c.filesComplete || c.files.length ? `+${c.additions} −${c.deletions}` : '',
        c.mergeBaseSha ? `split at ${c.mergeBaseSha.slice(0, 7)}` : '',
      ].filter(Boolean),
    }
  }
  // A file or a folder is titled by where it is, which the breadcrumbs draw with its ref.
  if (t.kind === 'blob' || t.kind === 'tree') {
    const b = data as BlobData | FolderData
    return { ...fallback, title: b.path || `${t.owner}/${t.repo}` }
  }

  const item = data as IssueData | PullData | DiscussionData
  const meta: MetaPart[] = [
    {
      login: item.author,
      avatar: item.authorAvatar,
      after: `opened ${formatDate(item.createdAt)}`,
    },
  ]
  if (t.kind === 'pull') {
    const p = item as PullData
    meta.push(`${p.head} → ${p.base}`, `+${p.additions} −${p.deletions}`)
  }
  if (t.kind === 'discussion') meta.push((item as DiscussionData).category)
  return {
    title: item.title,
    number: item.number,
    state: item.state,
    labels: item.labels,
    meta: meta.filter(Boolean),
  }
}

/**
 * The tab's name: `app.ts @ main`, `util/ @ 1a2b3c4`, `acme/widgets#42 The title`,
 * `acme/widgets main...dev`.
 */
export function itemTabTitle(t: GithubTarget, data: ItemData, title: string): string {
  if (t.kind === 'compare') return `${t.owner}/${t.repo} ${title}`
  if (t.kind === 'blob' || t.kind === 'tree') {
    const b = data as BlobData | FolderData
    const name = b.path ? b.path.split('/').pop() : t.repo
    return `${name}${t.kind === 'tree' ? '/' : ''} @ ${shortRef(b.ref)}`
  }
  return `${shortName(t)} ${title}`
}

/**
 * A link to a file or a folder at the ref it was read at; undefined for anything else, which the
 * linker names.
 */
export function placeLink(t: GithubTarget, data: ItemData): GithubLink | undefined {
  if (t.kind === 'blob') {
    const b = data as BlobData
    const path = b.path.split('/').map(encodeURIComponent).join('/')
    return {
      label: `${t.owner}/${t.repo}@${b.ref} · ${b.path}`,
      url: `${repoWeb(t)}/blob/${b.ref}/${path}`,
    }
  }
  if (t.kind === 'tree') {
    const f = data as FolderData
    return {
      label: `${t.owner}/${t.repo}@${f.ref}${f.path ? ` · ${f.path}/` : ''}`,
      url: treeUrl(t, f.ref, f.path),
    }
  }
  return undefined
}
